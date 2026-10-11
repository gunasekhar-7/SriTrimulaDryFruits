# Database Architecture & Entity Relationship Guide

## 1. Overview & Data Layer Strategy

Sri Tirumala Dry Fruits uses **SQLite (version 3.40+)** accessed via the native C++ driver `better-sqlite3`.

### Why SQLite with Write-Ahead Logging (WAL)?
1. **Zero Network Latency**: Running in-process eliminates network roundtrips, allowing POS transactions and inventory queries to execute in microseconds.
2. **High Concurrency**: In WAL mode (`journal_mode = WAL`), read transactions never block write transactions, and write transactions never block readers.
3. **Transactional Integrity (ACID)**: Full serializable transactions ensure multi-item orders, inventory decrements, and sales records commit or roll back atomically.
4. **Hardware Simplicity**: The entire application state resides in a single, portable database file (`data/store.db`), drastically reducing operational complexity and facilitating instantaneous automated backups.

---

## 2. Complete Entity Relationship Diagram (ERD)

The following Mermaid ER diagram illustrates the core entities, relationships, primary keys, foreign keys, and cardinalities:

```mermaid
erDiagram
    CATEGORIES ||--o{ PRODUCTS : "groups"
    PRODUCTS ||--|{ PRODUCT_VARIANTS : "has"
    PRODUCTS ||--o{ PRODUCT_IMAGES : "has"
    PRODUCT_VARIANTS ||--o{ PRODUCT_IMAGES : "has"
    PRODUCT_VARIANTS ||--o{ PRICE_HISTORY : "tracks"
    PRODUCT_VARIANTS ||--o{ STOCK_MOVEMENTS : "logs"
    PRODUCT_VARIANTS ||--o{ STOCK_RESERVATIONS : "reserves"
    PRODUCT_VARIANTS ||--o{ SALES : "sold_in"
    PRODUCT_VARIANTS ||--o{ ONLINE_ORDER_ITEMS : "ordered_in"
    PRODUCT_VARIANTS ||--o{ CUSTOMER_CART_ITEMS : "in_cart"

    USERS ||--o{ SHIFTS : "operates"
    SHIFTS ||--o{ BILLS : "reconciles"

    BILLS ||--|{ SALES : "contains"
    
    CUSTOMERS ||--o{ CUSTOMER_ADDRESSES : "maintains"
    CUSTOMERS ||--o{ CUSTOMER_CARTS : "owns"
    CUSTOMERS ||--o{ ONLINE_ORDERS : "places"
    
    CUSTOMER_CARTS ||--o{ CUSTOMER_CART_ITEMS : "contains"
    CUSTOMER_CARTS ||--o{ STOCK_RESERVATIONS : "holds"

    ONLINE_ORDERS ||--|{ ONLINE_ORDER_ITEMS : "contains"
    ONLINE_ORDERS ||--o{ ORDER_STATUS_LOGS : "logs"
    ONLINE_ORDERS ||--o{ STOCK_RESERVATIONS : "reserves"
    ONLINE_ORDERS ||--o{ WHATSAPP_NOTIFICATIONS : "notifies"

    CATEGORIES {
        int id PK
        string name UK
        string description
    }

    PRODUCTS {
        int id PK
        int category_id FK
        string name
        string description
        int active
    }

    PRODUCT_VARIANTS {
        int id PK
        int product_id FK
        string sku UK
        string barcode UK
        float size_weight
        string unit
        float cost_price
        float selling_price
        float mrp
        float total_qty
        float sold_qty
        float reserved_qty
        string category
        float tax_rate
        int active
    }

    USERS {
        int id PK
        string username UK
        string password_hash
        string role
    }

    SHIFTS {
        int id PK
        int user_id FK
        string opening_time
        string closing_time
        float opening_cash
        float expected_closing_cash
        float actual_closing_cash
        string status
    }

    BILLS {
        int id PK
        string bill_date
        string bill_time
        float total_amount
        string customer_name
        string customer_phone
        float discount_amount
        string payment_method
        int shift_id FK
    }

    SALES {
        int id PK
        int bill_id FK
        int product_id FK
        float qty_sold
        float profit_made
        string sale_date
        float unit_price
    }

    CUSTOMERS {
        int id PK
        string phone UK
        string name
        string email
        string password_hash
        string account_status
        string delivery_address
        string pincode
        string created_at
    }

    ONLINE_ORDERS {
        int id PK
        string order_number UK
        int customer_id FK
        float subtotal
        float delivery_charge
        float discount
        float total_amount
        string payment_mode
        string delivery_type
        string status
        string traceparent
        string created_at
    }

    ONLINE_ORDER_ITEMS {
        int id PK
        int order_id FK
        int product_id FK
        string product_name
        float unit_price
        float quantity
        float total_price
    }

    STOCK_MOVEMENTS {
        int id PK
        int product_variant_id FK
        float quantity_delta
        string movement_type
        string reference_type
        string reference_id
        string actor
        string timestamp
    }

    STOCK_RESERVATIONS {
        int id PK
        int order_id FK
        int cart_id FK
        int product_variant_id FK
        float quantity
        string status
        string expires_at
    }

    AUDIT_LOGS {
        int id PK
        string actor
        string action
        string entity
        string entity_id
        string timestamp
        string source
        string metadata
        string prev_hash
        string hash
    }
```

---

## 3. Data Dictionary & Table Specifications

