# System Architecture & Technical Design

## 1. Executive Summary & Architectural Principles

Sri Tirumala Dry Fruits is a production-grade, hybrid retail application engineered to power both a high-throughput physical Point-of-Sale (POS) counter and an omnichannel online e-commerce storefront.

### Core Architectural Pillars

1. **Monolithic Efficiency with Asynchronous Decoupling**:
   - The application is architected as a modular TypeScript/Node.js monolith utilizing Express.js.
   - Synchronous HTTP request-response cycles are strictly isolated from non-critical or external I/O (such as WhatsApp notifications, invoice generation, cloud backup synchronization, and reporting aggregations) via an in-process, SQLite-backed durable background queue.
2. **Local-First, Zero-Latency Data Layer (SQLite with WAL)**:
   - For single-location retail operations, SQLite operating in Write-Ahead Logging (WAL) mode eliminates network socket hops, delivering sub-millisecond read/write performance essential for rapid barcode scanning and physical billing desk operations.
   - Strict database constraints (`CHECK (total_qty - sold_qty >= 0)`) provide immediate concurrency protection against stock over-allocation.
3. **Omnichannel Harmonization**:
   - Online storefront orders and physical POS bills share a unified inventory catalog, reservation ledger, and customer repository.
   - The system supports seamless **POS Conversion**: online click-and-collect orders can be pushed directly into the physical billing desk register with automated reservation release.
4. **End-to-End Auditability & Tracing**:
   - OpenTelemetry-compatible distributed tracing tracks workflows across HTTP gateways, service layers, database operations, background queues, and external webhooks using standard W3C `traceparent` headers.
   - Every administrative, financial, and inventory alteration is captured in an append-only, cryptographically hash-chained immutable audit log.

---

## 2. High-Level System Architecture

The following diagram illustrates the overarching system architecture, separating client tiers, application boundaries, background subsystems, and storage engines:

```mermaid
graph TB
    subgraph Clients["Client Tier"]
        POSClient["Staff POS Terminal (Browser / Barcode Scanner)"]
        StorefrontClient["Online Customers (Desktop / Mobile)"]
        AdminClient["Admin Dashboard (Analytics / Audit)"]
    end

    subgraph Edge["Edge & Security Layer"]
        Nginx["Reverse Proxy (TLS Termination / Gzip)"]
        RateLimiter["Rate Limiter (Express Rate Limit)"]
        SecurityMW["Security Headers (Helmet / CSRF / CORS)"]
    end

    subgraph AppServer["Application Core (Node.js / Express / TypeScript)"]
        Router["Modular Router (Auth / Store / Billing / Admin / API)"]
        AuthService["Auth & RBAC Service (Bcrypt / Sessions)"]
        OrderService["Order Service & State Machine"]
        BillingService["Billing Service (POS / Invoicing)"]
        InventoryService["Inventory & Reservation Engine"]
        AnalyticsService["Financial & Analytics Engine"]
        AuditService["Immutable Audit Service"]
        OtelTelemetry["OpenTelemetry Tracing & Prometheus Metrics"]
    end

    subgraph BackgroundTier["Asynchronous Background Subsystem"]
        JobQueue["Durable Background Queue (SQLite Table)"]
        QueueWorker["Background Queue Worker (Exponential Backoff)"]
        MetaClient["WhatsApp Cloud API Client (Axios)"]
        PDFGenerator["PDF Receipt Engine (PDFKit)"]
        BackupWorker["Hourly Snapshot & Offsite Cloud Sync"]
    end

    subgraph StorageTier["Storage Layer (Data Directory)"]
        MainDB[("store.db (SQLite WAL Mode)")]
        SessionsDB[("sessions.db (SQLite Session Store)")]
        BackupStorage[("backups/ (Daily Gzip & Verified Snapshots)")]
    end

    POSClient --> Nginx
    StorefrontClient --> Nginx
    AdminClient --> Nginx

    Nginx --> RateLimiter --> SecurityMW --> Router

    Router --> AuthService
    Router --> OrderService
    Router --> BillingService
    Router --> InventoryService
    Router --> AnalyticsService
    Router --> AuditService

    OrderService -.-> JobQueue
    BillingService -.-> JobQueue
    BackupWorker -.-> MainDB

    JobQueue --> QueueWorker
    QueueWorker --> MetaClient
    QueueWorker --> PDFGenerator

    AuthService --> MainDB
    OrderService --> MainDB
    BillingService --> MainDB
    InventoryService --> MainDB
    AnalyticsService --> MainDB
    AuditService --> MainDB
    Router --> SessionsDB

    AppServer -.-> OtelTelemetry
```

