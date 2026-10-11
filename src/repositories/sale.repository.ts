import db from '../database.js';
import { Sale } from '../types/index.js';

export class SaleRepository {
  getSales(): Sale[] {
    return db.prepare('SELECT * FROM sales').all() as Sale[];
  }

  getSalesByBillId(billId: number): Sale[] {
    return db.prepare('SELECT * FROM sales WHERE bill_id = ?').all(billId) as Sale[];
  }

  getSaleById(id: number): Sale | undefined {
    return db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as Sale | undefined;
  }

  insertSale(billId: number, productId: number, qtySold: number, profitMade: number, saleDate: string, unitPrice: number): void {
    db.prepare(
      'INSERT INTO sales (bill_id, product_id, qty_sold, profit_made, sale_date, unit_price) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(billId, productId, qtySold, profitMade, saleDate, unitPrice);
  }

  updateSaleQtyAndProfit(saleId: number, newQty: number, profitDeduction: number): void {
    db.prepare('UPDATE sales SET qty_sold = ?, profit_made = profit_made - ? WHERE id = ?').run(newQty, profitDeduction, saleId);
  }

  deleteSale(saleId: number): void {
    db.prepare('DELETE FROM sales WHERE id = ?').run(saleId);
  }

  updateProfitForSale(saleId: number, diff: number): void {
    db.prepare('UPDATE sales SET profit_made = profit_made + ? WHERE id = ?').run(diff, saleId);
  }
}

export const saleRepository = new SaleRepository();
