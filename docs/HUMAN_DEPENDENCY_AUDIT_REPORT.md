# Human Dependency Audit & Technical Inspection Report
**Role:** Principal DevOps Engineer & Technical Auditor  
**Target:** `Sri Tirumala Dry Fruits` E-Commerce & Retail POS Platform  
**Date:** October 18, 2026  
**Status:** Audit Complete  

---

## 1. Project X-Ray (Plain English Summary)

This project is a **monolithic, server-rendered Node.js & TypeScript web application** combining a customer-facing dry fruits e-commerce storefront, an in-store POS (Point of Sale) billing terminal, an inventory reservation engine, and an automated backup/auditing daemon.

* **Frontend:**
  * Server-Side Rendered (SSR) with **EJS (Embedded JavaScript)** templates (`views/`).
  * Vanilla CSS with modern custom design tokens, glassmorphism, responsive navigation drawers, and GSAP micro-animations.
  * Client-side vanilla JavaScript (`public/storefront.js`, `public/js/billing.js`) for cart state, barcode scanning, POS calculations, and UPI payment QR generation.
  * **No complex frontend framework:** Zero build step needed for React, Angular, or Vue.
* **Backend:**
  * **Node.js** running an **Express.js** HTTP application in ES Module mode (`"type": "module"`).
  * Written in **TypeScript** (transpiled to `dist/` for production or run with `tsx` in development).
  * Built-in security suite: `helmet` for Content Security Policy, `cookie-parser`, `express-session`, custom CSRF double-submit protection, `express-rate-limit`, and `bcryptjs` password hashing.
  * Observability: Structured JSON logging with `winston`, OpenTelemetry tracing, and Prometheus metrics endpoint at `/metrics`.
  * Background Workers: SQLite-backed durable task queue (`src/queue/`), automated backup cron (`node-cron`), and inventory reservation reaper.
* **Database:**
  * Embedded **SQLite3** via `better-sqlite3` running in WAL (Write-Ahead Logging) mode.
  * Main database file lives at `data/store.db`.
  * Session database lives at `data/sessions.db`.
  * **Zero cloud database services required:** No PostgreSQL, MySQL, MongoDB Atlas, Supabase, or Firebase.
* **AI Models:**
  * **None.** There are zero runtime AI model calls or OpenAI/Anthropic/Gemini API dependencies.
* **Payment Gateways:**
  * **Zero payment gateway accounts (no Stripe, Razorpay, or PayPal).** The store relies on direct **Cash on Delivery (COD)** and **Instant Dynamic UPI QR Codes** (`upi://pay?...`) generated directly in browser views.
* **External Cloud Services:**
  * **Meta for Developers / WhatsApp Cloud API** (`graph.facebook.com`): Used for customer passwordless mobile OTP verification and order alerts (NEW, PACKING, READY, COMPLETED, CANCELLED).
  * *Mock Fallback:* In `development` and `test` environments, a built-in mock OTP provider logs OTP codes to the terminal so Meta accounts are not needed locally.

---

## 2. Missing Environment Variables & Secrets (.env Audit)

The application reads configuration from `.env` in the project root. When running in `development` or `test` mode, fallback mock providers prevent crashes; however, **setting `NODE_ENV=production` triggers strict assertions that intentionally crash the server on boot if security keys or production URLs are missing or use default values.**

### Summary Matrix

| Variable Name | Required in Dev? | Required in Prod? | Purpose | Default / Example |
| :--- | :---: | :---: | :--- | :--- |
| `PORT` | Optional | Optional | Express server port | `3000` |
| `NODE_ENV` | Yes | Yes | Execution environment | `development` |
| `SITE_URL` | Optional | **YES** | Canonical origin & SEO base | `http://localhost:3000` |
| `SESSION_SECRET` | Optional | **YES** | Session cookie signature | Generated 64-char hex |
| `COOKIE_SECRET` | Optional | **YES** | Signed cookie HMAC secret | Generated 64-char hex |
| `OTP_SECRET` | Optional | Optional | One-Time Password hash salt | Generated 32-char hex |
| `INTERNAL_SERVICE_KEY` | Optional | Recommended | Background worker API key | Generated 64-char hex |
| `STORE_WHATSAPP_PHONE` | Optional | Optional | Customer support WhatsApp number | `919133133931` |
| `FREE_DELIVERY_THRESHOLD` | Optional | Optional | Cart subtotal for free shipping | `500` |
| `DELIVERY_CHARGE` | Optional | Optional | Shipping fee below threshold | `50` |
| `WHATSAPP_ACCESS_TOKEN` | Optional | **YES** | Meta WhatsApp Graph API token | System user access token |
| `WHATSAPP_PHONE_NUMBER_ID`| Optional | **YES** | WhatsApp business phone ID | 15-digit Meta ID |
| `WHATSAPP_OTP_TEMPLATE` | Optional | Optional | Approved message template name | `auth_otp_code` |
| `WHATSAPP_VERIFY_TOKEN` | Optional | Optional | Webhook handshake token | Alphanumeric passphrase |
| `WHATSAPP_APP_SECRET` | Optional | Recommended | Webhook HMAC verification | Meta App Secret |

