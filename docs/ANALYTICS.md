# Production-Quality Product Analytics & Financial Engine

## 1. Overview & Architectural Principles

The Sri Tirumala Dry Fruits Admin Analytics Dashboard provides real-time, high-fidelity business intelligence, profitability analytics, customer retention metrics, and omnichannel revenue performance.

Designed from the perspective of a **Senior Product Analytics Engineer**, the subsystem adheres strictly to three core architectural principles:

1. **Centralized Financial Logic (Single Source of Truth)**:
   - All mathematical calculations for financial metrics—including Gross Revenue, Net Revenue, Cost of Goods Sold (COGS), Gross Profit, Gross Margin Percentage, Average Order Value (AOV), Repeat Customer Rate, Cancellation Rate, and WhatsApp Conversion Rate—are encapsulated exclusively within `src/utils/financial.ts` (`FinancialCalculator`).
   - Formulas are **never duplicated** inside EJS templates, controller handlers, or ad-hoc SQL expressions. Both the Executive Analytics Dashboard (`/analytics`), the Profit Summary View (`/profit`), and the Reporting API (`/api/v1/analytics`) consume this single source of truth.

2. **Omnichannel Harmonization (POS + Online)**:
   - POS store sales (`bills`, `sales`) and digital storefront orders (`online_orders`, `online_order_items`) are aggregated with strict reconciliation of statuses, discounts, delivery fees, and inventory variant costs.
   - Channel filtering enables business analysts to isolate in-store physical walk-in performance from online e-commerce transactions.

3. **Multi-Dimensional Slice-and-Dice Filtering**:
   - The analytics engine supports instantaneous cross-dimensional slicing by:
     - **Date**: Presets (`today`, `7d`, `30d`, `month`, `year`, `all`) or arbitrary custom date ranges (`startDate`, `endDate`).
     - **Category**: Specific product category (Dry Fruits, Millets, Seeds, Spices, Nuts, Sweets, etc.).
     - **Product**: Granular variant-level drilldown.
     - **Channel**: `ALL`, `POS`, or `ONLINE`.
     - **Status**: `ALL`, `COMPLETED`, `CANCELLED`, or `PENDING`.

---

## 2. Centralized Business Logic & Mathematical Formulas

All formulas are implemented with numeric guards against IEEE-754 floating-point inaccuracies and division-by-zero errors in `src/utils/financial.ts`:

### 2.1 Financial Formulas

| Metric | Formula | Description |
| :--- | :--- | :--- |
| **Gross Revenue** | $\sum (\text{Quantity} \times \text{Selling Price})$ | Total top-line sales volume before line/bill discounts and delivery fees. |
| **Net Revenue** | $\text{Gross Revenue} - \text{Discount} + \text{Delivery Charges}$ | Actual cash-flow revenue recognized after customer discounts and delivery fees. |
| **Cost of Goods Sold (COGS)** | $\sum (\text{Quantity} \times \text{Cost Price})$ | Wholesale inventory acquisition cost for units sold. |
| **Gross Profit** | $\text{Net Revenue} - \text{COGS}$ | Absolute monetary profit earned from transactions. |
| **Profit Margin (%)** | $\begin{cases} \left(\frac{\text{Gross Profit}}{\text{Net Revenue}}\right) \times 100 & \text{if Net Revenue} > 0 \\ 0 & \text{otherwise} \end{cases}$ | Profitability efficiency percentage. Guarded against divide-by-zero. |
| **Average Order Value (AOV)** | $\begin{cases} \frac{\text{Net Revenue}}{\text{Order Count}} & \text{if Order Count} > 0 \\ 0 & \text{otherwise} \end{cases}$ | Mean expenditure per transaction. |

### 2.2 Customer & Operational Ratios

