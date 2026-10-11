import db from '../database.js';
import { billRepository } from '../repositories/bill.repository.js';
import { saleRepository } from '../repositories/sale.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { CartItem, Bill, Sale } from '../types/index.js';
import { inventoryRepository } from '../repositories/inventory.repository.js';
import logger from '../logger.js';
import { metricsAggregator, withSpan } from '../observability/index.js';
import { auditService } from './audit.service.js';

export class BillingService {
  createBill(dateStr: string, timeStr: string, items: CartItem[], customer_name = '', customer_phone = '', discount_amount = 0, payment_method = 'Cash', shift_id: number | null = null): Bill {
    metricsAggregator.recordCheckoutAttempt('offline');
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const totalAmount = Math.max(0, subtotal - discount_amount);

    // Check repeat customer if phone provided
    let isRepeat = false;
    if (customer_phone && customer_phone.trim()) {
      try {
        const prior = db.prepare('SELECT COUNT(*) as count FROM bills WHERE customer_phone = ?').get(customer_phone.trim()) as any;
        if (prior && prior.count > 0) isRepeat = true;
      } catch {}
    }

    const createBillAndSales = db.transaction(() => {
      const billId = billRepository.insertBill(dateStr, timeStr, totalAmount, customer_name, customer_phone, discount_amount, payment_method, shift_id);

      let totalDiscountDistributed = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Enforce available stock constraint: total_qty - sold_qty - reserved_qty >= item.qty
        const update = db.prepare(`
          UPDATE product_variants 
          SET sold_qty = sold_qty + ? 
          WHERE id = ? AND (total_qty - sold_qty - reserved_qty) >= ?
        `).run(item.qty, item.id, item.qty);

        if (update.changes === 0) {
          throw new Error('Transaction failed: Item out of stock');
        }

        inventoryRepository.recordMovement(item.id, -item.qty, 'POS_SALE', shift_id ? `Shift:${shift_id}` : 'System', 'Bill', billId.toString(), 'POS Sale');


        const itemRatio = subtotal > 0 ? (item.total / subtotal) : (1 / items.length);
        const itemDiscount = (i === items.length - 1)
          ? (discount_amount - totalDiscountDistributed)
          : Math.round(discount_amount * itemRatio * 100) / 100;
        totalDiscountDistributed += itemDiscount;

        const baseProfit = (item.price - item.cost) * item.qty;
        const profit = Math.max(0, baseProfit - itemDiscount);

        saleRepository.insertSale(billId, item.id, item.qty, profit, dateStr, item.price);
      }

      const newBill = billRepository.getBillById(billId)!;
      logger.info('Payment completed', { event: 'payment.completed', billId, amount: totalAmount, method: payment_method });

      // Record business metrics
      metricsAggregator.recordOrderSuccess('offline', payment_method, totalAmount);
      if (isRepeat) {
        metricsAggregator.recordRepeatCustomerOrder('offline');
      }

      return newBill;
    });

    try {
      return createBillAndSales();
    } catch (error: any) {
      if (
        error.code === 'SQLITE_CONSTRAINT_CHECK' ||
        (error.message && (error.message.includes('check_inventory') || error.message.includes('Item out of stock')))
      ) {
        metricsAggregator.recordStockOut('POS Item', 'offline');
        throw new Error('Transaction failed: Item out of stock');
      }
      throw error;
    }
  }

  returnItem(billId: number, saleId: number, productId: number, returnQty: number, actor = 'System', source = 'POS_DESK'): boolean {
    const bill = billRepository.getBillById(billId);
    const sale = saleRepository.getSaleById(saleId);
    const product = productRepository.getProductById(productId);

    if (!bill || !sale || !product || returnQty <= 0 || returnQty > sale.qty_sold) return false;

    const refundAmount = returnQty * sale.unit_price;

    const returnTransaction = db.transaction(() => {
      const profitDeduction = returnQty * (sale.unit_price - product.cost_price);

      // Decrement sold qty
      db.prepare('UPDATE product_variants SET sold_qty = sold_qty - ? WHERE id = ?').run(returnQty, productId);
      inventoryRepository.recordMovement(productId, returnQty, 'RETURN', actor, 'Bill', billId.toString(), `Returned from Sale ${saleId}`);
      db.prepare('UPDATE bills SET total_amount = total_amount - ? WHERE id = ?').run(refundAmount, billId);

      const newQty = sale.qty_sold - returnQty;
      if (newQty <= 0) {
        saleRepository.deleteSale(saleId);
      } else {
        saleRepository.updateSaleQtyAndProfit(saleId, newQty, profitDeduction);
      }

      auditService.recordReturn({
        actor,
        source,
        billId,
        saleId,
        productId,
        productName: product.name,
        returnQty,
        unitPrice: sale.unit_price,
        refundAmount
      });

      auditService.recordRefund({
        actor,
        source,
        referenceType: 'BILL',
        referenceId: billId,
        refundAmount,
        method: bill.payment_method || 'Cash',
        reason: `Item return: ${returnQty}x ${product.name}`
      });
    });

    returnTransaction();
    return true;
  }

  updateProfitForBill(billId: number, newProfitTotal: number): boolean {
    const billSales = saleRepository.getSalesByBillId(billId);
    if (billSales.length === 0) return false;
    const currentSum = billSales.reduce((sum, s) => sum + s.profit_made, 0);
    const diff = newProfitTotal - currentSum;
    saleRepository.updateProfitForSale(billSales[0].id, diff);
    return true;
  }
}

export const billingService = new BillingService();