---

### Detailed Variable Breakdown

#### 1. `PORT`
* **What it is:** The local network port the Express HTTP server listens on (defaults to `3000`).
* **How I get it:** Choose any available port on your machine (e.g. `3000`, `8080`).
* **Where to put it:** `.env` (Line 1)
```env
PORT=3000
```

#### 2. `NODE_ENV`
* **What it is:** Controls application mode (`development`, `test`, or `production`).
* **How I get it:** Set to `development` for local work, or `production` for live deployments.
* **Where to put it:** `.env` (Line 2)
```env
NODE_ENV=development
```

#### 3. `SITE_URL`
* **What it is:** The canonical base URL used for canonical redirects, sitemap generation, and SEO schemas.
* **How I get it:** Use `http://localhost:3000` for local development. In production, it **must** be `https://sritirumaladryfruits.com` (enforced by `src/config/site.ts`).
* **Where to put it:** `.env` (Line 3)
```env
SITE_URL=http://localhost:3000
```

#### 4. `SESSION_SECRET`
* **What it is:** A cryptographic secret used to sign session cookies (`connect.sid`).
* **How I get it:** Generate in your terminal:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
* **Where to put it:** `.env` (Line 4)
```env
SESSION_SECRET=<paste_generated_64_char_hex_here>
```

#### 5. `COOKIE_SECRET`
* **What it is:** A cryptographic secret used by `cookie-parser` to sign and verify cookies.
* **How I get it:** Generate in your terminal:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
* **Where to put it:** `.env` (Line 5)
```env
COOKIE_SECRET=<paste_generated_64_char_hex_here>
```

#### 6. `OTP_SECRET`
* **What it is:** HMAC salt key used to hash one-time passwords before storing in `phone_verifications`.
* **How I get it:** Generate in your terminal:
  ```bash
  node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
  ```
* **Where to put it:** `.env` (Line 6)
```env
OTP_SECRET=<paste_generated_32_char_hex_here>
```

#### 7. `INTERNAL_SERVICE_KEY`
* **What it is:** High-entropy bearer token allowing internal background processes or cron jobs to call protected APIs without a browser session.
* **How I get it:** Generate in your terminal:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
* **Where to put it:** `.env` (Line 7)
```env
INTERNAL_SERVICE_KEY=<paste_generated_64_char_hex_here>
```

#### 8. `STORE_WHATSAPP_PHONE`
* **What it is:** The official WhatsApp phone number displayed on bills and customer support links.
* **How I get it:** Your retail phone number with country code (e.g. `919133133931`).
* **Where to put it:** `.env` (Line 9)
```env
STORE_WHATSAPP_PHONE=919133133931
```

#### 9. `FREE_DELIVERY_THRESHOLD` & `DELIVERY_CHARGE`
* **What it is:** Minimum cart subtotal in Rupees to qualify for free shipping, and standard delivery charge if below threshold.
* **How I get it:** Business decision (e.g., `500` and `50`).
* **Where to put it:** `.env` (Lines 10–11)
```env
FREE_DELIVERY_THRESHOLD=500
DELIVERY_CHARGE=50
```

