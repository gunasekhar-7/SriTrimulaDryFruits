# Changelog

All notable changes to the **Sri Tirumala Dry Fruits** platform are documented in this file in accordance with [Semantic Versioning (SemVer 2.0.0)](https://semver.org/).

---

## [2.4.0] - 2026-10-10

### Added
* **Immutable Audit Log Subsystem**:
  * SQLite database engine triggers (`prevent_audit_log_update`, `prevent_audit_log_delete`) preventing any direct modification or deletion of historical audit logs.
  * SHA-256 parent hash chaining (`prev_hash` $\to$ `hash`) creating a tamper-evident cryptographic ledger across all historical records.
  * Comprehensive event tracking for 12 enterprise actions: `LOGIN`, `FAILED_LOGIN`, `PRODUCT_CREATE`, `PRODUCT_UPDATE`, `PRICE_MODIFY`, `INVENTORY_ADJUST`, `ORDER_CONFIRM`, `ORDER_CANCEL`, `RETURN`, `REFUND`, `ROLE_CHANGE`, and `POS_CONVERT`.
  * Dedicated Admin Audit Explorer (`/admin/audit-logs`) with multi-dimensional filtering (action, entity, date range, free text query), payload inspector modal, and CSV/JSON export.
  * Cryptographic integrity verification endpoint (`GET /api/v1/audit-logs/verify`).
* **Automated Unit & Integration Test Suites**:
  * 33 tests in `tests/unit/audit.unit.test.ts` and `tests/integration/audit.test.ts` validating trigger defense, hash chaining, customer data shielding, and real-time logging.

---

## [2.3.0] - 2026-10-09

### Added
* **Executive Product Analytics Dashboard**:
  * Centralized financial calculation logic (`src/utils/financial.ts`) with zero formula duplication across routes and views.
  * Safe division-by-zero handling and IEEE-754 precision defense for all financial metrics.
  * Tracking of 13 core metrics: Today's Revenue, Weekly Revenue (7d), Monthly Revenue (30d), All-Time Benchmark, POS Revenue, Online Revenue, Order Count, Average Order Value (AOV), Repeat Customers Rate, Cancellation Rate, Depleted Stockouts, and WhatsApp Conversion Rate.
  * Interactive slice-and-dice filter toolbar: date presets (`today`, `7d`, `30d`, `month`, `year`, `all`), custom start/end date pickers, category dropdown, variant selector, channel split (`ALL`, `POS`, `ONLINE`), and status filter (`ALL`, `COMPLETED`, `CANCELLED`, `PENDING`).
  * Chart.js visualizations for daily revenue trendlines and category revenue doughnut distributions.
  * Product leaderboards for Top 10 Best Sellers (by volume and revenue) and Top 10 Most Profitable Products (by net profit and margin %).
  * Client-side CSV export and print-optimized executive layout (`@media print`).
  * REST Reporting API (`GET /api/v1/analytics`).

---

## [2.2.0] - 2026-10-08

### Added
* **Modern Omnichannel Storefront & UX Overhaul**:
  * Responsive navigation bar with search, category pills, wishlist badge, cart drawer counter, and customer account portal.
  * Fast client-side and server-side product search with instant category filtering.
  * Customer authentication: signup, login, password hashing, and profile management.
  * Delivery address book with default selection and postal validation.
  * Stock reservation state machine (`ACTIVE`, `COMMITTED`, `RELEASED`) with expiration handling.
  * Online checkout supporting Cash on Delivery (COD) and dynamic UPI QR code generator.
  * Order status tracking portal with visual progress timeline.
* **Technical SEO Engine**:
  * Automated metadata generation: dynamic page titles, unique meta descriptions, canonical URLs.
  * Open Graph and Twitter Card social preview tags.
  * Rich JSON-LD structured data (`Organization`, `LocalBusiness`, `Product`, `BreadcrumbList`).
  * Dynamic `robots.txt` and `sitemap.xml` with automatic URL harvesting.
  * Shielding private customer and administrative routes from search engines (`noindex, nofollow`).

---

## [2.1.0] - 2026-10-07

### Added
* **Production Container Hardening & Multi-Stage Dockerfile**:
  * Multi-stage build separating TypeScript compilation from runtime environment.
  * Unprivileged non-root execution (`node:node` / UID 1000).
  * `security_opt: [no-new-privileges:true]`, `cap_drop: [ALL]`, and `tmpfs` mounts.
  * Native Node.js healthcheck probe (`/health`) with automatic recovery.
  * Environment profiles: `docker-compose.staging.yml` and `docker-compose.prod.yml`.
  * Graceful shutdown handlers honoring in-flight requests and executing `PRAGMA wal_checkpoint(TRUNCATE)`.

---

## [2.0.0] - 2026-10-06

### Added
* **Comprehensive Quality Engineering & QA Automation Framework**:
  * Upgraded test infrastructure to Vitest with native TypeScript execution.
  * 27 test files covering unit, integration, end-to-end, and offensive security tests.
  * Integration tests simulating complete customer checkout, staff POS cashier shifts, and online order fulfillment.
  * Security tests asserting defense against BOLA/IDOR, CSRF bypass, brute force, and duplicate webhooks.

---

## [1.9.0] - 2026-10-05

### Added
* **Durable Background Job Queue**:
  * In-process SQLite-backed task queue decoupled from synchronous HTTP request threads.
  * Exponential backoff retry algorithm with randomized jitter.
  * Dead-letter `FAILED` state preservation with detailed error stack logging.
  * Idempotency key deduplication preventing duplicate WhatsApp messaging.
  * Admin dashboard for monitoring and manually retrying background jobs (`/jobs`).

---

## [1.8.0] - 2026-10-04

### Added
* **OpenTelemetry Distributed Tracing & Prometheus Observability**:
  * W3C `traceparent` context propagation across HTTP requests, database transactions, background queue workers, and WhatsApp webhooks.
  * Prometheus metrics exporter (`GET /metrics`) capturing latency histograms, status counters, and database query durations.
  * Real-time technical and business telemetry snapshot API (`GET /observability/metrics`).

---

## [1.5.0] - 2026-09-25

### Added
* **Full TypeScript & Express.js Modular Architecture**:
  * Complete migration from legacy Python scripts to typed TypeScript codebase.
  * Controller-Service-Repository architecture with clean domain separation.
  * Native SQLite access via `better-sqlite3` configured with Write-Ahead Logging (WAL).
  * Double-submit cookie CSRF protection and Winston structured logging.

---

## [1.0.0] - 2026-09-01

### Added
* Initial Point-of-Sale (POS) counter billing system.
* Cashier register shifts with opening/closing cash drawer reconciliation.
* Thermal 80mm PDF receipt printing.
* Inventory tracking with cost and selling price margins.
