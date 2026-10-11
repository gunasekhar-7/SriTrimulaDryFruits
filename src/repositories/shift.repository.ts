import db from '../database.js';
import { Shift } from '../types/index.js';

export class ShiftRepository {
  getOpenShiftByUserId(userId: number): Shift | undefined {
    return db.prepare("SELECT * FROM shifts WHERE user_id = ? AND status = 'open'").get(userId) as Shift | undefined;
  }

  openShift(userId: number, openingCash: number, timeStr: string): number {
    const result = db.prepare(
      "INSERT INTO shifts (user_id, opening_time, opening_cash, status) VALUES (?, ?, ?, 'open')"
    ).run(userId, timeStr, openingCash);
    return result.lastInsertRowid as number;
  }

  getShiftById(id: number): Shift | undefined {
    return db.prepare('SELECT * FROM shifts WHERE id = ?').get(id) as Shift | undefined;
  }

  getCashSalesForShift(shiftId: number): number {
    const result = db.prepare("SELECT SUM(total_amount) as total FROM bills WHERE shift_id = ? AND payment_method = 'Cash'").get(shiftId) as { total: number | null };
    return result.total || 0;
  }

  closeShift(shiftId: number, expectedCash: number, actualCash: number, closingTime: string): void {
    db.prepare(
      "UPDATE shifts SET status = 'closed', closing_time = ?, expected_closing_cash = ?, actual_closing_cash = ? WHERE id = ?"
    ).run(closingTime, expectedCash, actualCash, shiftId);
  }
}

export const shiftRepository = new ShiftRepository();
