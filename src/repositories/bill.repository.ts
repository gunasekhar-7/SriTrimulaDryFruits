import db from '../database.js';
import { Bill } from '../types/index.js';

export class BillRepository {
  getBills(): Bill[] {
    return db.prepare('SELECT * FROM bills ORDER BY id DESC').all() as Bill[];
  }

  getBillsWithProfit(): (Bill & { bill_profit: number })[] {
    return db.prepare(`
      SELECT b.*, COALESCE(SUM(s.profit_made), 0) as bill_profit
      FROM bills b
      LEFT JOIN sales s ON b.id = s.bill_id
      GROUP BY b.id
      ORDER BY b.id DESC
    `).all() as (Bill & { bill_profit: number })[];
  }

  getBillById(id: number): Bill | undefined {
    return db.prepare('SELECT * FROM bills WHERE id = ?').get(id) as Bill | undefined;
  }

  insertBill(dateStr: string, timeStr: string, totalAmount: number, customerName: string, customerPhone: string, discountAmount: number, paymentMethod: string, shiftId: number | null): number {
    const result = db.prepare(
      'INSERT INTO bills (bill_date, bill_time, total_amount, customer_name, customer_phone, discount_amount, payment_method, shift_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(dateStr, timeStr, totalAmount, customerName, customerPhone, discountAmount, paymentMethod, shiftId);
    return result.lastInsertRowid as number;
  }

  updateTotalAmount(billId: number, difference: number): void {
    db.prepare('UPDATE bills SET total_amount = total_amount + ? WHERE id = ?').run(difference, billId);
  }
}

export const billRepository = new BillRepository();