| Metric | Formula | Description |
| :--- | :--- | :--- |
| **Repeat Customer Rate (%)** | $\begin{cases} \left(\frac{\text{Repeat Customers}}{\text{Total Unique Customers}}\right) \times 100 & \text{if Total Customers} > 0 \\ 0 & \text{otherwise} \end{cases}$ | Proportion of transacting customer base with $>1$ historical order. |
| **Cancellation Rate (%)** | $\begin{cases} \left(\frac{\text{Cancelled Orders}}{\text{Total Orders Initiated}}\right) \times 100 & \text{if Total Orders} > 0 \\ 0 & \text{otherwise} \end{cases}$ | Churn / attrition rate of initiated orders that were revoked or cancelled. |
| **WhatsApp Conversion Rate (%)** | $\begin{cases} \left(\frac{\text{Completed Orders}}{\text{WhatsApp Notifications Sent}}\right) \times 100 & \text{if Notifications} > 0 \\ 0 & \text{otherwise} \end{cases}$ | Conversion efficiency of marketing/transactional automated WhatsApp pings into finalized purchases. |

---

## 3. Analytics Service (`src/services/analytics.service.ts`)

The `AnalyticsService` executes optimized parameterized SQLite queries and aggregates the business telemetry into a structured DTO (`AnalyticsSummary`):

```typescript
export interface AnalyticsSummary {
  // Top benchmark cards (unfiltered / baseline)
  todayRevenue: number;
  weeklyRevenue: number;
  monthlyRevenue: number;
  allTimeRevenue: number;

  // Filtered operational totals
  totalRevenue: number;
  grossRevenue: number;
  totalDiscount: number;
  totalDelivery: number;
  totalCogs: number;
  grossProfit: number;
  profitMarginPercent: number;
  orderCount: number;
  averageOrderValue: number;

  // Channel breakdown
  posRevenue: number;
  posOrderCount: number;
  onlineRevenue: number;
  onlineOrderCount: number;

  // Customer & lifecycle metrics
  repeatCustomersCount: number;
  totalCustomersCount: number;
  repeatCustomerRate: number;
  cancellationsCount: number;
  cancellationRate: number;

  // Omnichannel marketing & stock health
  whatsappNotificationsCount: number;
  whatsappConversionRate: number;
  stockOutsCount: number;
  lowStockCount: number;
  stockOutsList: StockOutItem[];

  // Visualizations & leaderboards
  bestSellingProducts: BestSellingProduct[];
  mostProfitableProducts: ProfitableProduct[];
  categoryBreakdown: CategoryBreakdown[];
  timelineData: TimelineDataPoint[];
}
```

---

## 4. Executive Analytics Dashboard UI (`views/analytics.ejs`)

The dashboard UI delivers an enterprise-grade reporting experience:

1. **Persistent Benchmark Ribbons**:
   - Immediate visibility into **Today's Revenue**, **Weekly Revenue (7d)**, **Monthly Revenue (30d)**, and **All-Time Revenue** benchmarks.
2. **Interactive Slice-and-Dice Filter Bar**:
   - Date preset pills (`Today`, `Last 7 Days`, `Last 30 Days`, `This Month`, `This Year`, `All Time`).
   - Custom calendar date pickers (`From`, `To`).
   - Dropdown selectors for Category, Product, Sales Channel (`All`, `POS`, `Online`), and Order Status.
   - Quick action buttons for resetting filters and running queries.
3. **Responsive Chart.js Visualizations**:
   - **Revenue Trendline**: Dual-axis bar and smooth curve tracking daily revenue velocity across the selected timeframe.
   - **Category Distribution**: Doughnut visualization illustrating revenue share by product category.
4. **Product Intelligence Leaderboards**:
   - **Top 10 Best Sellers**: Ranked by units sold, total revenue generated, and transaction frequency.
   - **Top 10 Most Profitable**: Ranked by net gross profit, showing COGS and gross margin % with color-coded profit tags.
5. **Inventory Replenishment & Stock-Out Radar**:
   - Real-time detection of completely depleted variants (`Stock = 0`) and items nearing safety buffers (`Stock <= Min Stock Alert`).
   - Direct link to batch restock in the inventory management view.
