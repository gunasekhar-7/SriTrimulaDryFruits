# Production Deployment, Operations & Disaster Recovery Guide

This guide establishes the production-grade deployment standards, process management strategy, database migration procedures, rollback runbooks, and health verification protocols for **Sri Tirumala Dry Fruits POS & E-Commerce Platform**.

---

## 1. Unified Process-Management Strategy

### Architectural Decision: Container-Native Process Management
* **Selected Strategy:** **Docker Engine / Docker Compose as the Primary Process Supervisor**.
* **PID 1 Execution:** Node.js executes directly as the primary process (`node dist/server.js`) inside the container.
* **Why NOT PM2 inside Docker?**
  * Running PM2 inside a Docker container introduces **redundant process supervisors**.
  * PM2 intercepts and swallows standard POSIX signals (`SIGTERM`, `SIGINT`), complicating clean container drains.
  * Docker already provides native process supervision, automatic restart policies (`restart: unless-stopped`), container healthchecks, CPU/RAM quotas, and log rotation drivers (`json-file`).
  * Running PM2 adds unnecessary memory footprint and duplicate log files.
* **Role of `ecosystem.config.cjs`:**
  * Retained **strictly as a legacy fallback** for uncontainerized, bare-metal on-premise hardware where Docker is not installed.
  * **Never invoke PM2 inside the Docker container.**

---

## 2. Hardened Infrastructure Controls

The deployment is hardened with the following defense-in-depth controls:

| Security & Resilience Dimension | Implementation Detail |
| :--- | :--- |
| **Unprivileged Non-Root Execution** | Container runs as user `node:node` (`UID:GID 1000:1000`). Root privileges are dropped. |
| **Filesystem Security** | `security_opt: [no-new-privileges:true]`, `cap_drop: [ALL]`, and `tmpfs: [/tmp:rw,noexec,nosuid,size=64m]`. |
| **Persistent Storage** | Named Docker volumes (`pos_data` and `pos_logs`) decouple SQLite database files and logs from container lifecycle. |
| **Immutable Image Tagging** | Production containers enforce immutable commit SHAs or release tags (`sri-tirumala-pos:${IMAGE_TAG}`) rather than mutable `:latest`. |
| **Resource Limits & Quotas** | Strict container quotas prevent noisy-neighbor host exhaustion (CPU limit: `2.0 cores`, RAM limit: `1024MB`). |
| **Secure Secret Injection** | Cryptographic secrets (`SESSION_SECRET`, `COOKIE_SECRET`) can be mounted via Docker Secrets into `/run/secrets/`, preventing exposure in `docker inspect`. |
| **Graceful Shutdown Window** | `stop_grace_period: 15s` allows in-flight HTTP requests to finish, background job worker to pause, and SQLite WAL to cleanly checkpoint to disk. |
| **Native Healthchecks** | Native Node.js `fetch` probes `/health` every 30 seconds with 5s timeout, 15s start-period, and 3 retries. |
| **Log Rotation Driver** | Host disk exhaustion prevented via Docker JSON-file log driver (`max-size: 20m`, `max-file: 5`). |

---

## 3. Deployment Runbooks

### A. Local Deployment (Development)
For local testing in containerized isolation:

```bash
# 1. Prepare environment configuration
cp .env.development.example .env

# 2. Build and start container using Docker Compose
docker compose up -d --build

# 3. View container health status
docker compose ps

# 4. View application logs
docker compose logs -f pos-app

# 5. Stop local container
docker compose down
```

---

### B. Staging Deployment
Pre-production environment running with QA sandboxes and isolated port `3001`:

```bash
# 1. Prepare staging environment
cp .env.staging.example .env.staging
# Update .env.staging with staging secrets and sandbox credentials

# 2. Build and launch with staging overrides
IMAGE_TAG=staging-$(git rev-parse --short HEAD) \
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build

# 3. Verify healthcheck and liveness probe
docker inspect --format='{{json .State.Health.Status}}' sri-tirumala-pos-staging
# Output must be: "healthy"

# 4. Verify HTTP response
curl -i http://localhost:3001/health
```

---

### C. Production Deployment
Production rollout using immutable image tags, Docker Secrets, and hardened quotas:

