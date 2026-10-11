# Immutable Audit Log System & Cryptographic Ledger

## 1. Enterprise Overview & Compliance Standards

The Sri Tirumala Dry Fruits Enterprise Audit Logging System provides an immutable, append-only, tamper-evident record of all security, operational, catalog, financial, and inventory transactions.

Engineered from the perspective of a **Senior Enterprise Application Engineer**, this system satisfies core auditability and data governance controls (aligning with SOC 2 Common Criteria CC6.1, CC6.8, and ISO 27001 Annex A.12.4):

1. **Write-Only Immutability**: Historical audit records can never be updated or deleted through application workflows, administrative routes, or direct SQL execution.
2. **Tamper-Evident Hash Chaining**: Every record is cryptographically linked to its predecessor using SHA-256 parent hash pointers (`prev_hash` $\to$ `hash`), creating a verifiable blockchain-style ledger.
3. **Strict Access Segmentation**: Ordinary customers and operational staff are strictly prohibited from viewing internal audit records; access is restricted exclusively to authenticated users with the `admin` role.
4. **Full Operational Traceability**: Every event captures `actor`, `action`, `entity`, `entity ID`, `timestamp`, `source` (IP address, client channel, user agent), and rich `metadata` (before/after diffs, reasons, and amounts).

---

## 2. Hardened Immutability Architecture

To ensure audit history cannot be tampered with even in the event of an application exploit, the system implements **defense-in-depth immutability**:

### 2.1 Database Engine-Level SQLite Triggers (`src/database.ts`)

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

* **Guarantee**: Any attempt to issue `UPDATE audit_logs ...` or `DELETE FROM audit_logs ...` immediately aborts at the SQLite database engine layer, throwing a fatal constraint failure.

### 2.2 Repository & Service Abstraction (`src/repositories/audit.repository.ts`)
* The repository exposes **zero update or delete methods**.
* Only `insertAuditLog`, `searchAuditLogs`, `getAuditLogById`, and `verifyLedgerIntegrity` exist.

### 2.3 Cryptographic Hash Chaining

Each record computes a canonical SHA-256 digest:

$$\text{hash}_n = \text{SHA-256}\Big(\text{hash}_{n-1} \parallel \text{actor} \parallel \text{action} \parallel \text{entity} \parallel \text{entity\_id} \parallel \text{timestamp} \parallel \text{source} \parallel \text{metadata}\Big)$$

The first record in the database chains to `GENESIS`. If an unauthorized party alters the database file offline (e.g. modifying an actor or deleting a record), the hash chain will break, which is immediately flagged by `verifyLedgerIntegrity()`.

---

## 3. Tracked Enterprise Events Catalog

The system monitors and logs 12 critical application events across authentication, product catalog, inventory, ordering, and financial transactions:

| Action | Domain Entity | Triggering Workflow | Recorded Metadata & Diffs |
| :--- | :--- | :--- | :--- |
| `LOGIN` | `USER` | Staff/Admin login (`/login`) & Customer login (`/customer/login`) | User role, email, authentication method, session ID. |
| `FAILED_LOGIN` | `AUTH` | Invalid credentials or malformed payload | Attempted username/email, failure reason, client IP. |
| `PRODUCT_CREATE` | `PRODUCT` | New product catalog entry added (`/add`) | Product name, barcode, initial quantity, cost, selling price, MRP, category. |
| `PRODUCT_UPDATE` | `PRODUCT` | Product metadata edited (`/edit/:id`) | Field-level diff (`old` vs. `new` for name, barcode, category, tax rate). |
| `PRICE_MODIFY` | `PRODUCT_VARIANT` | Variant selling price, MRP, or cost updated | Detailed price delta (`oldSellingPrice`, `newSellingPrice`, `oldMrp`, `newMrp`, etc.). |
| `INVENTORY_ADJUST`| `INVENTORY` | Manual stock addition (`/add_stock`) or stock editing | Quantity delta, prior stock (`oldQty`), resulting stock (`newQty`), reason. |
| `ORDER_CONFIRM` | `ORDER` | Online order status transitioned to `CONFIRMED` | Order ID, order number, customer ID, order total. |
| `ORDER_CANCEL` | `ORDER` | Online order transitioned to `CANCELLED` | Order ID, order number, previous status, cancellation reason. |
| `RETURN` | `RETURN` | POS item returned via Bill Search (`/return_item`) | Bill ID, sale ID, product ID, return quantity, unit price, refund amount. |
| `REFUND` | `BILL` / `ORDER` | Refund issued on POS return or cancelled order | Reference ID, refund monetary amount, payment method, refund reason. |
| `ROLE_CHANGE` | `USER` | Admin alters user permissions (`/settings`) | Target user ID, username, previous role (`oldRole`), new assigned role (`newRole`). |
| `POS_CONVERT` | `ORDER` | Online order pushed/converted into POS bill | Source order ID, target POS bill ID, total amount converted. |

---

## 4. Source & Actor Resolution