#### 10. `WHATSAPP_ACCESS_TOKEN`
* **What it is:** Meta System User access token used to authenticate requests to the Facebook Graph API.
* **How I get it:**
  1. Visit [developers.facebook.com](https://developers.facebook.com/) and log in.
  2. Select **My Apps** &rarr; Select (or create) a **Business App**.
  3. Under Add Products, select **WhatsApp** &rarr; **API Setup**.
  4. Copy the Temporary Token or generate a permanent token in **Business Manager &rarr; System Users &rarr; Generate New Token** with permissions `whatsapp_business_messaging` and `whatsapp_business_management`.
* **Where to put it:** `.env` (Line 13)
```env
WHATSAPP_ACCESS_TOKEN=<your_meta_system_user_token>
```

#### 11. `WHATSAPP_PHONE_NUMBER_ID`
* **What it is:** The 15-digit unique identifier for the registered WhatsApp Business phone number.
* **How I get it:** On [developers.facebook.com](https://developers.facebook.com/), go to **WhatsApp &rarr; API Setup** and copy the **Phone number ID**.
* **Where to put it:** `.env` (Line 14)
```env
WHATSAPP_PHONE_NUMBER_ID=<your_phone_number_id>
```

#### 12. `WHATSAPP_OTP_TEMPLATE`
* **What it is:** Pre-approved WhatsApp message template name used to deliver OTP verification codes.
* **How I get it:** Create an **Authentication** template named `auth_otp_code` on [business.facebook.com/wa/manage/message-templates/](https://business.facebook.com/wa/manage/message-templates/).
* **Where to put it:** `.env` (Line 15)
```env
WHATSAPP_OTP_TEMPLATE=auth_otp_code
```

#### 13. `WHATSAPP_VERIFY_TOKEN`
* **What it is:** Secret handshake token to verify incoming Meta Webhooks.
* **How I get it:** Create any random alphanumeric string (e.g., `stdf_meta_webhook_secret_2026`).
* **Where to put it:** `.env` (Line 16)
```env
WHATSAPP_VERIFY_TOKEN=stdf_meta_webhook_secret_2026
```

#### 14. `WHATSAPP_APP_SECRET`
* **What it is:** Meta App Secret used to compute HMAC SHA-256 signatures (`x-hub-signature-256`) on incoming webhooks.
* **How I get it:** In Meta App Dashboard, go to **App Settings &rarr; Basic &rarr; App Secret &rarr; Show**.
* **Where to put it:** `.env` (Line 17)
```env
WHATSAPP_APP_SECRET=<your_meta_app_secret>
```

---

## 3. External Dashboard & Cloud Configurations

### A. Database Setup
* **External Cloud Cluster Needed?** **NO.** You do not need MongoDB Atlas, Supabase, Neon, Firebase, or AWS RDS.
* **Local Database Daemon Needed?** **NO.** SQLite runs embedded in-process inside Node.js.
* **Schema Creation:** Automatic. `src/database.ts` executes `CREATE TABLE IF NOT EXISTS` for all 24 tables and creates required indexes and triggers on boot.
* **Account Seeding:** Default administrator and cashier accounts are seeded via:
  ```bash
  npm run db:reset
  ```
  * **Admin:** Username: `admin` | Password: `admin123`
  * **Staff:** Username: `staff` | Password: `staff123`

### B. Authentication & Webhooks
* **OAuth Providers (Google, Apple, Auth0, Clerk):** **None.** Staff login uses username/password with bcrypt and HTTP sessions. Customer login uses mobile number OTP.
* **Meta WhatsApp Webhook Configuration (Optional for Inbound Delivery Receipts):**
  1. For local testing, start an HTTPS tunnel (Meta requires public HTTPS):
     ```bash
     npx ngrok http 3000
     ```
  2. In **Meta Developer Dashboard &rarr; WhatsApp &rarr; Configuration**:
     * **Callback URL:** `https://<your-ngrok-or-domain>/api/v1/whatsapp/webhook`
     * **Verify Token:** Paste the exact string from `WHATSAPP_VERIFY_TOKEN`.
     * **Webhook Fields:** Subscribe to `messages`.

### C. CORS & Whitelisting
* **Database Whitelisting:** None needed (local file).
* **Content Security Policy (CSP):** Enforced in `server.ts` via `helmet`. Whitelisted CDNs: `'self'`, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`).

### D. Billing & Quotas
* **Meta WhatsApp Cloud API:**
  * Free tier includes **1,000 service-initiated conversations per month**.
  * When using Meta test credentials, your personal phone number must be added to the **To** recipient whitelist in **WhatsApp &rarr; API Setup**.
* **Zero AI Billing:** No OpenAI, Anthropic, or cloud API subscription fees.

---

## 4. Local System Prerequisites

| Component | Minimum Version | Purpose | Verification Command |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v18.18.0` or `v20.x` (LTS) | JavaScript execution runtime | `node -v` |
| **npm** | `v9.x` or `v10.x` | Node package manager | `npm -v` |
| **C++ Build Tools** | Python 3 + C++ Compiler | Compiles `better-sqlite3` native binaries | `python --version` |

### Environment Verification Commands
Run in PowerShell or terminal:
```powershell
node -v
npm -v
python --version
```
*(If `better-sqlite3` fails to compile on Windows, install the Visual Studio C++ Build Tools or run `npm install --global --production windows-build-tools` in an administrative shell).*

---

## 5. Exact Ignition Sequence

Follow these steps in chronological order:

```powershell
# 1. Prepare Environment File
Copy-Item .env.example .env

# Ensure NODE_ENV=development in .env for local mock provider mode

# 2. Install Project Dependencies
npm.cmd install

# 3. Initialize & Seed SQLite Database
# (Creates tables, sets up 6 categories, and seeds admin / staff logins)
npm.cmd run db:reset

# 4. Run Code Quality & Security Scanners
npm.cmd run typecheck
npm.cmd run security:scan

# 5. Run the Automated Test Suite (468 passing tests)
npm.cmd test

# 6. Launch Local Development Server
npm.cmd run dev
```

### Accessing the Running Application
* **Storefront:** [http://localhost:3000](http://localhost:3000)
* **POS & Billing Terminal:** [http://localhost:3000/sell](http://localhost:3000/sell)
* **Staff/Admin Login:** [http://localhost:3000/login](http://localhost:3000/login)
  * **Admin:** Username: `admin` | Password: `admin123`
  * **Cashier:** Username: `staff` | Password: `staff123`
* **System Health Check:** [http://localhost:3000/health](http://localhost:3000/health)
* **Prometheus Metrics:** [http://localhost:3000/metrics](http://localhost:3000/metrics)

---

## 6. Diagnostic Command

If any test or command fails during setup, run:
```powershell
npm.cmd test -- --bail 1
```
*(This stops execution on the first failure and prints the full stack trace and error message).*
