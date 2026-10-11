import { shiftRepository } from '../repositories/shift.repository.js';
import { Shift } from '../types/index.js';

export class ShiftService {
  getOpenShift(userId: number): Shift | undefined {
    return shiftRepository.getOpenShiftByUserId(userId);
  }

  openShift(userId: number, openingCash: number): Shift {
    if (this.getOpenShift(userId)) throw new Error('User already has an open shift');
    const now = new Date().toISOString();
    const id = shiftRepository.openShift(userId, openingCash, now);
    return shiftRepository.getShiftById(id)!;
  }

  getExpectedClosingCash(shiftId: number): number {
    const shift = shiftRepository.getShiftById(shiftId);
    if (!shift) return 0;
    const cashSales = shiftRepository.getCashSalesForShift(shiftId);
    return shift.opening_cash + cashSales;
  }

  closeShift(shiftId: number, actualCash: number): Shift {
    const expectedCash = this.getExpectedClosingCash(shiftId);
    const now = new Date().toISOString();
    shiftRepository.closeShift(shiftId, expectedCash, actualCash, now);
    return shiftRepository.getShiftById(shiftId)!;
  }
}

export const shiftService = new ShiftService();
