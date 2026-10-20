import db from '../database.js';
import { FinancialCalculator } from '../utils/financial.js';

export interface AnalyticsFilter {
  startDate?: string;
  endDate?: string;
  preset?: 'today' | '7d' | '30d' | 'month' | 'year' | 'all';
  category?: string;
  productId?: number;
  channel?: 'ALL' | 'POS' | 'ONLINE';
  status?: 'ALL' | 'COMPLETED' | 'CANCELLED' | 'PENDING';
}

export interface ProductPerformanceItem {
  id: number;
  name: string;
  category: string;
  barcode: string;
  quantitySold: number;
  revenue: number;
  cogs: number;
  profit: number;
  profitMarginPercent: number;
  averagePrice: number;
}

export interface RevenueTrendPoint {
  date: string;
  posRevenue: number;
  onlineRevenue: number;
  totalRevenue: number;
  orderCount: number;
}

export interface CategoryBreakdownItem {
  category: string;
  revenue: number;
  quantitySold: number;
  orderCount: number;
  sharePercent: number;
}

export interface StockOutItem {
  id: number;
  name: string;
  barcode: string;
  category: string;
  stock: number;
  sellingPrice: number;
}

export interface AnalyticsSummary {
  // Global Benchmark Totals (Unfiltered / Periodic Reference)
  todayRevenue: number;
  weeklyRevenue: number;
  monthlyRevenue: number;
  allTimeRevenue: number;

  // Filtered Window Metrics
  totalRevenue: number;
  posRevenue: number;
  onlineRevenue: number;
  orderCount: number;
  posOrderCount: number;
  onlineOrderCount: number;
  averageOrderValue: number;
  posAov: number;
  onlineAov: number;

  totalCOGS: number;
  totalProfit: number;
  profitMarginPercent: number;

  // Best-Selling & Profitable Products
  bestSellingProducts: ProductPerformanceItem[];
  mostProfitableProducts: ProductPerformanceItem[];

  // Customer Loyalty & Cancellations
  repeatCustomers: {
    totalCustomers: number;
    repeatCustomersCount: number;
    repeatOrdersCount: number;
    repeatCustomerRatePercent: number;
  };
  cancellations: {
    totalOrdersAttempted: number;
    cancelledOrdersCount: number;
    cancellationRatePercent: number;
  };

  // Inventory Stock-Outs
  stockOuts: {
    count: number;
    lowStockCount: number;
    items: StockOutItem[];
  };

  // WhatsApp Conversion Funnel
  whatsappConversion: {
    notificationsSent: number;
    confirmedOrders: number;
    conversionRatePercent: number;
  };

  // Trends & Distributions for Visualizations
  revenueTrend: RevenueTrendPoint[];
  categoryBreakdown: CategoryBreakdownItem[];
  channelBreakdown: {
    pos: { revenue: number; count: number; sharePercent: number };
    online: { revenue: number; count: number; sharePercent: number };
  };

  filter: {
    startDate: string;
    endDate: string;
    preset: string;
    category: string;
    productId: number | null;
    channel: string;
    status: string;
  };
}

export class AnalyticsService {
  /**
   * Resolves filter dates based on selected preset or explicit start/end dates
   */
  resolveDateRange(filter?: AnalyticsFilter): { startDate: string; endDate: string; preset: string } {
    const today = new Date();
    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    const todayStr = formatDate(today);
    let startDate = filter?.startDate || '';
    let endDate = filter?.endDate || todayStr;
    const preset = filter?.preset || (filter?.startDate ? 'custom' : '30d');

    if (!filter?.startDate) {
      if (preset === 'today') {
        startDate = todayStr;
        endDate = todayStr;
      } else if (preset === '7d') {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        startDate = formatDate(d);
        endDate = todayStr;
      } else if (preset === 'month') {
        // First day of current calendar month
        const d = new Date(today.getFullYear(), today.getMonth(), 1);
        startDate = formatDate(d);
        endDate = todayStr;
      } else if (preset === 'year') {
        // First day of current calendar year
        const d = new Date(today.getFullYear(), 0, 1);
        startDate = formatDate(d);
        endDate = todayStr;
      } else if (preset === 'all') {
        startDate = '2020-01-01';
        endDate = todayStr;
      } else {
        // Default to last 30 days
        const d = new Date();
        d.setDate(d.getDate() - 29);
        startDate = formatDate(d);
        endDate = todayStr;
      }
    }

    return { startDate, endDate, preset };
  }