```bash
# 1. Provision Docker Secrets (Prevent environment variable leakage)
mkdir -p ./secrets
chmod 700 ./secrets
node -e "fs.writeFileSync('./secrets/session_secret.txt', crypto.randomBytes(32).toString('hex'))"
node -e "fs.writeFileSync('./secrets/cookie_secret.txt', crypto.randomBytes(32).toString('hex'))"
chmod 600 ./secrets/*.txt

# 2. Set immutable image tag (Commit SHA or Release Tag)
export IMAGE_TAG="v1.2.0"

# 3. Pull or build verified image
docker compose -f docker-compose.yml -f docker-compose.prod.yml build

# 4. Deploy production container with zero downtime
IMAGE_TAG="v1.2.0" \
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 5. Await healthy status
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

---

## 4. Database Migration Process

The database uses SQLite (`better-sqlite3`) in **Write-Ahead Logging (WAL) mode**.

### Migration Rules:
1. **Never migrate without a pre-migration backup snapshot.**
2. **Execute migrations against the mounted persistent volume inside the container.**

### Step-by-Step Migration Execution:
```bash
# 1. Step 1: Force SQLite WAL checkpoint and create immediate pre-migration snapshot
docker compose exec pos-app node -e "
  const db = require('./dist/src/database.js').default;
  db.pragma('wal_checkpoint(TRUNCATE)');
  const backupName = 'pre_migration_' + Date.now() + '.db';
  db.backup('/app/data/backups/' + backupName)
    .then(() => console.log('✅ Snapshot saved:', backupName))
    .catch(err => { console.error('Snapshot failed:', err); process.exit(1); });
"

# 2. Step 2: Execute migration script (e.g., variant migrations or customer index updates)
docker compose exec pos-app node dist/scripts/migrate_variants.js

# 3. Step 3: Run schema and integrity verification
docker compose exec pos-app node dist/scripts/check_schema.js

# 4. Step 4: Verify application health after migration
curl -i http://localhost:3000/health
```

---

## 5. Rollback Procedure

When a release fails post-deployment (elevated 5xx rate, broken transactions, or failed healthcheck):

### Scenario 1: Code / Container Rollback (Schema Unchanged)
```bash
# 1. Identify previous stable image tag (e.g., v1.1.9)
PREVIOUS_STABLE_TAG="v1.1.9"

# 2. Redeploy container with the stable image tag
IMAGE_TAG="$PREVIOUS_STABLE_TAG" \
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 3. Verify health
docker compose ps
curl -i http://localhost:3000/health
```

### Scenario 2: Full Rollback (Code + Corrupted Database Restore)
Follow the database restore process below.

---

## 6. Backup Restoration Procedure

If an erroneous migration corrupts SQLite data or hardware storage fails:

```bash
# 1. Stop the application container to freeze database write access
docker compose stop pos-app

# 2. Locate backup archive inside the persistent volume host directory
# (For named volumes, inspect mount path with: docker volume inspect sri_tirumala_pos_data)
VOLUME_DATA_PATH=$(docker volume inspect sri_tirumala_pos_data --format '{{ .Mountpoint }}')

# 3. Take forensic snapshot of corrupted file before restoring
cp "$VOLUME_DATA_PATH/store.db" "$VOLUME_DATA_PATH/store_corrupted_$(date +%Y%m%d_%H%M%S).db"

# 4. Remove lingering active WAL and SHM files
rm -f "$VOLUME_DATA_PATH/store.db-wal" "$VOLUME_DATA_PATH/store.db-shm"

# 5. Copy target verified backup over store.db
TARGET_BACKUP="$VOLUME_DATA_PATH/backups/backup_TARGET.db"
cp "$TARGET_BACKUP" "$VOLUME_DATA_PATH/store.db"

# 6. Ensure correct file ownership (UID:GID 1000:1000 for node user)
chown 1000:1000 "$VOLUME_DATA_PATH/store.db"

# 7. Run SQLite PRAGMA integrity check
sqlite3 "$VOLUME_DATA_PATH/store.db" "PRAGMA integrity_check;"
# Output must be: "ok"

# 8. Start the application container
docker compose start pos-app

# 9. Verify health probe
docker inspect --format='{{json .State.Health.Status}}' sri-tirumala-pos
```

---

## 7. Health Verification Protocols

The system exposes three verification tiers:

### 1. Docker Container Health Status
Inspect the container runtime healthcheck evaluated by the Docker daemon:
```bash
docker inspect --format='{{json .State.Health}}' sri-tirumala-pos
```
Expected output:
```json
{"Status":"healthy","FailingStreak":0,"Log":[{"ExitCode":0,"Output":""}]}
```

### 2. HTTP Liveness Probe (`/health`)
Verifies process responsiveness, environment, and uptime:
```bash
curl -s http://localhost:3000/health | jq .
```
Expected output:
```json
{
  "status": "healthy",
  "uptimeSeconds": 3600,
  "timestamp": "2026-10-09T18:00:00.000Z",
  "environment": "production"
}
```

### 3. Readiness Probe & Telemetry (`/metrics`)
Verifies SQLite connectivity and Prometheus request metrics:
```bash
curl -s http://localhost:3000/metrics | grep -E "http_requests_total|http_request_duration_ms"
```
Ensure HTTP `5xx` error count is 0 and request latencies match SLA baselines (< 50ms).
