import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../src/database.js';
import { productRepository } from '../src/repositories/product.repository.js';
import { productService } from '../src/services/product.service.js';
import { inventoryRepository } from '../src/repositories/inventory.repository.js';
import { billingService } from '../src/services/billing.service.js';
import { orderService } from '../src/services/order.service.js';
import { customerRepository } from '../src/repositories/customer.repository.js';
import { billRepository } from '../src/repositories/bill.repository.js';

describe('Inventory Ledger', () => {
  let variantId: number;
  let customerId: number;

  beforeEach(() => {
    const product = productService.addProduct('Test Ledger Cashew', 'TL-1234', 100, 400, 500, 600, 'Dry Fruits', '', 0);
    variantId = product.id;
    const customer = customerRepository.createCustomer('Test Inv Customer', '9999911111', 'test@inv.com', 'pwd');
    customerId = customer.id;
  });

  afterEach(() => {
    db.prepare('DELETE FROM online_order_items').run();
    db.prepare('DELETE FROM order_status_logs').run();
    db.prepare('DELETE FROM online_orders WHERE customer_id = ?').run(customerId);
    db.prepare('DELETE FROM sales').run();
    db.prepare('DELETE FROM bills').run();
    db.prepare('DELETE FROM stock_movements WHERE product_variant_id = ?').run(variantId);
    db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
    db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
  });

  it('should log PURCHASE on product creation and addStock', () => {
    let movements = inventoryRepository.getMovementsForVariant(variantId);
    expect(movements.length).toBe(1);
    expect(movements[0].movement_type).toBe('PURCHASE');
    expect(movements[0].quantity_delta).toBe(100);

    productService.addStock(variantId, 50);
    movements = inventoryRepository.getMovementsForVariant(variantId);
    expect(movements.length).toBe(2);
    expect(movements[0].movement_type).toBe('PURCHASE');
    expect(movements[0].quantity_delta).toBe(50);
  });

  it('should log ADJUSTMENT on updateProduct if total_qty changes', () => {
    productService.updateProduct(variantId, 'Test Ledger Cashew', 'TL-1234', 120, 400, 500, 600);
    const movements = inventoryRepository.getMovementsForVariant(variantId);
    expect(movements[0].movement_type).toBe('ADJUSTMENT');
    expect(movements[0].quantity_delta).toBe(20);
  });

  it('should log POS_SALE on billing and RETURN on returnItem', () => {
    const bill = billingService.createBill('2026-10-09', '12:00', [{
      id: variantId, name: 'Cashew', qty: 2, price: 500, mrp: 600, cost: 400, total: 1000, tax_rate: 0
    }]);

    let movements = inventoryRepository.getMovementsForVariant(variantId);
    // Movements: PURCHASE -> POS_SALE
    expect(movements[0].movement_type).toBe('POS_SALE');
    expect(movements[0].quantity_delta).toBe(-2);
    expect(movements[0].reference_id).toBe(bill.id.toString());

    // Get sale id
    const saleId = db.prepare('SELECT id FROM sales WHERE bill_id = ?').get(bill.id) as {id: number};
    billingService.returnItem(bill.id, saleId.id, variantId, 1);

    movements = inventoryRepository.getMovementsForVariant(variantId);
    expect(movements[0].movement_type).toBe('RETURN');
    expect(movements[0].quantity_delta).toBe(1);
  });

  it('should log RESERVATION, RESERVATION_RELEASE, and ONLINE_SALE for online orders', () => {
    const order = orderService.createOnlineOrder({
      customer_id: customerId,
      items: [{ product_id: variantId, quantity: 3 }],
      payment_mode: 'COD',
      delivery_type: 'STORE_PICKUP',
      delivery_charge: 0,
      discount: 0
    });

    let movements = inventoryRepository.getMovementsForVariant(variantId);
    expect(movements[0].movement_type).toBe('RESERVATION');
    expect(movements[0].quantity_delta).toBe(-3);
    
    // Complete order
    orderService.updateOrderStatus(order.id, 'COMPLETED', 'Admin');
    
    movements = inventoryRepository.getMovementsForVariant(variantId);
    // Should have RESERVATION_RELEASE and ONLINE_SALE added
    expect(movements[0].movement_type).toBe('ONLINE_SALE');
    expect(movements[0].quantity_delta).toBe(-3);
    
    expect(movements[1].movement_type).toBe('RESERVATION_RELEASE');
    expect(movements[1].quantity_delta).toBe(3);
  });

  it('should release reservation if cancelled before completion', () => {
    const order = orderService.createOnlineOrder({
      customer_id: customerId,
      items: [{ product_id: variantId, quantity: 2 }],
      payment_mode: 'COD',
      delivery_type: 'STORE_PICKUP',
      delivery_charge: 0,
      discount: 0
    });

    orderService.updateOrderStatus(order.id, 'CANCELLED', 'Admin');
    const movements = inventoryRepository.getMovementsForVariant(variantId);
    expect(movements[0].movement_type).toBe('RESERVATION_RELEASE');
    expect(movements[0].quantity_delta).toBe(2);
  });
});