6. **Executive Export & Reporting Tools**:
   - **Export to CSV**: Client-side data compilation downloading key metric summaries and product leaderboards directly into `.csv`.
   - **Print / PDF Report**: CSS print stylesheets optimized for clean executive paper reporting with header cards and suppressed navigation controls.

---

## 5. REST Reporting API

The analytics engine exposes standard endpoints protected by `requireAdmin` role-based access control:

### Endpoint: `GET /api/v1/analytics`

#### Query Parameters:
| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `preset` | string | No | `30d` | One of `today`, `7d`, `30d`, `month`, `year`, `all`. |
| `startDate` | string | No | — | `YYYY-MM-DD` start date for custom range. |
| `endDate` | string | No | — | `YYYY-MM-DD` end date for custom range. |
| `channel` | string | No | `ALL` | Filter sales channel (`ALL`, `POS`, `ONLINE`). |
| `category` | string | No | `ALL` | Category name filter. |
| `productId` | number | No | — | Specific product variant ID. |
| `status` | string | No | `ALL` | Order status filter (`ALL`, `COMPLETED`, `CANCELLED`, `PENDING`). |

#### Sample JSON Response:
```json
{
  "success": true,
  "data": {
    "todayRevenue": 2450.00,
    "weeklyRevenue": 18200.00,
    "monthlyRevenue": 74300.00,
    "allTimeRevenue": 482500.00,
    "totalRevenue": 74300.00,
    "grossRevenue": 75800.00,
    "totalDiscount": 2000.00,
    "totalDelivery": 500.00,
    "totalCogs": 48200.00,
    "grossProfit": 26100.00,
    "profitMarginPercent": 35.13,
    "orderCount": 142,
    "averageOrderValue": 523.24,
    "posRevenue": 51200.00,
    "posOrderCount": 98,
    "onlineRevenue": 23100.00,
    "onlineOrderCount": 44,
    "repeatCustomersCount": 38,
    "totalCustomersCount": 85,
    "repeatCustomerRate": 44.71,
    "cancellationsCount": 4,
    "cancellationRate": 2.74,
    "whatsappNotificationsCount": 112,
    "whatsappConversionRate": 39.29,
    "stockOutsCount": 2,
    "lowStockCount": 5,
    "bestSellingProducts": [
      {
        "variantId": 12,
        "name": "W240 Jumbo Cashews",
        "category": "Dry Fruits",
        "unitsSold": 84,
        "revenue": 33600.00,
        "orderCount": 42
      }
    ],
    "mostProfitableProducts": [
      {
        "variantId": 12,
        "name": "W240 Jumbo Cashews",
        "category": "Dry Fruits",
        "unitsSold": 84,
        "revenue": 33600.00,
        "cogs": 21840.00,
        "grossProfit": 11760.00,
        "profitMarginPercent": 35.00
      }
    ]
  }
}
```

---

## 6. Automated Testing Matrix

The financial and product analytics systems are verified by automated test suites:

### 6.1 Unit Tests (`tests/unit/financial.unit.test.ts`)
- `18 tests` validating:
  - Strict currency and percentage rounding without floating point drift.
  - Net revenue with discount deductions and delivery fee additions.
  - COGS and Gross Profit calculation under zero-cost, standard-cost, and negative-profit edge cases.
  - Margin percentage safety when revenue is zero or negative.
  - AOV calculation with zero orders guard.
  - Repeat customer, cancellation, and WhatsApp conversion rates.
  - Complete product profit bundle evaluation.

### 6.2 Integration Tests (`tests/integration/analytics.test.ts`)
- `13 tests` validating:
  - Role-Based Access Control: unauthenticated redirects to `/login`, staff redirects to `/sell`, admin authorized.
  - Core metrics presence on `/analytics` HTML dashboard.
  - Multi-dimensional filters: presets (`today`, `7d`), categories, sales channels (`POS` only vs `ONLINE` only), statuses (`COMPLETED`), and custom date ranges.
  - Dual API endpoints (`/api/analytics` and `/api/v1/analytics`) returning structured JSON payload with matching filter semantics.