### 3.1 `product_variants` (Core Inventory)
Tracks sellable items, SKUs, barcodes, wholesale costs, retail pricing, and physical counts.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique variant identifier. |
| `product_id` | INTEGER | NOT NULL, REFERENCES products(id) | Parent master product. |
| `sku` | TEXT | UNIQUE | Internal stock keeping unit (e.g. `ALM-W240-500G`). |
| `barcode` | TEXT | NOT NULL, UNIQUE | EAN/UPC scanned at checkout. |
| `cost_price` | REAL | NOT NULL DEFAULT 0 | Wholesale procurement cost. |
| `selling_price`| REAL | NOT NULL DEFAULT 0 | Retail price charged to customer. |
| `mrp` | REAL | NOT NULL DEFAULT 0 | Maximum Retail Price printed on label. |
| `total_qty` | REAL | NOT NULL DEFAULT 0 | Total acquired inventory stock. |
| `sold_qty` | REAL | NOT NULL DEFAULT 0 | Cumulative sold units. |
| `reserved_qty`| REAL | NOT NULL DEFAULT 0 | Units reserved in active online carts/orders. |
| `tax_rate` | REAL | NOT NULL DEFAULT 0 | Applicable GST percentage (e.g. 5, 12, 18). |
| `active` | INTEGER | DEFAULT 1 | Soft-delete flag (1 = active, 0 = archived). |

* **Integrity Constraint**: `CONSTRAINT check_inventory CHECK (total_qty - sold_qty >= 0)`.
  * *Enforcement*: Rejects any transaction that would result in overselling or negative inventory.

---

### 3.2 `bills` and `sales` (POS Ledger)
Records physical store invoices and individual line items with cashier shift associations.

* **`bills`**:
  * `id`: Auto-incrementing invoice number printed on customer receipts.
  * `total_amount`: Final payable sum after discounts.
  * `shift_id`: Foreign key link to cashier register shift for day-end reconciliation.
  * `payment_method`: One of `'Cash'`, `'UPI'`, or `'Card'`.
* **`sales`**:
  * Line-item table linking `bill_id` and `product_id`.
  * Stores `profit_made` calculated at the precise moment of sale: $(\text{unit\_price} - \text{cost\_price}) \times \text{qty} - \text{item\_discount}$.

---

### 3.3 `online_orders` and `online_order_items` (E-Commerce)
Manages digital storefront orders, fulfillment states, delivery addresses, and tracing contexts.

* **`online_orders`**:
  * `order_number`: Formatted external reference (e.g. `STDF-2026-0842`).
  * `status`: Finite state machine check constraint: `CHECK (status IN ('NEW', 'CONFIRMED', 'PACKING', 'READY', 'DISPATCHED', 'COMPLETED', 'CANCELLED'))`.
  * `payment_mode`: `CHECK (payment_mode IN ('COD', 'UPI_QR'))`.
  * `traceparent`: W3C distributed tracing context header string.

---

### 3.4 `audit_logs` (Cryptographically Chained Immutable Ledger)
Captures every critical administrative, catalog, financial, and authentication action.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Sequential record index. |
| `actor` | TEXT | NOT NULL | User identity (e.g. `staff:1 (admin:admin)` or `customer:4`). |
| `action` | TEXT | NOT NULL | Event type (`LOGIN`, `PRICE_MODIFY`, `REFUND`, etc.). |
| `entity` | TEXT | NOT NULL | Domain entity (`USER`, `PRODUCT`, `ORDER`, `BILL`, etc.). |
| `entity_id` | TEXT | NULLABLE | Primary key or reference identifier of the entity. |
| `timestamp` | TEXT | NOT NULL DEFAULT (datetime('now')) | UTC timestamp. |
| `source` | TEXT | NOT NULL | Origin string (`IP:127.0.0.1 \| CH:POS \| UA:Mozilla...`). |
| `metadata` | TEXT | NULLABLE | JSON string with state diffs, reasons, and amounts. |
| `prev_hash` | TEXT | NULLABLE | SHA-256 hash of the preceding record (`'GENESIS'` for id=1). |
| `hash` | TEXT | NOT NULL | SHA-256 digest of $(prev\_hash \parallel actor \parallel action \parallel \dots)$. |

---

## 4. Hardened Immutability Triggers

To prevent tampering by malicious insiders or application vulnerabilities, SQLite triggers reject `UPDATE` and `DELETE` queries on the audit ledger:

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

---

## 5. Performance Indexes & Pragmas

### SQLite Pragmas configured on startup (`src/database.ts`):
```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 10000;
```

### Critical Indexes:
* **Inventory & Search**:
  * `idx_product_variants_barcode` on `product_variants(barcode)` (UNIQUE)
  * `idx_product_variants_sku` on `product_variants(sku)` (UNIQUE)
* **Reservations & Orders**:
  * `idx_stock_reservations_status` on `stock_reservations(status)`
  * `idx_stock_reservations_order` on `stock_reservations(order_id)`
  * `idx_online_orders_customer` on `online_orders(customer_id)`
* **Background Queue**:
  * `idx_background_jobs_polling` on `background_jobs(status, run_at)`
  * `idx_background_jobs_idempotency` on `background_jobs(idempotency_key)`
* **Audit & Backups**:
  * `idx_audit_logs_action` on `audit_logs(action)`
  * `idx_audit_logs_entity` on `audit_logs(entity, entity_id)`
  * `idx_audit_logs_timestamp` on `audit_logs(timestamp)`
  * `idx_backup_history_created` on `backup_history(created_at)`