---

## 3. POS Checkout Sequence

Physical in-store transactions require sub-second responsiveness. The checkout sequence executes atomically within a single SQLite database transaction to guarantee stock consistency:

```mermaid
sequenceDiagram
    autonumber
    actor Staff as Cashier (POS Desk)
    participant POSUI as POS Terminal UI
    participant BillCtrl as Billing Controller
    participant BillSvc as Billing Service
    participant Repo as Bill & Sale Repository
    participant InvRepo as Inventory Repository
    participant DB as SQLite (store.db)
    participant Audit as Audit Service

    Staff->>POSUI: Scan Barcode / Add Items to Cart
    Staff->>POSUI: Apply Discount & Select Payment (Cash/UPI/Card)
    Staff->>POSUI: Press F2 / Click "Generate Bill"
    POSUI->>BillCtrl: POST /bill (Cart Items, Customer Info, Discount)
    BillCtrl->>BillSvc: createBill(date, time, items, discount, paymentMethod, shiftId)
    
    rect rgb(240, 248, 255)
        note over BillSvc,DB: Atomic Database Transaction
        BillSvc->>DB: BEGIN TRANSACTION
        BillSvc->>Repo: INSERT INTO bills (...)
        loop For each Cart Item
            BillSvc->>DB: UPDATE product_variants SET sold_qty = sold_qty + qty WHERE id = ?
            note right of DB: Verified by CHECK (total_qty - sold_qty >= 0)
            BillSvc->>InvRepo: INSERT INTO stock_movements (type: 'POS_SALE')
            BillSvc->>Repo: INSERT INTO sales (bill_id, variant_id, qty, profit, unit_price)
        end
        BillSvc->>DB: COMMIT TRANSACTION
    end

    BillSvc->>Audit: recordAuditLog(action: 'BILL_CREATE' / 'POS_SALE')
    BillSvc-->>BillCtrl: Bill Created (#1042)
    BillCtrl-->>POSUI: Redirect to /print_bill/1042 (PDF Thermal Receipt)
    POSUI->>Staff: Render 80mm PDF Receipt / Open Cash Drawer
```

---

## 4. Online Checkout Sequence

Online checkout integrates stock reservation guarantees, payment mode selection, and asynchronous WhatsApp notification queuing:

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Online Shopper
    participant StoreUI as Web Storefront
    participant StoreCtrl as Store Controller
    participant OrderSvc as Order Service
    participant StateMachine as Order State Machine
    participant InvRepo as Inventory Repository
    participant Queue as Durable Queue Service
    participant DB as SQLite (store.db)
    actor Admin as Store Staff / Admin

    Customer->>StoreUI: Add Items to Cart & Proceed to Checkout
    Customer->>StoreUI: Enter Delivery Address, Select Mode (COD / UPI QR)
    StoreUI->>StoreCtrl: POST /store/checkout (Name, Phone, Items, PaymentMode)
    StoreCtrl->>OrderSvc: createOnlineOrder(data)

    rect rgb(245, 255, 245)
        note over OrderSvc,DB: Atomic Reservation & Order Creation
        OrderSvc->>DB: BEGIN TRANSACTION
        OrderSvc->>InvRepo: Verify Stock Availability (total - sold - reserved >= qty)
        OrderSvc->>DB: INSERT INTO online_orders (status: 'NEW', ...)
        loop For each Item
            OrderSvc->>DB: INSERT INTO online_order_items (...)
            OrderSvc->>InvRepo: reserveStock(variant_id, qty, order_id)
            OrderSvc->>InvRepo: INSERT INTO stock_movements (type: 'RESERVATION')
        end
        OrderSvc->>DB: INSERT INTO order_status_logs (new_status: 'NEW')
        OrderSvc->>DB: COMMIT TRANSACTION
    end

    OrderSvc->>Queue: enqueue("whatsapp_notification", { orderId, status: "NEW", phone })
    note right of Queue: Order creation succeeds even if WhatsApp API is down!
    OrderSvc-->>StoreCtrl: Order STDF-2026-0842 Created
    StoreCtrl-->>StoreUI: Render Order Confirmation & Tracking Page

    Admin->>StoreUI: Admin Confirms Order in Admin Portal
    StoreUI->>OrderSvc: updateOrderStatus(orderId, 'CONFIRMED', actor)
    OrderSvc->>StateMachine: validateTransition('NEW' -> 'CONFIRMED')
    OrderSvc->>Queue: enqueue("whatsapp_notification", { status: "CONFIRMED" })
