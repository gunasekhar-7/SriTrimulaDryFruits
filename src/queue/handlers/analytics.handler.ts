import db from '../../database.js';
import { Job } from '../types.js';
import logger from '../../logger.js';

export interface AnalyticsJobPayload {
  date?: string; // YYYY-MM-DD
  period?: 'daily' | 'hourly';
}

export async function processAnalyticsAggregation(payload: AnalyticsJobPayload, job: Job<AnalyticsJobPayload>): Promise<any> {
  const targetDate = payload.date || new Date().toISOString().split('T')[0];
  logger.info(`[Queue] Computing analytics aggregation for ${targetDate} (Job #${job.id})`);

  // Ensure analytics cache table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_analytics_snapshots (
      date TEXT PRIMARY KEY,
      total_sales REAL DEFAULT 0,
      total_bills INTEGER DEFAULT 0,
      total_online_orders INTEGER DEFAULT 0,
      avg_bill_value REAL DEFAULT 0,
      top_products_json TEXT DEFAULT '[]',
      calculated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 1. Aggregate offline POS bills
  const billSummary = db.prepare(`
    SELECT 
      COUNT(*) as bill_count,
      COALESCE(SUM(total_amount), 0) as total_bill_amount
    FROM bills
    WHERE bill_date = ?
  `).get(targetDate) as { bill_count: number; total_bill_amount: number };

  // 2. Aggregate online orders
  const onlineSummary = db.prepare(`
    SELECT
      COUNT(*) as order_count,
      COALESCE(SUM(total_amount), 0) as total_order_amount
    FROM online_orders
    WHERE DATE(created_at) = ? AND status != 'CANCELLED'
  `).get(targetDate) as { order_count: number; total_order_amount: number };

  // 3. Aggregate top products for the day
  const topProducts = db.prepare(`
    SELECT 
      p.name,
      SUM(s.qty_sold) as total_qty,
      SUM(s.qty_sold * s.unit_price) as total_revenue
    FROM sales s
    JOIN bills b ON s.bill_id = b.id
    LEFT JOIN product_variants pv ON s.product_id = pv.id
    LEFT JOIN products p ON pv.product_id = p.id
    WHERE b.bill_date = ?
    GROUP BY p.name
    ORDER BY total_qty DESC
    LIMIT 10
  `).all(targetDate);

  const totalSales = (billSummary?.total_bill_amount || 0) + (onlineSummary?.total_order_amount || 0);
  const totalTransactions = (billSummary?.bill_count || 0) + (onlineSummary?.order_count || 0);
  const avgValue = totalTransactions > 0 ? Number((totalSales / totalTransactions).toFixed(2)) : 0;

  // 4. Save into daily snapshots
  db.prepare(`
    INSERT INTO daily_analytics_snapshots (date, total_sales, total_bills, total_online_orders, avg_bill_value, top_products_json, calculated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET
      total_sales = excluded.total_sales,
      total_bills = excluded.total_bills,
      total_online_orders = excluded.total_online_orders,
      avg_bill_value = excluded.avg_bill_value,
      top_products_json = excluded.top_products_json,
      calculated_at = CURRENT_TIMESTAMP
  `).run(
    targetDate,
    totalSales,
    billSummary?.bill_count || 0,
    onlineSummary?.order_count || 0,
    avgValue,
    JSON.stringify(topProducts)
  );

  logger.info(`[Queue] Analytics computed for ${targetDate}: Sales=₹${totalSales}, Transactions=${totalTransactions}`);
  return { date: targetDate, totalSales, totalTransactions, avgValue };
}
