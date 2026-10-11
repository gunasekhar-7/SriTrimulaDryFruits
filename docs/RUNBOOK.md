# Operational Incident Response Runbook

## 1. Overview & Operational Responsibilities

This runbook provides actionable, step-by-step incident response procedures for On-Call Engineers, Site Reliability Engineers (SREs), and System Administrators managing the Sri Tirumala Dry Fruits platform.

### Standard Diagnostic Toolkit
* **Container Health**: `docker compose -f docker-compose.prod.yml ps`
* **Real-time Logs**: `docker compose -f docker-compose.prod.yml logs -f --tail=100`
* **System Metrics**: `curl -s http://localhost:3000/observability/metrics | jq .`
* **Prometheus Telemetry**: `curl -s http://localhost:3000/metrics`
* **Health Probe**: `curl -i http://localhost:3000/health`

---

## 2. Emergency Incident Playbooks

### Playbook 1: SQLite Database File Locked (`SQLITE_BUSY`)

#### Symptoms:
* HTTP 500 responses with error message: `SqliteError: database is locked` or `busy_timeout exceeded`.
* Physical POS terminal billing slows down or hangs.

#### Immediate Diagnosis:
```bash
# Check if a long-running WAL checkpoint or unindexed query is holding a write lock
docker compose -f docker-compose.prod.yml exec pos-app node -e "
  const db = require('better-sqlite3')('data/store.db');
  console.log('WAL Mode:', db.pragma('journal_mode'));
  console.log('Busy Timeout:', db.pragma('busy_timeout'));
"
```

#### Remediation Steps:
1. **Force WAL Checkpoint**:
   ```bash
   docker compose -f docker-compose.prod.yml exec pos-app node -e "
     const db = require('better-sqlite3')('data/store.db');
     console.log(db.pragma('wal_checkpoint(RESTART)'));
   "
   ```
2. **If lock persists (hung process)**:
   Restart the application container gracefully:
   ```bash
   docker compose -f docker-compose.prod.yml restart pos-app
   ```
3. **Verify Restoration**:
   Run a test read query to ensure the database is responding within < 5ms:
   ```bash
   curl -i http://localhost:3000/health
   ```

---

### Playbook 2: Background Job Queue Backlog / Stalled WhatsApp Messages

#### Symptoms:
* Customers report not receiving WhatsApp order confirmation alerts.
* `/observability/metrics` reports high `background_jobs_pending` or `background_job_failures_total`.

#### Immediate Diagnosis:
```bash
# Inspect queue status and failed jobs
docker compose -f docker-compose.prod.yml exec pos-app node -e "
  const db = require('better-sqlite3')('data/store.db');
  const counts = db.prepare('SELECT status, COUNT(*) as count FROM background_jobs GROUP BY status').all();
  console.log('Queue Status Counts:', counts);
  const errors = db.prepare('SELECT id, name, last_error FROM background_jobs WHERE status = \'FAILED\' LIMIT 5').all();
  console.log('Recent Errors:', errors);
"
```

#### Remediation Steps:
1. **If Meta WhatsApp Token Expired (OAuth Error 190)**:
   - Generate a fresh System User Access Token in Meta Business Suite.
   - Update `WHATSAPP_TOKEN` in `.env.production`.
   - Re-deploy environment without downtime:
     ```bash
     docker compose -f docker-compose.prod.yml up -d
     ```
2. **Retry Failed Queue Jobs**:
   ```bash
   # Reset failed jobs to PENDING for immediate reprocessing
   docker compose -f docker-compose.prod.yml exec pos-app node -e "
     const db = require('better-sqlite3')('data/store.db');
     const info = db.prepare(\"UPDATE background_jobs SET status = 'PENDING', attempts = 0, run_at = datetime('now') WHERE status = 'FAILED'\").run();
     console.log('Retried jobs count:', info.changes);
   "
   ```

---

### Playbook 3: High Memory Usage / Container OOM

#### Symptoms:
* Docker reports container restart with Exit Code 137 (OOM Killed).
* Host system memory alerts firing.

#### Immediate Diagnosis:
```bash
docker stats --no-stream
```

#### Remediation Steps:
1. **Inspect Heap Profile**:
   Review application memory allocation in `logs/app.log`.
2. **Increase Container Memory Limit (Temporary Mitigation)**:
   If festive volume causes peak spikes, adjust memory limit in `docker-compose.prod.yml`:
   ```yaml
   deploy:
     resources:
       limits:
         memory: 1536M
   ```
   Apply configuration:
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

---

### Playbook 4: Host Disk Space Depletion

#### Symptoms:
* Write operations fail with `SQLITE_FULL` or `ENOSPC: no space left on device`.

#### Immediate Diagnosis:
```bash
df -h
docker system df
```

#### Remediation Steps:
1. **Clean Docker Build Cache & Prune Unused Images**:
   ```bash
   docker image prune -af
   docker builder prune -f
   ```
2. **Purge Aged Compressed Backups**:
   ```bash
   # Remove verified local backup snapshots older than 14 days
   find /var/lib/docker/volumes/pos_prod_backups/_data -name "*.db.gz" -mtime +14 -delete
   ```
3. **Rotate Application Logs**:
   ```bash
   # Truncate debug logs if log driver rotation did not fire
   truncate -s 0 /var/lib/docker/volumes/pos_prod_logs/_data/app.log
   ```

---

### Playbook 5: Database Corruption Recovery

#### Symptoms:
* Application logs report `SQLITE_CORRUPT` or `malformed database schema`.

#### Immediate Diagnosis & Execution:
1. **Stop Application Container Immediately**:
   ```bash
   docker compose -f docker-compose.prod.yml stop pos-app
   ```
2. **Identify Latest Verified Backup Snapshot**:
   ```bash
   ls -lat /var/lib/docker/volumes/pos_prod_backups/_data/
   ```
3. **Execute Atomic Restore**:
   ```bash
   LATEST_BACKUP=$(ls -t /var/lib/docker/volumes/pos_prod_backups/_data/*.db.gz | head -1)
   
   # Decompress backup to replacement file
   gunzip -c "$LATEST_BACKUP" > /var/lib/docker/volumes/pos_prod_data/_data/store_recovered.db
   
   # Backup corrupted file for forensic analysis
   mv /var/lib/docker/volumes/pos_prod_data/_data/store.db /var/lib/docker/volumes/pos_prod_data/_data/store_corrupted.db
   
   # Promote recovered database
   mv /var/lib/docker/volumes/pos_prod_data/_data/store_recovered.db /var/lib/docker/volumes/pos_prod_data/_data/store.db
   ```
4. **Restart Application & Verify**:
   ```bash
   docker compose -f docker-compose.prod.yml start pos-app
   docker compose -f docker-compose.prod.yml logs -f pos-app
   curl -f http://localhost:3000/health
   ```

---

## 3. Routine Maintenance & Health Checklist

| Frequency | Action | Verification Command | Expected Output |
| :--- | :--- | :--- | :--- |
| **Hourly** | Automated Local Backup | Check `/app/backups/` | New `.db.gz` file with `integrity_check ok` |
| **Daily** | Offsite Cloud Backup Sync | `node dist/scripts/sync_cloud_backup.sh` | S3 / GCS bucket has latest archive |
| **Weekly** | Ledger Cryptographic Integrity | `GET /api/v1/audit-logs/verify` | `{"success": true, "data": {"isValid": true}}` |
| **Monthly** | Simulated Disaster Recovery Drill | In-memory restore test | Full transactional read/write success |