All events capture comprehensive context via standard extraction utilities in `src/services/audit.service.ts`:

* **`actor`**:
  * Authenticated Staff/Admin: `staff:{id} ({username}:{role})`
  * Authenticated Customer: `customer:{id} ({email})`
  * Background / System Worker: `SYSTEM` or custom job name
  * Unauthenticated: Extracted identifier or `anonymous`
* **`source`**:
  * Formatted as `IP:{ip} | CH:{channel} | UA:{user-agent}`
  * Supports reverse proxy client resolution via `X-Forwarded-For` with fallback to `req.socket.remoteAddress`.
  * Channel identifies origin (`POS_TERMINAL`, `ADMIN_PORTAL`, `STOREFRONT`, `API`, `STOCK_MANAGEMENT`).

---

## 5. Admin Explorer UI (`views/audit_logs.ejs`)

Mounted at `/admin/audit-logs` and `/audit-logs` (protected by `requireAdmin`):

1. **Cryptographic Ledger Integrity Banner**:
   * Real-time verification indicator demonstrating ledger health.
   * On-demand manual validation trigger executing `verifyLedgerIntegrity()`.
2. **Operational KPI Summary Cards**:
   * Total audited events, security & access count, commercial transaction count, catalog & inventory adjustment count.
3. **Multi-Dimensional Filter Toolbar**:
   * Event Action filter (all 12 actions).
   * Entity domain filter (`USER`, `PRODUCT`, `ORDER`, `BILL`, `INVENTORY`, etc.).
   * Date range selection (`From Date` and `To Date`).
   * Free-text keyword search indexing actor, entity ID, metadata contents, and IP addresses.
4. **Event Stream Table**:
   * Color-coded semantic action badges.
   * Timestamp with ISO and local representations.
   * Truncated actor and source chips.
   * **Payload Inspector Modal**: Interactive viewer displaying decoded JSON metadata and cryptographic hash evidence (`prev_hash` and SHA-256 record hash).
5. **Data Export & Reporting**:
   * **CSV Export**: Browser-side download of tabular log events.
   * **JSON Export**: Direct REST API export for SIEM ingestion.

---

## 6. Enterprise REST API

Mounted under `/api/v1/admin/audit-logs` and `/api/v1/audit-logs` (strictly protected by `requireAuth` and `requireAdmin`):

### 6.1 Query Audit Logs: `GET /api/v1/audit-logs`

#### Query Parameters:
| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `action` | string | No | `ALL` | Filter by action (e.g. `LOGIN`, `PRICE_MODIFY`, `REFUND`). |
| `entity` | string | No | `ALL` | Filter by entity (e.g. `PRODUCT`, `ORDER`, `USER`). |
| `actor` | string | No | — | Filter by actor substring. |
| `entityId` | string | No | — | Filter by exact entity ID. |
| `startDate` | string | No | — | `YYYY-MM-DD` start boundary. |
| `endDate` | string | No | — | `YYYY-MM-DD` end boundary. |
| `search` | string | No | — | Free-text keyword search across metadata, actor, and source. |
| `limit` | number | No | `50` | Maximum results per page (max 100). |
| `offset` | number | No | `0` | Pagination record offset. |

#### Sample Response:
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": 142,
        "actor": "staff:1 (admin:admin)",
        "action": "PRICE_MODIFY",
        "entity": "PRODUCT_VARIANT",
        "entity_id": "12",
        "timestamp": "2026-10-10 01:14:02",
        "source": "IP:127.0.0.1 | CH:STOCK_MANAGEMENT | UA:Mozilla/5.0...",
        "metadata": "{\"productName\":\"W240 Cashews\",\"oldSellingPrice\":850,\"newSellingPrice\":890,\"oldMrp\":950,\"newMrp\":990}",
        "prev_hash": "a4f89b...",
        "hash": "e3b0c4..."
      }
    ],
    "total": 142,
    "page": 1,
    "totalPages": 3,
    "limit": 50,
    "integrity": {
      "isValid": true,
      "checkedCount": 142
    }
  }
}
```

### 6.2 Verify Ledger Integrity: `GET /api/v1/audit-logs/verify`

#### Response:
```json
{
  "success": true,
  "data": {
    "isValid": true,
    "checkedCount": 142
  }
}
```

---

## 7. Security Enforcement & Access Control Matrix

| Persona | Web Explorer (`/admin/audit-logs`) | REST API (`/api/v1/audit-logs`) | Access Outcome |
| :--- | :--- | :--- | :--- |
| **Unauthenticated Visitor** | Redirected to `/login` (302) | Blocked (302 / 401) | **Deny** |
| **Ordinary Customer** | Redirected to `/login` (302) | Blocked (302 / 403) | **Deny (Customer Data Shielded)** |
| **Staff Member** | Redirected to `/sell` (302) | Blocked (403 Forbidden) | **Deny (Privilege Separation)** |
| **Administrator** | Status 200 (Dashboard Rendered) | Status 200 (JSON Returned) | **Allow** |
