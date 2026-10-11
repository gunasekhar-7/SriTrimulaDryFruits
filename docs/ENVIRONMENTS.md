# Environment Configuration & Deployment Guidance

This document defines the operational architecture, secrets management, and deployment standards across the three application tiers: **Development**, **Staging**, and **Production**.

---

## 1. Architectural & Configuration Comparison Matrix

| Dimension | Development (`development`) | Staging (`staging`) | Production (`production`) |
| :--- | :--- | :--- | :--- |
| **Primary Goal** | Rapid feature prototyping, local debuggability, zero external cloud dependency. | Pre-production parity testing, QA validation, end-to-end integration checks. | High availability, transactional integrity, data durability, zero downtime. |
| **Hosting Model** | Local developer machine (Bare metal `tsx` or local Docker). | Cloud VM / Staging Container cluster (Docker Compose / Nomad / ECS). | High-availability redundant host / ECS / Kubernetes with auto-restart. |
| **Domain / URL** | `http://localhost:3000` | `https://staging.sritirumaladryfruits.internal` | `https://pos.sritirumaladryfruits.com` |
| **Database** | SQLite (`./data/store.db`), ephemeral, reset via migration scripts. | SQLite mounted on persistent cloud storage volume; sanitized seed data. | High-speed NVMe storage volume mounted to `/app/data`; WAL mode enabled; Litestream & hourly cloud sync. |
| **Secrets Source** | Local `.env` or `.env.development` file (strictly excluded from git). | GitHub Environment Secrets (`staging`) injected during CD execution. | GitHub Environment Secrets (`production`) + AWS Secrets Manager / Vault. |
| **Session & Cookie** | Insecure HTTP allowed; developer fallback keys permitted. | Strict HTTPS; generated 64-character cryptographic hex strings. | Strict HTTPS (`secure: true`, `sameSite: 'lax'`); 64-character hex keys. Startup aborts if missing! |
| **WhatsApp Integration** | Local mock mode (logged to console; no API credits consumed). | Meta Cloud API Developer Test Sandbox / Test Business Phone. | Live Meta WhatsApp Cloud API with Permanent System User Token. |
| **Email Delivery** | Local mock (MailHog / Mailpit at `localhost:1025`) or no-op. | Sandboxed SMTP (Mailtrap / SendGrid sandbox environment). | Production authenticated SMTP relay (AWS SES / SendGrid with DKIM/SPF). |
| **Logging & Tracing** | Winston `debug` level; colorized terminal output; OpenTelemetry disabled. | Winston `info` level; JSON file output; OpenTelemetry enabled to staging collector. | Winston `info` level structured JSON; centralized log shipment (Datadog/Loki); full OpenTelemetry tracing. |
| **Deployment Gate** | Manual `npm run dev` by engineer. | Automated deployment upon merge to `develop` or manual CI dispatch. | Mandatory release tag (`v*.*.*`) or manual review approval gate on `main`. |

---

## 2. Environment Details & Setup Instructions

### A. Development Tier (`development`)
- **Use Case:** Local feature implementation, bug reproduction, unit/integration testing.
- **Setup:**
  ```bash
  # 1. Copy the development environment template
  cp .env.development.example .env

  # 2. Install dependencies
  npm ci --legacy-peer-deps

  # 3. Initialize local database schema
  npm run dev
  ```
- **Operational Behaviors:**
  - `better-sqlite3` creates `data/store.db` automatically in WAL mode.
  - Background jobs run in-process with synchronous local logging.
  - WhatsApp messages log simulated JSON payloads directly to standard output.

---

### B. Staging Tier (`staging`)
- **Use Case:** QA validation, stakeholder acceptance testing, automated container deployment verification.
- **Secrets Management:**
  - In your GitHub Repository:
    1. Navigate to **Settings** → **Environments** → **staging**.
    2. Add the following secrets:
       - `STAGING_SESSION_SECRET`: `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`
       - `STAGING_COOKIE_SECRET`: `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`
       - `STAGING_WHATSAPP_TOKEN`: Meta Test Sandbox Bearer Token
- **Operational Behaviors:**
  - Container runs as unprivileged user `node`.
  - Database persists to `/app/data` volume mount.
  - Smoke tests query `http://<host>:3000/health` automatically before marking the deployment successful.

---

### C. Production Tier (`production`)
- **Use Case:** Live store billing, customer orders, inventory deduction, financial audit logs.
- **Security & Hardening Checklist:**
  1. **Strict Zero-Default Validation:**
     - In `server.ts`, if `process.env.NODE_ENV === 'production'` and `SESSION_SECRET` matches a fallback default or is shorter than 32 characters, the process must terminate immediately with exit code 1.
  2. **Volume Persistence & Permissions:**
     - Ensure the host mount path for `/app/data` and `/app/logs` is owned by user `node` (UID `1000:1000`):
       ```bash
       sudo mkdir -p /srv/sri-tirumala/data /srv/sri-tirumala/logs
       sudo chown -R 1000:1000 /srv/sri-tirumala
       ```
  3. **Automated Offsite Database Backups:**
     - The background job runner executes hourly hot backups using SQLite VACUUM INTO / WAL checkpoints.
     - Hook script `scripts/sync_cloud_backup.sh` uploads encrypted archives to AWS S3 / Cloudflare R2 bucket (`sri-tirumala-backups-prod`).
  4. **GitHub Environment Protection Rule:**
     - Navigate to **Settings** → **Environments** → **production**.
     - Enable **Required reviewers** (add Senior Tech Lead / DevOps Lead).
     - Restrict deployment branches to `main` and tags `v*.*.*`.

---

## 3. Secret Rotation Procedure

To rotate production session or cookie keys without disrupting active POS shifts:
1. **Prepare New Keys:** Generate 64-character random strings:
   ```bash
   node scripts/generate_secrets.js
   ```
2. **Update GitHub Secrets:** Update `PROD_SESSION_SECRET` and `PROD_COOKIE_SECRET`.
3. **Execute Rolling Restart:** Trigger deployment pipeline. Express session automatically retains sessions stored in `sessions.db` across rolling restarts.
