# Crash Resilience Test (CRASH_TEST.md)

This document provides step-by-step instructions to reproduce and verify the crash resilience guarantees of the **Temporal Fault Engine**.

---

## 🛠️ Step 1: Start the Engine Cluster

Run the single-command startup to spin up all services:
```bash
docker compose up --build
```
Verify all containers are up and healthy. The database migrations will run automatically on boot.

---

## 🚀 Step 2: Schedule 10 Future Events

We will schedule 10 events to execute 20 seconds in the future.

### Using PowerShell (Windows):
```powershell
$scheduledTime = [DateTime]::UtcNow.AddSeconds(20).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
for ($i=1; $i -le 10; $i++) {
  Invoke-RestMethod -Uri "http://localhost:3001/api/events" -Method Post -ContentType "application/json" -Body "{`"payload`":{`"testId`":$i},`"scheduledAt`":`"$scheduledTime`",`"idempotencyKey`":`"crash-test-$i`"}"
}
```

### Using Curl (Linux / macOS):
```bash
SCHEDULED_TIME=$(date -u -d "+20 seconds" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -v+20s +"%Y-%m-%dT%H:%M:%SZ")
for i in {1..10}; do
  curl -X POST -H "Content-Type: application/json" -d "{\"payload\":{\"testId\":$i},\"scheduledAt\":\"$SCHEDULED_TIME\",\"idempotencyKey\":\"crash-test-$i\"}" http://localhost:3001/api/events
done
```

---

## 💥 Step 3: Simulate Hard Crash (kill -9)

Simulate a worker crash by forcefully killing the application container:
```bash
docker compose kill app
```

Verify the `app` container is stopped while Postgres and Redis are still running:
```bash
docker compose ps
```
*Expected Output*: `app` container status is `exited (137)`.

---

## 🔄 Step 4: Restart the Scheduler Node

Start the app node again to simulate recovery:
```bash
docker compose start app
```

Monitor the logs:
```bash
docker compose logs -f app
```

*Expected Logs during recovery*:
1. The app detects its previous container crash.
2. The `recovery/index.ts` subsystem runs on boot:
   ```text
   INFO: Crash recovery reclaimed leases
   ```
3. The scheduler starts and retrieves the events from the Redis queue.
4. All 10 events execute to completion.

---

## 📊 Step 5: Verify Execution Completion

Query the events API to verify that every single event has reached the `EXECUTED` state:
```bash
curl http://localhost:3001/api/events?limit=10
```

*Expected JSON Verification*:
- All 10 events (with idempotency keys `crash-test-1` to `crash-test-10`) display `status: "EXECUTED"`.
- `attemptCount` is `1` (or `2` if a worker was killed mid-execution during a tight race).
- There is zero data loss.
