# Health Check Validation & Failover

The Temporal Fault Engine exposes a health monitoring endpoint at `GET /health` to verify the state of the engine and its primary backing services (PostgreSQL and Redis). This document describes the expected and actual responses observed during validation testing.

---

## 🔍 Validation Commands

To check the health status from a command-line interface, use:

```bash
curl -i http://localhost:3001/health
```

---

## 🟢 Case 1: All Systems Healthy

When both PostgreSQL and Redis are online, the API server returns a `200 OK` status and lists both dependencies as healthy.

### Expected Response
- **HTTP Status Code**: `200 OK`
- **Body**:
  ```json
  {"status":"healthy","dependencies":{"database":true,"redis":true}}
  ```

### Actual Response
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 65
Date: Thu, 04 Jun 2026 15:05:34 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"healthy","dependencies":{"database":true,"redis":true}}
```

---

## 🟡 Case 2: Redis Unavailable (Down)

To simulate Redis failure:
```bash
docker compose stop redis
```

### Expected Response
- **HTTP Status Code**: `503 Service Unavailable`
- **Body**:
  ```json
  {"status":"unhealthy","dependencies":{"database":true,"redis":false}}
  ```

### Actual Response
```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json; charset=utf-8
Content-Length: 69
Date: Thu, 04 Jun 2026 15:05:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"unhealthy","dependencies":{"database":true,"redis":false}}
```

---

## 🔴 Case 3: PostgreSQL Unavailable (Down)

To simulate PostgreSQL database failure (with Redis online):
```bash
docker compose stop postgres
```

### Expected Response
- **HTTP Status Code**: `503 Service Unavailable`
- **Body**:
  ```json
  {"status":"unhealthy","dependencies":{"database":false,"redis":true}}
  ```

### Actual Response
```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json; charset=utf-8
Content-Length: 69
Date: Thu, 04 Jun 2026 15:05:55 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"unhealthy","dependencies":{"database":false,"redis":true}}
```

---

## 🔄 Self-Healing Recovery Behavior

The application container logs automatic retry connection attempts when a dependency goes down. Once the offline container is restarted, the connection is re-established automatically without requiring an app reboot:
```bash
docker compose start postgres
docker compose start redis
```
Subsequent healthcheck requests return to the `200 OK` healthy status.
