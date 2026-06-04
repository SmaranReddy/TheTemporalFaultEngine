# Setup Verification (SETUP_VERIFICATION.md)

This document verifies the steps to run a clean, containerized startup of the **Temporal Fault Engine** and validates that all system components (PostgreSQL, Redis, Worker, Dashboard) start successfully.

---

## 🛠️ Step 1: Start the Cluster

To spin up the entire cluster including database, cache, api server, and background workers, run:

```bash
docker compose up --build -d
```

This command will:
1. Build the Node.js runner image using the multi-stage Dockerfile.
2. Spin up the **PostgreSQL** database and perform a health check validation.
3. Spin up the **Redis** instance and perform a health check validation.
4. Run Drizzle migrations automatically on startup of the **app** container.
5. Initialize the API server (listening internally on port 3001) and startup the scheduler, worker, and lease reaper background loops.

---

## 🔍 Step 2: Verify Running Containers

To verify all containers have started successfully and are healthy, run:

```bash
docker compose ps
```

### Verified CLI Output:
```text
NAME                                IMAGE                        COMMAND                  SERVICE    STATUS                   PORTS
thetemporalfaultengine-app-3        thetemporalfaultengine-app   "docker-entrypoint.s…"   app        Up 3 minutes (healthy)   0.0.0.0:3001->3001/tcp
thetemporalfaultengine-postgres-1   postgres:17-alpine           "docker-entrypoint.s…"   postgres   Up 4 minutes (healthy)   0.0.0.0:5432->5432/tcp
thetemporalfaultengine-redis-1      redis:7-alpine               "docker-entrypoint.s…"   redis      Up 4 minutes (healthy)   0.0.0.0:6379->6379/tcp
```

All three services are marked as **healthy** and **Up**.

---

## 📋 Component Verification Details

### 1. PostgreSQL Database (`postgres`)
- **Container Name**: `thetemporalfaultengine-postgres-1`
- **Image**: `postgres:17-alpine`
- **Port Mapping**: `5432` -> `5432`
- **Verification**: `docker compose ps` reports status `healthy`. Logs confirm: `database system is ready to accept connections`.

### 2. Redis Cache & Queue (`redis`)
- **Container Name**: `thetemporalfaultengine-redis-1`
- **Image**: `redis:7-alpine`
- **Port Mapping**: `6379` -> `6379`
- **Verification**: `docker compose ps` reports status `healthy`. Logs confirm: `Ready to accept connections tcp`.

### 3. Application Node (`worker` & `dashboard`)
- **Container Name**: `thetemporalfaultengine-app-3`
- **Image**: Built dynamically from `docker/Dockerfile`.
- **Port Mapping**: Mapped dynamically from host range `3001-3005` to container port `3001` (first container defaults to `3001`).
- **Startup Sequence**:
  - Automatically runs Drizzle schema migrations (`npm run migrate:run`) to initialize Postgres.
  - Launches the HTTP server and WebSockets handler (port 3001).
  - Starts the scheduler polling and lease reaper monitoring loops.
  - Starts the worker execution processor.
- **Verification**: `docker compose ps` reports status `healthy`. Logs show:
  ```text
  INFO: API server listening
  INFO: Scheduler started
  INFO: Reaper loop started
  ```
