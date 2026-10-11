# REST API Specification (Version 1.0)

## 1. Overview & Authentication Standards

The Sri Tirumala Dry Fruits REST API powers the digital storefront, administrative consoles, external webhooks, and telemetry collectors.

* **Base URL**: `/api/v1`
* **Content Type**: `application/json` (requests and responses)
* **Standard Response Envelope**:
  ```json
  {
    "success": true,
    "data": { ... },
    "error": null
  }
  ```
* **Error Response Envelope**:
  ```json
  {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Detailed error explanation",
      "details": [ ... ]
    }
  }
  ```

### Authentication Mechanisms

1. **Session & Cookie Authentication**:
   - Web clients pass standard HTTP-only session cookies (`connect.sid`).
   - CSRF tokens are enforced on state-changing requests via `X-CSRF-Token` headers or form body `_csrf`.
2. **Role-Based Access Control (RBAC)**:
   - **Public Endpoints**: Open to unauthenticated shoppers (catalog, cart, checkout).
   - **Customer Endpoints**: Requires active customer session (`req.session.customer_id`).
   - **Admin Endpoints**: Strictly requires authenticated user with `role === 'admin'`. Non-admins receive `401 Unauthorized` or `403 Forbidden`.

---

## 2. Storefront Catalog & Products API

### 2.1 List Catalog Products: `GET /api/v1/products`
Retrieves public catalog products with active stock levels.

* **Query Parameters**: None.
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "products": [
        {
          "id": 12,
          "name": "W240 Jumbo Cashews",
          "barcode": "8901234567890",
          "mrp": 950.00,
          "selling_price": 850.00,
          "available": 45.0,
          "category": "Dry Fruits"
        }
      ]
    }
  }
  ```

### 2.2 Get Product by Barcode: `GET /api/v1/products/:barcode`
Finds an active variant by scanned barcode.

* **Path Parameters**: `barcode` (string)
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "product": {
        "id": 12,
        "name": "W240 Jumbo Cashews",
        "mrp": 950.00,
        "selling_price": 850.00,
        "available": 45.0
      }
    }
  }
  ```
* **Error Response (404 Not Found)**:
  ```json
  {
    "success": false,
    "error": { "message": "Product not found" }
  }
  ```

---

## 3. Cart & Checkout API

### 3.1 Get Cart: `GET /api/v1/cart`
Returns the caller's active shopping cart and item breakdown.

* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "cart": [
        {
          "id": 12,
          "name": "W240 Jumbo Cashews",
          "qty": 2,
          "price": 850.00,
          "total": 1700.00
        }
      ],
      "subtotal": 1700.00
    }
  }
  ```

### 3.2 Add Item to Cart: `POST /api/v1/cart/add`
Adds or increments an item in the session cart.

* **Request Body**:
  ```json
  {
    "product_id": 12,
    "quantity": 2
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": { "itemCount": 2, "subtotal": 1700.00 }
  }
  ```

### 3.3 Store Checkout: `POST /api/v1/store/checkout`
Executes order checkout with inventory reservation and background WhatsApp confirmation queuing.

* **Rate Limit**: Maximum 15 checkout attempts per 15 minutes per IP.
* **Request Body**:
  ```json
  {
    "name": "Ravi Kumar",
    "phone": "9876543210",
    "delivery_type": "DELIVERY",
    "payment_mode": "COD",
    "address": "Flat 302, Green Meadows",
    "landmark": "Near Rama Temple",
    "notes": "Please deliver after 5 PM"
  }
  ```
* **Success Response (201 Created)**:
  ```json
  {
    "success": true,
    "data": {
      "orderId": 842,
      "orderNumber": "STDF-2026-0842",
      "totalAmount": 1750.00,
      "status": "NEW"
    }
  }
  ```

---

## 4. Admin Analytics API

### 4.1 Executive Analytics Summary: `GET /api/v1/analytics`
Computes centralized financial metrics, channel breakdowns, and leaderboards.

* **Authorization**: Admin role required.
* **Query Parameters**:
  * `preset` (optional): `today`, `7d`, `30d`, `month`, `year`, `all`.
  * `startDate` / `endDate` (optional): `YYYY-MM-DD`.
  * `channel` (optional): `ALL`, `POS`, `ONLINE`.
  * `category` (optional): `Dry Fruits`, `Millets`, `Seeds`, etc.
  * `status` (optional): `ALL`, `COMPLETED`, `CANCELLED`, `PENDING`.
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "todayRevenue": 4850.00,
      "weeklyRevenue": 34200.00,
      "monthlyRevenue": 142000.00,
      "allTimeRevenue": 840000.00,
      "totalRevenue": 142000.00,
      "grossProfit": 48280.00,
      "profitMarginPercent": 34.00,
      "orderCount": 284,
      "averageOrderValue": 500.00,
      "posRevenue": 98000.00,
      "onlineRevenue": 44000.00,
      "repeatCustomersCount": 68,
      "repeatCustomerRate": 38.20,
      "cancellationsCount": 6,
      "cancellationRate": 2.11,
      "whatsappConversionRate": 41.50,
      "stockOutsCount": 1,
      "bestSellingProducts": [ ... ],
      "mostProfitableProducts": [ ... ]
    }
  }
  ```

---

## 5. Enterprise Immutable Audit Logs API

### 5.1 Query Audit Logs: `GET /api/v1/audit-logs`
Queries cryptographically chained audit events with multi-dimensional filtering.

* **Authorization**: Admin role required.
* **Query Parameters**:
  * `action`: `LOGIN`, `PRICE_MODIFY`, `ORDER_CONFIRM`, etc.
  * `entity`: `USER`, `PRODUCT`, `ORDER`, `BILL`, `INVENTORY`.
  * `actor`: Substring match on actor identifier.
  * `startDate` / `endDate`: Date range boundaries.
  * `search`: Free-text query.
  * `limit` (default: 50, max: 100) & `offset`.
* **Success Response (200 OK)**:
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
          "source": "IP:127.0.0.1 | CH:STOCK_MANAGEMENT | UA:Mozilla/5.0",
          "metadata": "{\"productName\":\"W240 Cashews\",\"oldSellingPrice\":850,\"newSellingPrice\":890}",
          "prev_hash": "a4f89b...",
          "hash": "e3b0c4..."
        }
      ],
      "total": 142,
      "page": 1,
      "totalPages": 3
    }
  }
  ```

### 5.2 Verify Ledger Integrity: `GET /api/v1/audit-logs/verify`
Runs sequential SHA-256 hash validation to prove no records have been altered.

* **Success Response (200 OK)**:
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

## 6. WhatsApp Webhook API

### 6.1 Hub Challenge Verification: `GET /api/v1/whatsapp/webhook`
Validates Meta webhook subscriptions.

* **Query Parameters**: `hub.mode`, `hub.verify_token`, `hub.challenge`.
* **Response**: Raw challenge string (200 OK) or 403 Forbidden.

### 6.2 Receive Inbound Events: `POST /api/v1/whatsapp/webhook`
Consumes delivery statuses (`sent`, `delivered`, `read`, `failed`) and inbound customer replies.

* **Headers**: `X-Hub-Signature-256` (HMAC SHA-256 payload signature).
* **Response (200 OK)**:
  ```json
  { "status": "EVENT_RECEIVED" }
  ```

---

## 7. Observability & Telemetry Endpoints

* **Prometheus Metrics**: `GET /metrics`
  * Standard OpenMetrics text format exposing HTTP duration histograms, status counters, and DB latency.
* **JSON Metrics Snapshot**: `GET /observability/metrics`
  * Returns JSON payload of technical and business telemetry metrics.
