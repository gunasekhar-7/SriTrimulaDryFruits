# Security Architecture & Threat Mitigation Guide

## 1. Security Philosophy & Defense-in-Depth

The Sri Tirumala Dry Fruits application implements a **multi-layered, defense-in-depth security model** protecting customer personally identifiable information (PII), point-of-sale financial integrity, and store administration.

```text
Layer 1: Network & Edge (TLS 1.3, Reverse Proxy, Gzip, DDoS Rate Limiting)
  └── Layer 2: HTTP Transport (Helmet Headers, HSTS, CSP, Double-Submit CSRF)
        └── Layer 3: Authentication (Bcrypt Cost 10, Session Regeneration, Anti-Brute-Force)
              └── Layer 4: Authorization & RBAC (Role Guards, Customer BOLA/IDOR Shields)
                    └── Layer 5: Data & Persistence (Parameterized SQL, Engine Immutability Triggers)
```

---

## 2. Threat Model & Countermeasures

| Threat Vector | Potential Impact | Implemented Countermeasure |
| :--- | :--- | :--- |
| **SQL Injection (SQLi)** | Unauthorized data exfiltration or tampering | **Parameterized Queries**: All queries execute via `better-sqlite3` prepared statements (`?` placeholders). Raw string concatenation is prohibited across the codebase. |
| **Cross-Site Request Forgery (CSRF)** | Unauthorized administrative or cart actions | **Double-Submit Token Pattern**: State-changing POST/PUT/DELETE endpoints validate cryptographically random session tokens (`_csrf`). |
| **Broken Object-Level Auth (BOLA / IDOR)** | Customers accessing orders/addresses of other customers | **Strict Ownership Verification**: Account controllers strictly bind entity queries to `req.session.customer_id`. |
| **Credential Brute-Force** | Account takeover of admin or staff credentials | **Rate Limiting**: `express-rate-limit` throttles login attempts (maximum 10 attempts per 15 minutes per IP). Passwords hashed using `bcryptjs` with work factor 10. |
| **Session Hijacking / Fixation** | Stolen session cookies | **Session Regeneration**: Sessions are destroyed and regenerated on successful login. Cookies configured with `HttpOnly`, `SameSite=Lax`, and `Secure` (production). |
| **Audit Ledger Tampering** | Rogue staff covering up unauthorized actions | **Database-Engine Triggers**: SQLite triggers abort any `UPDATE` or `DELETE` on `audit_logs`. SHA-256 parent hash chaining enables automated tamper detection. |
| **Webhook Spoofing** | Fake order delivery or payment confirmations | **HMAC SHA-256 Verification**: Inbound WhatsApp webhooks validate `X-Hub-Signature-256` using the pre-shared app secret. |
| **Negative Inventory Race Conditions** | Overselling products during concurrent checkouts | **Database Check Constraint**: `CHECK (total_qty - sold_qty >= 0)` guarantees atomicity at the storage engine level. |

---

## 3. Role-Based Access Control (RBAC) Matrix