```

---

## 5. Order Lifecycle State Machine

The online order lifecycle is strictly enforced by a finite state machine (`src/services/order-state-machine.ts`). Invalid status transitions are rejected at the business logic layer:

```mermaid
stateDiagram-v2
    [*] --> NEW : Customer Places Order (Stock Reserved)
    
    NEW --> CONFIRMED : Admin Confirms Order
    NEW --> CANCELLED : Customer / Admin Cancels (Reservation Released)

    CONFIRMED --> PACKING : Store Staff Begins Packing
    CONFIRMED --> CANCELLED : Admin Cancels (Reservation Released)

    PACKING --> READY : Items Packed & Verified
    PACKING --> CANCELLED : Admin Cancels (Reservation Released)

    READY --> DISPATCHED : Handed to Delivery Driver
    READY --> COMPLETED : Customer Collects via Store Pickup (Reservation Committed)
    READY --> CANCELLED : Cancelled (Reservation Released)

    DISPATCHED --> COMPLETED : Delivered & Payment Collected (Reservation Committed)
    DISPATCHED --> CANCELLED : Delivery Failed / Returned (Inventory Restocked)

    COMPLETED --> [*]
    CANCELLED --> [*]

    note right of COMPLETED
        Stock reservation is committed:
        sold_qty incremented,
        stock movement ONLINE_SALE logged.
    end note

    note right of CANCELLED
        Active reservations released:
        reserved_qty decremented,
        available stock instantly restored.
    end note
```

### Transition Validation Rules

| Current Status | Allowed Target Statuses | Inventory Action |
| :--- | :--- | :--- |
| `NEW` | `CONFIRMED`, `CANCELLED` | On Cancel: Release reservation (`reserved_qty -= qty`). |
| `CONFIRMED` | `PACKING`, `CANCELLED` | On Cancel: Release reservation (`reserved_qty -= qty`). |
| `PACKING` | `READY`, `CANCELLED` | On Cancel: Release reservation (`reserved_qty -= qty`). |
| `READY` | `DISPATCHED`, `COMPLETED`, `CANCELLED` | On Complete: Commit reservation (`sold_qty += qty`). |
| `DISPATCHED` | `COMPLETED`, `CANCELLED` | On Complete: Commit reservation (`sold_qty += qty`). |
| `COMPLETED` | `CANCELLED` (Admin Return Only) | On Cancel: Restock sold item (`sold_qty -= qty`, `RETURN` logged). |
| `CANCELLED` | Terminal State | None (No transitions permitted). |

---

## 6. Durable Background Queue Architecture

To maintain high throughput and reliability, non-critical background jobs never block synchronous HTTP request threads.

### Queue Characteristics
* **Persistence**: Stored durably in the `background_jobs` SQLite table. Unprocessed jobs survive application restarts and container crashes.
* **Polling & Locking**: A lightweight polling supervisor (`setInterval(..., 3000)`) queries for pending jobs with `status = 'PENDING'` and `run_at <= CURRENT_TIMESTAMP`, using database row leases (`locked_until`) to prevent race conditions.
* **Exponential Backoff with Jitter**: If an external API (such as Meta's WhatsApp endpoint) fails, the job schedule increases exponentially ($2^{\text{attempts}} \times \text{baseDelay}$) with randomized jitter to prevent thundering herd spikes.
* **Dead-Letter State**: Jobs failing more than `max_retries` (default: 5) transition to `FAILED` with full error stack traces preserved in `last_error` for manual inspection and re-triggering.
* **Idempotency**: Strict uniqueness enforced via `idempotency_key` (e.g. `whatsapp_order_842_CONFIRMED`) preventing duplicate messaging.

---

## 7. Distributed Tracing & Telemetry Architecture

Every user request is instrumented with OpenTelemetry-compatible tracing:

```text
HTTP Request (Traceparent Header or Generated W3C ID)
  │
  ├──► Route Handler Span
  │      │
  │      ├──► Service Layer Span (order.service:createOnlineOrder)
  │      │      │
  │      │      ├──► Database Transaction Span (db:insertOrder, db:reserveStock)
  │      │      │
  │      │      └──► Queue Enqueue Span (queue:enqueue_whatsapp)
  │      │             │
  │      │             └──► [Asynchronous Job Processing]
  │      │                    │
  │      │                    ├──► WhatsApp API Call Span (whatsapp:sendTemplate)
  │      │                    │
  │      │                    └──► Webhook Ingestion Span (whatsapp:deliveryWebhook)
  │      │
  │      └──► HTTP Response Span (200 OK)
```

Engineers can trace the exact lifecycle of an order from initial web click through database persistence, background queue execution, WhatsApp delivery, and customer status confirmation.
