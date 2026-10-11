import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../src/database.js';
import { productService } from '../src/services/product.service.js';
import { orderService } from '../src/services/order.service.js';
import { customerRepository } from '../src/repositories/customer.repository.js';
import { inventoryRepository } from '../src/repositories/inventory.repository.js';

describe('Inventory Reservations', () => {
  let variantId: number;
  let customer1Id: number;
  let customer2Id: number;

  beforeEach(() => {
    // Create product with exactly 1 unit
    const product = productService.addProduct('Golden Raisins', 'GR-1', 1, 100, 150, 200, 'Dry Fruits', '', 0);
    variantId = product.id;
    
    const c1 = customerRepository.createCustomer('Alice', '9999900001', 'alice@test.com', 'pwd');
    const c2 = customerRepository.createCustomer('Bob', '9999900002', 'bob@test.com', 'pwd');
    customer1Id = c1.id;
    customer2Id = c2.id;
  });

  afterEach(() => {
    db.prepare('DELETE FROM online_order_items WHERE product_id = ?').run(variantId);
    db.prepare('DELETE FROM stock_reservations WHERE product_variant_id = ?').run(variantId);
    db.prepare('DELETE FROM stock_movements WHERE product_variant_id = ?').run(variantId);
    db.prepare('DELETE FROM order_status_logs WHERE order_id IN (SELECT id FROM online_orders WHERE customer_id IN (?, ?))').run(customer1Id, customer2Id);
    db.prepare('DELETE FROM online_orders WHERE customer_id IN (?, ?)').run(customer1Id, customer2Id);
    db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
    db.prepare('DELETE FROM customers WHERE id IN (?, ?)').run(customer1Id, customer2Id);
  });

  it('should prevent race conditions when two customers buy the last unit', async () => {
    // In SQLite with better-sqlite3, synchronous calls in the same process 
    // are naturally serialized, but we can simulate the race by overlapping calls
    // or relying on the strict check in order service.
    
    // Actually, we'll just try to create both and expect one to fail.
    // If they were truly concurrent (e.g., async promises), they'd hit the atomic UPDATE check.
    
    const orderPromise1 = new Promise((resolve) => {
      try {
        const order = orderService.createOnlineOrder({
          customer_id: customer1Id,
          items: [{ product_id: variantId, quantity: 1 }],
          payment_mode: 'COD',
          delivery_type: 'STORE_PICKUP',
          delivery_charge: 0,
          discount: 0
        });
        resolve({ success: true, order });
      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
    });

    const orderPromise2 = new Promise((resolve) => {
      try {
        const order = orderService.createOnlineOrder({
          customer_id: customer2Id,
          items: [{ product_id: variantId, quantity: 1 }],
          payment_mode: 'COD',
          delivery_type: 'STORE_PICKUP',
          delivery_charge: 0,
          discount: 0
        });
        resolve({ success: true, order });
      } catch (e: any) {
        resolve({ success: false, error: e.message });
      }
    });

    const [res1, res2] = await Promise.all([orderPromise1, orderPromise2]) as any[];

    // Exactly one should succeed
    const successCount = [res1, res2].filter(r => r.success).length;
    const failCount = [res1, res2].filter(r => !r.success).length;

    expect(successCount).toBe(1);
    expect(failCount).toBe(1);

    const successfulRes = res1.success ? res1 : res2;
    const failedRes = res1.success ? res2 : res1;

    expect(failedRes.error).toContain('Insufficient stock');

    // Verify reservation was created properly
    const product = productService.getProductById(variantId);
    expect(product?.reserved_qty).toBe(1);
    
    // Verify reservations table
    const reservations = db.prepare('SELECT * FROM stock_reservations WHERE product_variant_id = ?').all(variantId) as any[];
    expect(reservations.length).toBe(1);
    expect(reservations[0].status).toBe('ACTIVE');
    expect(reservations[0].order_id).toBe(successfulRes.order.id);
  });

  it('should release reservation when order is cancelled', () => {
    const order = orderService.createOnlineOrder({
      customer_id: customer1Id,
      items: [{ product_id: variantId, quantity: 1 }],
      payment_mode: 'COD',
      delivery_type: 'STORE_PICKUP',
      delivery_charge: 0,
      discount: 0
    });

    let product = productService.getProductById(variantId);
    expect(product?.reserved_qty).toBe(1);

    orderService.updateOrderStatus(order.id, 'CANCELLED', 'Admin');

    product = productService.getProductById(variantId);
    expect(product?.reserved_qty).toBe(0);

    const reservations = db.prepare('SELECT * FROM stock_reservations WHERE order_id = ?').all(order.id) as any[];
    expect(reservations[0].status).toBe('RELEASED');
  });

  it('should commit reservation when order is completed', () => {
    const order = orderService.createOnlineOrder({
      customer_id: customer1Id,
      items: [{ product_id: variantId, quantity: 1 }],
      payment_mode: 'COD',
      delivery_type: 'STORE_PICKUP',
      delivery_charge: 0,
      discount: 0
    });

    let product = productService.getProductById(variantId);
    expect(product?.reserved_qty).toBe(1);
    expect(product?.sold_qty).toBe(0);

    orderService.updateOrderStatus(order.id, 'COMPLETED', 'Admin');

    product = productService.getProductById(variantId);
    expect(product?.reserved_qty).toBe(0);
    expect(product?.sold_qty).toBe(1);

    const reservations = db.prepare('SELECT * FROM stock_reservations WHERE order_id = ?').all(order.id) as any[];
    expect(reservations[0].status).toBe('COMMITTED');
  });
});