  /**
   * Computes the complete production analytics summary using centralized business logic.
   */
  getAnalyticsSummary(filterInput?: AnalyticsFilter): AnalyticsSummary {
    const { startDate, endDate, preset } = this.resolveDateRange(filterInput);
    const category = (filterInput?.category && filterInput.category !== 'all') ? filterInput.category : '';
    const productId = filterInput?.productId ? Number(filterInput.productId) : null;
    const channel = (filterInput?.channel || 'ALL').toUpperCase();
    const status = (filterInput?.status || 'ALL').toUpperCase();

    const todayStr = new Date().toISOString().split('T')[0];

    // ─────────────────────────────────────────────────────────────────────────
    // 1. GLOBAL PERIODIC BENCHMARKS (Today, 7D, 30D, All-Time)
    // ─────────────────────────────────────────────────────────────────────────
    const todayPos = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as rev FROM bills WHERE bill_date = ?
    `).get(todayStr) as { rev: number };

    const todayOnline = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as rev FROM online_orders 
      WHERE DATE(created_at) = ? AND status != 'CANCELLED'
    `).get(todayStr) as { rev: number };

    const todayRevenue = FinancialCalculator.roundCurrency(todayPos.rev + todayOnline.rev);

    // Past 7 days benchmark
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const weekPos = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as rev FROM bills WHERE bill_date BETWEEN ? AND ?
    `).get(weekStartStr, todayStr) as { rev: number };

    const weekOnline = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as rev FROM online_orders 
      WHERE DATE(created_at) BETWEEN ? AND ? AND status != 'CANCELLED'
    `).get(weekStartStr, todayStr) as { rev: number };

    const weeklyRevenue = FinancialCalculator.roundCurrency(weekPos.rev + weekOnline.rev);

    // Past 30 days benchmark
    const monthStart = new Date();
    monthStart.setDate(monthStart.getDate() - 29);
    const monthStartStr = monthStart.toISOString().split('T')[0];

    const monthPos = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as rev FROM bills WHERE bill_date BETWEEN ? AND ?
    `).get(monthStartStr, todayStr) as { rev: number };

    const monthOnline = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as rev FROM online_orders 
      WHERE DATE(created_at) BETWEEN ? AND ? AND status != 'CANCELLED'
    `).get(monthStartStr, todayStr) as { rev: number };

    const monthlyRevenue = FinancialCalculator.roundCurrency(monthPos.rev + monthOnline.rev);

    // All-time benchmark
    const allPos = db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as rev FROM bills`).get() as { rev: number };
    const allOnline = db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as rev FROM online_orders WHERE status != 'CANCELLED'`).get() as { rev: number };
    const allTimeRevenue = FinancialCalculator.roundCurrency(allPos.rev + allOnline.rev);

    // ─────────────────────────────────────────────────────────────────────────
    // 2. FILTERED POS AGGREGATION (Bills & Sales)
    // ─────────────────────────────────────────────────────────────────────────
    let posRevenue = 0;
    let posOrderCount = 0;
    let posCogs = 0;

    const includePos = channel === 'ALL' || channel === 'POS';

    if (includePos && status !== 'CANCELLED') {
      let posQuery = `
        SELECT 
          b.id as bill_id,
          b.bill_date,
          b.total_amount,
          b.discount_amount,
          s.product_id,
          s.qty_sold,
          s.unit_price,
          s.profit_made,
          pv.cost_price,
          pv.category,
          p.name as product_name
        FROM bills b
        JOIN sales s ON b.id = s.bill_id
        LEFT JOIN product_variants pv ON s.product_id = pv.id
        LEFT JOIN products p ON pv.product_id = p.id
        WHERE b.bill_date BETWEEN ? AND ?
      `;
      const posParams: any[] = [startDate, endDate];

      if (category) {
        posQuery += ` AND pv.category = ?`;
        posParams.push(category);
      }
      if (productId) {
        posQuery += ` AND s.product_id = ?`;
        posParams.push(productId);
      }

      const posRows = db.prepare(posQuery).all(...posParams) as any[];

      if (!category && !productId) {
        const billTotals = new Map<number, number>();
        for (const row of posRows) {
          billTotals.set(row.bill_id, Number(row.total_amount) || 0);
          const lineCost = (Number(row.cost_price) || 0) * (Number(row.qty_sold) || 0);
          posCogs += lineCost;
        }
        posRevenue = Array.from(billTotals.values()).reduce((sum, amt) => sum + amt, 0);
        posOrderCount = billTotals.size;
      } else {
        const billIds = new Set<number>();
        for (const row of posRows) {
          billIds.add(row.bill_id);
          const lineGross = (Number(row.unit_price) || 0) * (Number(row.qty_sold) || 0);
          const bSubtotal = (Number(row.total_amount) || 0) + (Number(row.discount_amount) || 0);
          const discountFactor = bSubtotal > 0 && row.discount_amount > 0 ? (1 - (Number(row.discount_amount) / bSubtotal)) : 1;
          posRevenue += lineGross * discountFactor;
          const lineCost = (Number(row.cost_price) || 0) * (Number(row.qty_sold) || 0);
          posCogs += lineCost;
        }
        posOrderCount = billIds.size;
      }
    }

    posRevenue = FinancialCalculator.roundCurrency(posRevenue);
    posCogs = FinancialCalculator.roundCurrency(posCogs);

    // ─────────────────────────────────────────────────────────────────────────
    // 3. FILTERED ONLINE AGGREGATION (Orders & Order Items)
    // ─────────────────────────────────────────────────────────────────────────
    let onlineRevenue = 0;
    let onlineOrderCount = 0;
    let onlineCogs = 0;

    const includeOnline = channel === 'ALL' || channel === 'ONLINE';

    if (includeOnline) {
      let onlineQuery = `
        SELECT 
          o.id as order_id,
          DATE(o.created_at) as order_date,
          o.status,
          o.subtotal,
          o.discount,
          o.total_amount,
          oi.product_id,
          oi.product_name,
          oi.unit_price,
          oi.quantity,
          oi.total_price,
          pv.cost_price,
          pv.category
        FROM online_orders o
        JOIN online_order_items oi ON o.id = oi.order_id
        LEFT JOIN product_variants pv ON oi.product_id = pv.id
        WHERE DATE(o.created_at) BETWEEN ? AND ?
      `;
      const onlineParams: any[] = [startDate, endDate];

      if (status === 'COMPLETED') {
        onlineQuery += ` AND o.status = 'COMPLETED'`;
      } else if (status === 'CANCELLED') {
        onlineQuery += ` AND o.status = 'CANCELLED'`;
      } else if (status === 'PENDING') {
        onlineQuery += ` AND o.status IN ('NEW', 'CONFIRMED', 'PACKING', 'READY', 'DISPATCHED')`;
      } else {
        // ALL statuses except default exclusion of cancelled for general revenue
        onlineQuery += ` AND o.status != 'CANCELLED'`;
      }

      if (category) {
        onlineQuery += ` AND pv.category = ?`;
        onlineParams.push(category);
      }
      if (productId) {
        onlineQuery += ` AND oi.product_id = ?`;
        onlineParams.push(productId);
      }

      const onlineRows = db.prepare(onlineQuery).all(...onlineParams) as any[];

      if (!category && !productId) {
        const orderTotals = new Map<number, number>();
        for (const row of onlineRows) {
          orderTotals.set(row.order_id, Number(row.total_amount) || 0);
          const lineCost = (Number(row.cost_price) || 0) * (Number(row.quantity) || 0);
          onlineCogs += lineCost;
        }
        onlineRevenue = Array.from(orderTotals.values()).reduce((sum, amt) => sum + amt, 0);
        onlineOrderCount = orderTotals.size;
      } else {
        const orderIds = new Set<number>();
        for (const row of onlineRows) {
          orderIds.add(row.order_id);
          const lineGross = Number(row.total_price) || 0;
          const oSubtotal = Number(row.subtotal) || 0;
          const discountFactor = oSubtotal > 0 && row.discount > 0 ? (1 - (Number(row.discount) / oSubtotal)) : 1;
          onlineRevenue += lineGross * discountFactor;
          const lineCost = (Number(row.cost_price) || 0) * (Number(row.quantity) || 0);
          onlineCogs += lineCost;
        }
        onlineOrderCount = orderIds.size;
      }
    }

    onlineRevenue = FinancialCalculator.roundCurrency(onlineRevenue);
    onlineCogs = FinancialCalculator.roundCurrency(onlineCogs);

    // ─────────────────────────────────────────────────────────────────────────
    // 4. CENTRALIZED FINANCIAL ROLLUP
    // ─────────────────────────────────────────────────────────────────────────
    const totalRevenue = FinancialCalculator.roundCurrency(posRevenue + onlineRevenue);
    const orderCount = posOrderCount + onlineOrderCount;
    const totalCOGS = FinancialCalculator.roundCurrency(posCogs + onlineCogs);
    const totalProfit = FinancialCalculator.calculateGrossProfit(totalRevenue, totalCOGS);
    const profitMarginPercent = FinancialCalculator.calculateProfitMargin(totalProfit, totalRevenue);

    const averageOrderValue = FinancialCalculator.calculateAOV(totalRevenue, orderCount);
    const posAov = FinancialCalculator.calculateAOV(posRevenue, posOrderCount);
    const onlineAov = FinancialCalculator.calculateAOV(onlineRevenue, onlineOrderCount);

    // ─────────────────────────────────────────────────────────────────────────
    // 5. PRODUCT PERFORMANCE LEADERBOARD (Best-Selling & Most Profitable)
    // ─────────────────────────────────────────────────────────────────────────
    const productStatsMap = new Map<number, {
      id: number;
      name: string;
      category: string;
      barcode: string;
      quantitySold: number;
      revenue: number;
      cogs: number;
    }>();

    // Aggregate POS sales by product
    if (includePos && status !== 'CANCELLED') {
      let salesAggQuery = `
        SELECT 
          s.product_id,
          COALESCE(p.name, pv.name, 'Item') as product_name,
          COALESCE(pv.category, 'Dry Fruits') as category,
          COALESCE(pv.barcode, '') as barcode,
          SUM(s.qty_sold) as total_qty,
          SUM(s.qty_sold * s.unit_price) as total_rev,
          SUM(s.qty_sold * pv.cost_price) as total_cogs
        FROM sales s
        JOIN bills b ON s.bill_id = b.id
        LEFT JOIN product_variants pv ON s.product_id = pv.id
        LEFT JOIN products p ON pv.product_id = p.id
        WHERE b.bill_date BETWEEN ? AND ?
      `;
      const salesAggParams: any[] = [startDate, endDate];
      if (category) {
        salesAggQuery += ` AND pv.category = ?`;
        salesAggParams.push(category);
      }
      if (productId) {
        salesAggQuery += ` AND s.product_id = ?`;
        salesAggParams.push(productId);
      }
      salesAggQuery += ` GROUP BY s.product_id`;

      const posProdRows = db.prepare(salesAggQuery).all(...salesAggParams) as any[];
      for (const r of posProdRows) {
        productStatsMap.set(r.product_id, {
          id: r.product_id,
          name: r.product_name,
          category: r.category,
          barcode: r.barcode,
          quantitySold: Number(r.total_qty) || 0,
          revenue: Number(r.total_rev) || 0,
          cogs: Number(r.total_cogs) || 0
        });
      }
    }

    // Aggregate Online order items by product
    if (includeOnline) {
      let onlineAggQuery = `
        SELECT 
          oi.product_id,
          COALESCE(oi.product_name, p.name, 'Item') as product_name,
          COALESCE(pv.category, 'Dry Fruits') as category,
          COALESCE(pv.barcode, '') as barcode,
          SUM(oi.quantity) as total_qty,
          SUM(oi.total_price) as total_rev,
          SUM(oi.quantity * pv.cost_price) as total_cogs
        FROM online_order_items oi
        JOIN online_orders o ON oi.order_id = o.id
        LEFT JOIN product_variants pv ON oi.product_id = pv.id
        LEFT JOIN products p ON pv.product_id = p.id
        WHERE DATE(o.created_at) BETWEEN ? AND ?
      `;
      const onlineAggParams: any[] = [startDate, endDate];
      if (status === 'CANCELLED') {
        onlineAggQuery += ` AND o.status = 'CANCELLED'`;
      } else {
        onlineAggQuery += ` AND o.status != 'CANCELLED'`;
      }
      if (category) {
        onlineAggQuery += ` AND pv.category = ?`;
        onlineAggParams.push(category);
      }
      if (productId) {
        onlineAggQuery += ` AND oi.product_id = ?`;
        onlineAggParams.push(productId);
      }
      onlineAggQuery += ` GROUP BY oi.product_id`;

      const onlineProdRows = db.prepare(onlineAggQuery).all(...onlineAggParams) as any[];
      for (const r of onlineProdRows) {
        const existing = productStatsMap.get(r.product_id);
        if (existing) {
          existing.quantitySold += Number(r.total_qty) || 0;
          existing.revenue += Number(r.total_rev) || 0;
          existing.cogs += Number(r.total_cogs) || 0;
        } else {
          productStatsMap.set(r.product_id, {
            id: r.product_id,
            name: r.product_name,
            category: r.category,
            barcode: r.barcode,
            quantitySold: Number(r.total_qty) || 0,
            revenue: Number(r.total_rev) || 0,
            cogs: Number(r.total_cogs) || 0
          });
        }
      }
    }

    const performanceList: ProductPerformanceItem[] = Array.from(productStatsMap.values()).map(p => {
      const profit = FinancialCalculator.calculateGrossProfit(p.revenue, p.cogs);
      const profitMarginPercent = FinancialCalculator.calculateProfitMargin(profit, p.revenue);
      const averagePrice = p.quantitySold > 0 ? FinancialCalculator.roundCurrency(p.revenue / p.quantitySold) : 0;
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        barcode: p.barcode,
        quantitySold: p.quantitySold,
        revenue: FinancialCalculator.roundCurrency(p.revenue),
        cogs: FinancialCalculator.roundCurrency(p.cogs),
        profit,
        profitMarginPercent,
        averagePrice
      };
    });

    // Best selling ranked by quantity sold descending
    const bestSellingProducts = [...performanceList]
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 10);

    // Most profitable ranked by absolute profit descending
    const mostProfitableProducts = [...performanceList]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10);

    // ─────────────────────────────────────────────────────────────────────────
    // 6. CUSTOMER RETENTION & REPEAT PURCHASES
    // ─────────────────────────────────────────────────────────────────────────
    // Calculate customer order distribution across online orders and POS phone numbers
    const customerOrderCounts = db.prepare(`
      SELECT customer_id, COUNT(*) as order_cnt
      FROM online_orders
      WHERE status != 'CANCELLED'
      GROUP BY customer_id
    `).all() as { customer_id: number; order_cnt: number }[];

    const totalCustomers = customerOrderCounts.length;
    let repeatCustomersCount = 0;
    let repeatOrdersCount = 0;

    for (const c of customerOrderCounts) {
      if (c.order_cnt > 1) {
        repeatCustomersCount++;
        repeatOrdersCount += c.order_cnt;
      }
    }

    const repeatCustomerRatePercent = FinancialCalculator.calculateRepeatCustomerRate(repeatCustomersCount, totalCustomers);

    // ─────────────────────────────────────────────────────────────────────────
    // 7. CANCELLATION METRICS
    // ─────────────────────────────────────────────────────────────────────────
    const cancellationStats = db.prepare(`
      SELECT 
        COUNT(*) as total_attempts,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_count
      FROM online_orders
      WHERE DATE(created_at) BETWEEN ? AND ?
    `).get(startDate, endDate) as { total_attempts: number; cancelled_count: number };

    const totalOrdersAttempted = cancellationStats?.total_attempts || 0;
    const cancelledOrdersCount = cancellationStats?.cancelled_count || 0;
    const cancellationRatePercent = FinancialCalculator.calculateCancellationRate(cancelledOrdersCount, totalOrdersAttempted);

    // ─────────────────────────────────────────────────────────────────────────
    // 8. INVENTORY STOCK-OUTS & LOW STOCK
    // ─────────────────────────────────────────────────────────────────────────
    const stockOutRows = db.prepare(`
      SELECT 
        pv.id,
        COALESCE(p.name, pv.name, 'Product') as name,
        pv.barcode,
        pv.category,
        (pv.total_qty - pv.sold_qty) as stock,
        pv.selling_price
      FROM product_variants pv
      LEFT JOIN products p ON pv.product_id = p.id
      WHERE pv.active = 1 AND (pv.total_qty - pv.sold_qty) <= 0
      ORDER BY stock ASC
    `).all() as any[];

    const lowStockCountRow = db.prepare(`
      SELECT COUNT(*) as cnt
      FROM product_variants
      WHERE active = 1 AND (total_qty - sold_qty) > 0 AND (total_qty - sold_qty) < 5
    `).get() as { cnt: number };

    const stockOuts = {
      count: stockOutRows.length,
      lowStockCount: lowStockCountRow?.cnt || 0,
      items: stockOutRows.map(r => ({
        id: r.id,
        name: r.name,
        barcode: r.barcode,
        category: r.category || 'Dry Fruits',
        stock: r.stock,
        sellingPrice: r.selling_price
      }))
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 9. WHATSAPP CONVERSION FUNNEL
    // ─────────────────────────────────────────────────────────────────────────
    const waNotificationsRow = db.prepare(`
      SELECT COUNT(*) as sent_count 
      FROM whatsapp_notifications
      WHERE DATE(created_at) BETWEEN ? AND ?
    `).get(startDate, endDate) as { sent_count: number };

    const waOrdersRow = db.prepare(`
      SELECT COUNT(*) as confirmed_count 
      FROM online_orders
      WHERE DATE(created_at) BETWEEN ? AND ? AND status IN ('CONFIRMED', 'PACKING', 'READY', 'DISPATCHED', 'COMPLETED')
    `).get(startDate, endDate) as { confirmed_count: number };

    const notificationsSent = waNotificationsRow?.sent_count || 0;
    const confirmedOrders = waOrdersRow?.confirmed_count || 0;
    const whatsappConversionRatePercent = FinancialCalculator.calculateWhatsAppConversionRate(confirmedOrders, notificationsSent);

    // ─────────────────────────────────────────────────────────────────────────
    // 10. REVENUE TREND (Daily Timeline Points)
    // ─────────────────────────────────────────────────────────────────────────
    const trendMap = new Map<string, { pos: number; online: number; count: number }>();

    // Generate date array between startDate and endDate (cap at 60 points for cleanliness)
    const currentIter = new Date(startDate);
    const maxEnd = new Date(endDate);
    while (currentIter <= maxEnd) {
      const ds = currentIter.toISOString().split('T')[0];
      trendMap.set(ds, { pos: 0, online: 0, count: 0 });
      currentIter.setDate(currentIter.getDate() + 1);
    }

    if (includePos && status !== 'CANCELLED') {
      const posDaily = db.prepare(`
        SELECT bill_date, SUM(total_amount) as daily_rev, COUNT(DISTINCT id) as cnt
        FROM bills
        WHERE bill_date BETWEEN ? AND ?
        GROUP BY bill_date
      `).all(startDate, endDate) as any[];

      for (const p of posDaily) {
        if (trendMap.has(p.bill_date)) {
          const entry = trendMap.get(p.bill_date)!;
          entry.pos += Number(p.daily_rev) || 0;
          entry.count += Number(p.cnt) || 0;
        }
      }
    }

    if (includeOnline && status !== 'CANCELLED') {
      const onlineDaily = db.prepare(`
        SELECT DATE(created_at) as o_date, SUM(total_amount) as daily_rev, COUNT(DISTINCT id) as cnt
        FROM online_orders
        WHERE DATE(created_at) BETWEEN ? AND ? AND status != 'CANCELLED'
        GROUP BY DATE(created_at)
      `).all(startDate, endDate) as any[];

      for (const o of onlineDaily) {
        if (trendMap.has(o.o_date)) {
          const entry = trendMap.get(o.o_date)!;
          entry.online += Number(o.daily_rev) || 0;
          entry.count += Number(o.cnt) || 0;
        }
      }
    }

    const revenueTrend: RevenueTrendPoint[] = Array.from(trendMap.entries()).map(([dt, val]) => ({
      date: dt,
      posRevenue: FinancialCalculator.roundCurrency(val.pos),
      onlineRevenue: FinancialCalculator.roundCurrency(val.online),
      totalRevenue: FinancialCalculator.roundCurrency(val.pos + val.online),
      orderCount: val.count
    }));

    // ─────────────────────────────────────────────────────────────────────────
    // 11. CATEGORY BREAKDOWN
    // ─────────────────────────────────────────────────────────────────────────
    const categoryStatsMap = new Map<string, { revenue: number; qty: number; count: number }>();

    for (const p of performanceList) {
      const cat = p.category || 'Dry Fruits';
      const existing = categoryStatsMap.get(cat);
      if (existing) {
        existing.revenue += p.revenue;
        existing.qty += p.quantitySold;
        existing.count += 1;
      } else {
        categoryStatsMap.set(cat, {
          revenue: p.revenue,
          qty: p.quantitySold,
          count: 1
        });
      }
    }

    const categoryBreakdown: CategoryBreakdownItem[] = Array.from(categoryStatsMap.entries())
      .map(([cat, data]) => {
        const sharePercent = totalRevenue > 0 ? FinancialCalculator.roundPercentage((data.revenue / totalRevenue) * 100, 1) : 0;
        return {
          category: cat,
          revenue: FinancialCalculator.roundCurrency(data.revenue),
          quantitySold: data.qty,
          orderCount: data.count,
          sharePercent
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    // ─────────────────────────────────────────────────────────────────────────
    // 12. CHANNEL BREAKDOWN
    // ─────────────────────────────────────────────────────────────────────────
    const channelBreakdown = {
      pos: {
        revenue: posRevenue,
        count: posOrderCount,
        sharePercent: totalRevenue > 0 ? FinancialCalculator.roundPercentage((posRevenue / totalRevenue) * 100, 1) : 0
      },
      online: {
        revenue: onlineRevenue,
        count: onlineOrderCount,
        sharePercent: totalRevenue > 0 ? FinancialCalculator.roundPercentage((onlineRevenue / totalRevenue) * 100, 1) : 0
      }
    };

    return {
      todayRevenue,
      weeklyRevenue,
      monthlyRevenue,
      allTimeRevenue,

      totalRevenue,
      posRevenue,
      onlineRevenue,
      orderCount,
      posOrderCount,
      onlineOrderCount,
      averageOrderValue,
      posAov,
      onlineAov,

      totalCOGS,
      totalProfit,
      profitMarginPercent,

      bestSellingProducts,
      mostProfitableProducts,

      repeatCustomers: {
        totalCustomers,
        repeatCustomersCount,
        repeatOrdersCount,
        repeatCustomerRatePercent
      },

      cancellations: {
        totalOrdersAttempted,
        cancelledOrdersCount,
        cancellationRatePercent
      },

      stockOuts,

      whatsappConversion: {
        notificationsSent,
        confirmedOrders,
        conversionRatePercent: whatsappConversionRatePercent
      },

      revenueTrend,
      categoryBreakdown,
      channelBreakdown,

      filter: {
        startDate,
        endDate,
        preset,
        category,
        productId,
        channel,
        status
      }
    };
  }
}

export const analyticsService = new AnalyticsService();