Access permissions are enforced by middleware guards in [`src/middleware/auth.ts`](file:///c:/Projects/sri-tirmula-dryfruits/src/middleware/auth.ts):

| Route / Resource | Public Guest | Store Customer | Staff Cashier | Store Administrator |
| :--- | :---: | :---: | :---: | :---: |
| **Storefront Catalog & Search** | ✅ Read | ✅ Read | ✅ Read | ✅ Read |
| **Customer Cart & Checkout** | ✅ Create | ✅ Full Access | ❌ Restricted | ❌ Restricted |
| **Customer Order History / Wishlist** | ❌ Blocked | ✅ Own Data Only | ❌ Restricted | ❌ Restricted |
| **POS Billing Desk (`/sell`, `/bill`)** | ❌ Blocked (302) | ❌ Blocked (302) | ✅ Full Access | ✅ Full Access |
| **Cashier Register Shift (`/shift/*`)** | ❌ Blocked (302) | ❌ Blocked (302) | ✅ Full Access | ✅ Full Access |
| **Inventory Stock Management (`/stock`)** | ❌ Blocked (302) | ❌ Blocked (302) | ✅ Read Only | ✅ Full Access (Add/Edit) |
| **Financial Profit Reports (`/profit`)** | ❌ Blocked (302) | ❌ Blocked (302) | ❌ Blocked (302) | ✅ Full Access |
| **Executive Analytics (`/analytics`)** | ❌ Blocked (302) | ❌ Blocked (302) | ❌ Blocked (302) | ✅ Full Access |
| **Immutable Audit Logs (`/audit-logs`)** | ❌ Blocked (302) | ❌ Blocked (302) | ❌ Blocked (302) | ✅ Full Access |
| **User & Role Credentials (`/settings`)** | ❌ Blocked (302) | ❌ Blocked (302) | ❌ Blocked (302) | ✅ Full Access |

---

## 4. Broken Object-Level Authorization (BOLA/IDOR) Defense

To prevent customers from viewing or modifying orders, cart items, or delivery addresses belonging to other users:

```typescript
// Example: Safe customer order access in CustomerService
getOrderById(orderId: number, customerId: number): OnlineOrderFull | null {
  const order = onlineOrderRepository.getOrderById(orderId);
  // Strict tenancy check: order must belong to the active session's customerId
  if (!order || order.customer_id !== customerId) {
    return null; // Prevents data leakage
  }
  return order;
}
```

---

## 5. Audit Log Immutability Enforcement

The application uses SQLite triggers to prevent any modification or erasure of the audit ledger:

```sql
CREATE TRIGGER IF NOT EXISTS prevent_audit_log_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(FAIL, 'Immutable audit log: UPDATE operations are strictly prohibited.');
END;

CREATE TRIGGER IF NOT EXISTS prevent_audit_log_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(FAIL, 'Immutable audit log: DELETE operations are strictly prohibited.');
END;
```

Even an administrator running ad-hoc SQL queries through an administrative console cannot delete or alter historical audit logs.

---

## 6. Secrets & Environment Configuration Hygiene

1. **No Hardcoded Secrets**: All sensitive values (`SESSION_SECRET`, `COOKIE_SECRET`, `WHATSAPP_TOKEN`, `META_APP_SECRET`, `INTERNAL_SERVICE_KEY`) are injected via environment variables or Docker secrets files (`/run/secrets/`).
2. **Git & Artifact Exclusions**: `.env*` files, private keys, database dumps, and testing credentials are excluded from version control via `.gitignore` and `.dockerignore`.
3. **Container Security**: The production Docker container executes under a dedicated non-root user (`appuser:appgroup`, UID 10001) preventing container escape vulnerabilities.

---

## 7. Background Job Queue Security & Remediation (P0)

### 7.1 Vulnerability Overview & Root Cause
In prior revisions, the background job management routes mounted at `/api/v1/jobs` in [`src/routes/api.ts`](file:///c:/Projects/sri-tirmula-dryfruits/src/routes/api.ts) were mounted without authentication, role-based authorization, or CSRF protection. Consequently:
- Unauthenticated external actors could inspect job queues, dead-letter jobs, and queue metrics via `GET /api/v1/jobs` and `GET /api/v1/jobs/stats`.
- Attackers could trigger unauthenticated manual job retries (`POST /api/v1/jobs/:id/retry`) or cancellations (`POST /api/v1/jobs/:id/cancel`).
- Background job payloads containing customer phone numbers and third-party webhook credentials could be exfiltrated in plain text.

### 7.2 Implemented Security Controls

```text
Incoming HTTP Request (/api/v1/jobs/*)
  ├── 1. requireAuth: Validates active user session OR constant-time Internal Service Bearer Token
  ├── 2. requireAdmin: Enforces role === 'admin' (Returns 401 for unauthenticated, 403 for staff/cashiers)
  ├── 3. csrfProtection: Enforces double-submit CSRF token on POST/PUT/DELETE for session clients
  ├── 4. ID Validation: Enforces positive integer validation (Rejects malformed input with 400)
  ├── 5. Payload Sanitization: Masks customer phone numbers (***XXXX) and redacts secrets ([REDACTED])
  └── 6. Audit Logging: Records all retry/cancel mutations in immutable audit ledger
```

1. **Defense-in-Depth Deny-by-Default Authorization**:
   - Both the parent API router ([`src/routes/api.ts`](file:///c:/Projects/sri-tirmula-dryfruits/src/routes/api.ts)) and the sub-router ([`src/routes/job.ts`](file:///c:/Projects/sri-tirmula-dryfruits/src/routes/job.ts)) enforce `requireAuth` and `requireAdmin`.
   - Unauthenticated requests receive HTTP `401 Unauthorized` with standard API error format `{ success: false, error: { code: 'UNAUTHORIZED' } }`.
   - Authenticated non-admin users (customers, staff cashiers) receive HTTP `403 Forbidden` (`FORBIDDEN`).

2. **CSRF Protection on State-Changing Endpoints**:
   - `POST /api/v1/jobs/:id/retry` and `POST /api/v1/jobs/:id/cancel` require a valid CSRF token (`X-CSRF-Token` header or `_csrf` body parameter) for cookie-authenticated sessions. Missing or invalid tokens return HTTP `403 Forbidden` (`INVALID_CSRF`).

3. **Secure Internal Service Identity**:
   - Microservices, CLI cron jobs, and internal workers authenticate via `Authorization: Bearer <token>` or `x-service-key: <token>`.
   - Tokens are validated against `INTERNAL_SERVICE_KEY` / `JOB_SERVICE_TOKEN` (resolved via env vars, secret files, or Docker secrets) using `crypto.timingSafeEqual` to prevent timing attacks.
   - Requires a minimum key length of 16 characters. Validated service requests bypass browser CSRF checks.

4. **Sensitive Data Minimization & Payload Sanitization**:
   - All job queries (`GET /`, `GET /:id`, `POST /:id/retry`, `POST /:id/cancel`) sanitize job records via `sanitizeJob()`.
   - Customer phone numbers are masked to only reveal the last 4 digits (`***3210`).
   - Authentication tokens, API keys, passwords, and webhook secrets are replaced with `[REDACTED]`.

5. **Isolation of Internal In-Process Background Workers**:
   - The application's internal queue worker (`queueService.startWorker()`) processes jobs directly through database polling via [`src/queue/queue.repository.ts`](file:///c:/Projects/sri-tirmula-dryfruits/src/queue/queue.repository.ts) in-process.
   - Internal background job execution (such as WhatsApp delivery for customer checkouts and retry backoff) does not invoke the HTTP API and remains fully operational without administrative session dependency.

---

## 8. Secure Guest-to-Registered Customer Account Linking & Phone Verification (P0)

### 8.1 Vulnerability Overview & Threat Model (Finding AUTH-01)
In previous versions, the customer registration flow blindly upgraded existing guest customer records (created during POS or storefront guest checkout) without verifying ownership of the supplied phone number:
- An attacker entering a legitimate customer's phone number during registration automatically claimed that customer's database ID (`customers.id`).
- Upon registration or via unauthenticated `checkoutApi`, the attacker was immediately granted a session with `req.session.customer_id = guest.id`.
- The attacker could then inspect the victim's historical online orders (`/account/orders`), order details (`/account/orders/:id`), and saved delivery addresses (`/account/addresses`), resulting in **Customer Account Takeover (ATO)** and **Personally Identifiable Information (PII) Data Exfiltration**.

### 8.2 Architectural Controls & Mitigation Architecture

```text
User Registration / Account Link Request
  ├── 1. Phone Normalization: Converts Indian phone to canonical 91XXXXXXXXXX
  ├── 2. Identity Check: Rejects already registered accounts (passwords exist)
  ├── 3. Existing Guest Detection: Identifies unverified guest records matching phone
  │     └── If Guest Found: STRICTLY ENFORCES verified OTP ownership proof
  ├── 4. OTP Challenge Lifecycle:
  │     ├── Rate Limits: 60s resend cooldown + 5 challenges per 15 mins
  │     ├── Single-Use & Expiration: 5-minute TTL, max 5 attempts, single-use token
  │     ├── Cryptographic Hashing: Stored as HMAC-SHA256 hash using OTP_SECRET
  │     ├── Purpose Binding: Challenge bound to specific operation (REGISTRATION, ACCOUNT_LINK)
  │     └── Timing-Safe Verification: crypto.timingSafeEqual comparison
  ├── 5. Atomic Transactional Merge:
  │     ├── SQLite Transaction: db.transaction() ensures all-or-nothing execution
  │     ├── Single-Claim Invariant: Conditional UPDATE WHERE id = ? AND password_hash IS NULL
  │     └── Atomic Challenge Consumption: Marks consumed_at to block replay attacks
  ├── 6. Session Hardening:
  │     ├── Session Regeneration: Invokes req.session.regenerate() to prevent session fixation
  │     └── Strict Separation: Customer session (customer_id) isolated from Staff/Admin (user_id, role)
  └── 7. Anti-Enumeration: API returns uniform responses to prevent phone existence probing
```

### 8.3 OTP Delivery Provider Abstraction & Fail-Closed Policy

The application introduces `IOtpProvider` with two implementations:

1. **`WhatsAppOtpProvider` (Production)**:
   - Delivers 6-digit verification codes via Meta WhatsApp Cloud API using [`src/integrations/whatsapp/client.ts`](file:///c:/Projects/sri-tirmula-dryfruits/src/integrations/whatsapp/client.ts).
   - **Fail-Closed In Production**: If `WHATSAPP_ACCESS_TOKEN` or `WHATSAPP_PHONE_NUMBER_ID` are missing in `NODE_ENV === 'production'`, the provider throws an immediate configuration exception. It **never** bypasses verification or permits automatic record merging.

2. **`MockOtpProvider` (Development & Automated Tests)**:
   - Holds generated OTP challenges in memory for automated test verification.
   - **Production Guard**: Instantiating or invoking `MockOtpProvider` in `NODE_ENV === 'production'` immediately throws a fatal `Security Violation` error.

### 8.4 Database Schema & Invariants

Verification challenges are persisted in SQLite table `phone_verifications`:

```sql
CREATE TABLE IF NOT EXISTS phone_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('REGISTRATION', 'ACCOUNT_LINK', 'PHONE_UPDATE')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  resend_available_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_phone_verifications_active 
  ON phone_verifications(phone, purpose, consumed_at, expires_at);
```

### 8.5 Required Deployment Environment Variables

| Variable Name | Required In | Purpose | Security Notes |
| :--- | :---: | :--- | :--- |
| `WHATSAPP_ACCESS_TOKEN` | Production | Meta Cloud API Bearer Token | Injected via Docker secrets / environment. Never checked into git. |
| `WHATSAPP_PHONE_NUMBER_ID` | Production | Meta Cloud API Phone Number ID | Numeric sender ID configured in Meta WhatsApp Business Console. |
| `OTP_SECRET` / `OTP_SECRET_FILE` | Optional (Recommended) | Secret key for HMAC-SHA256 OTP hash computation | Falls back to `SESSION_SECRET` if not independently supplied. Minimum 32 characters recommended. |
| `NODE_ENV` | All | Application operational environment | Must be `production` in staging/production to lock down mock providers. |

