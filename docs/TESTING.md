# Automated Testing Strategy & QA Guide

## 1. Testing Philosophy & Quality Engineering Strategy

The Sri Tirumala Dry Fruits platform employs a **pyramid-based automated testing strategy** built on the high-performance **Vitest** test framework.

Because the system manages financial accounting, inventory stockouts, and physical cash registers, tests must be **deterministic, isolated, and zero-flake**.

```text
               ▲
              / \     E2E Tests (Customer, Staff POS, Online Fulfillment)
             /───\    Integration Tests (API -> Service -> Repository -> SQLite)
            /─────\   Unit Tests (Financial Math, State Machines, Cryptographic Hashes)
           /───────\
```

* **Runner**: Vitest 5.x with native TypeScript execution and ESM support.
* **HTTP Assertions**: Supertest for end-to-end HTTP request simulation.
* **Database Isolation**: Tests execute against SQLite with rollback transactions or deterministic cleanups, guaranteeing zero crosstalk between test files.
* **Total Coverage**: **29 Test Files | 248 Passing Tests (100% Pass Rate)**.

---

## 2. Test Suite Taxonomy & Structure

```text
tests/
├── unit/                                   # Pure domain logic & business calculations
│   ├── financial.unit.test.ts              # 18 tests: Revenue, profit margin, COGS, AOV, zero-div guards
│   ├── pricing-discounts-tax-delivery.unit.test.ts # 15 tests: GST calculations, discounts, delivery tiers
│   ├── inventory-reservations.unit.test.ts # 7 tests: Reservation leases, commit, release
│   ├── order-state-machine.unit.test.ts    # 9 tests: Transition validation & illegal state rejection
│   ├── audit.unit.test.ts                  # 20 tests: SQLite triggers, SHA-256 hash chaining, 12 events
│   └── seo.unit.test.ts                    # 12 tests: Meta tags, JSON-LD schemas, robots, sitemaps
│
├── integration/                            # API -> Service -> Repository -> Database
│   ├── analytics.test.ts                   # 13 tests: Dashboard metrics, multi-dimensional filters, API
│   ├── audit.test.ts                       # 13 tests: RBAC shields, customer isolation, real-time logging
│   ├── billing.test.ts                     # 2 tests: POS billing transactions & stock decrement
│   ├── inventory.test.ts                   # 5 tests: Inventory ledger movements & reservations
│   ├── reservation.test.ts                 # 3 tests: Concurrent purchase race conditions
│   ├── variants.test.ts                    # 4 tests: Multi-size pricing & barcode uniqueness
│   └── whatsapp.test.ts                    # 5 tests: Meta API delivery, retry queue, idempotency
│
├── e2e/                                    # Full user journey simulation
│   ├── customer-journey.e2e.test.ts        # Register -> Browse -> Cart -> Checkout -> Order History
│   ├── staff-pos.e2e.test.ts               # Open Shift -> Barcode Bill -> Payment -> Receipt -> Close Shift
│   └── online-fulfillment.e2e.test.ts      # New Order -> Confirm -> Packing -> Ready -> Dispatch -> Complete
│
└── security/                               # Offensive security verification
    ├── csrf.test.ts                        # Double-submit cookie verification
    ├── rate-limiting.test.ts               # Login & checkout flood throttling
    ├── bola-idor.test.ts                   # Cross-customer order access shielding
    └── webhook-tamper.test.ts              # HMAC SHA-256 signature verification
```

---

## 3. Key Test Suites & Assertions

### 3.1 Financial Calculation Unit Tests (`tests/unit/financial.unit.test.ts`)
* Validates currency rounding without floating-point drift (IEEE-754 precision defense).
* Verifies Net Revenue calculation after deductions: $\text{Gross Revenue} - \text{Discount} + \text{Delivery Charges}$.
* Checks safe zero-revenue division-by-zero handling in Profit Margin and AOV formulas.
* Tests customer retention, cancellation, and WhatsApp conversion ratios.

### 3.2 Audit Log Immutability Tests (`tests/unit/audit.unit.test.ts`)
* Proves SQLite database engine triggers reject direct `UPDATE` queries on `audit_logs` table.
* Proves SQLite database engine triggers reject direct `DELETE` queries on `audit_logs` table.
* Verifies sequential cryptographic SHA-256 parent hash chaining (`prev_hash` $\to$ `hash`).
* Validates complete tracking coverage across all 12 enterprise event actions.

### 3.3 Security & BOLA Isolation Tests (`tests/integration/audit.test.ts`)
* Verifies unauthenticated visitors are redirected from administrative views.
* Verifies operational staff cannot access internal audit data.
* Verifies ordinary customers are completely shielded from internal audit logs.
* Verifies tamper-evident integrity check endpoint (`GET /api/v1/audit-logs/verify`).

---

## 4. Running the Tests Locally

```bash
# Run the complete test suite (all 29 files, 248 tests)
npm test

# Run tests with single-process isolation (prevents SQLite file locks)
npx vitest run --fileParallelism=false

# Run a specific test suite
npx vitest run tests/unit/financial.unit.test.ts

# Run tests in interactive watch mode
npx vitest

# Run with test coverage report
npm run test:coverage
```

---

## 5. Continuous Integration (CI/CD) Pipeline

The automated test suite runs on every pull request and push to `main` via GitHub Actions ([`.github/workflows/ci.yml`](file:///c:/Projects/sri-tirmula-dryfruits/.github/workflows/ci.yml)):

```text
Job: Test & Quality Gate
  ├── Step 1: Checkout repository
  ├── Step 2: Setup Node.js 20 & install dependencies (`npm ci`)
  ├── Step 3: TypeScript compilation check (`npx tsc --noEmit`)
  ├── Step 4: Run unit & integration tests (`npx vitest run --fileParallelism=false`)
  ├── Step 5: Security vulnerability audit (`npm audit --audit-level=high`)
  └── Step 6: Artifact verification (ensures zero .env files or credentials leaked)
```

The pipeline strictly blocks merging if any test fails or if TypeScript compilation reports errors.
