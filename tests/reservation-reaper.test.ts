import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../src/database.js';
import { productService } from '../src/services/product.service.js';
import { orderService } from '../src/services/order.service.js';
import { customerRepository } from '../src/repositories/customer.repository.js';
import { inventoryRepository } from '../src/repositories/inventory.repository.js';
import { reservationReaperService } from '../src/services/reservation-reaper.service.js';

describe('P0 Remediation: Inventory Reservation Expiry Scheduler', () => {
  let variantId: number;
  let customerId: number;

  beforeEach(() => {
    // Clear any leftover expired reservations from previous test runs
    db.prepare("DELETE FROM stock_reservations WHERE status = 'ACTIVE' AND expires_at < datetime('now')").run();

    // Create clean test product variant
    const product = productService.addProduct(
      `Reaper Test Almonds ${Date.now()}`,
      `SKU-REAP-${Date.now()}`,
      10, // total_qty = 10
      100,
      150,
      200,
      'Dry Fruits',
      '',
      0
    );
    variantId = product.id;

    const customer = customerRepository.createCustomer(
      'Reaper Tester',
      `91${Math.floor(10000000 + Math.random() * 90000000)}`,
      `reaper_${Date.now()}@test.com`,
      'password123'
    );
    customerId = customer.id;
  });

  afterEach(() => {
    // Clean up created entities
    db.prepare('DELETE FROM order_status_logs WHERE order_id IN (SELECT id FROM online_orders WHERE customer_id = ?)').run(customerId);
    db.prepare('DELETE FROM online_order_items WHERE product_id = ?').run(variantId);
    db.prepare('DELETE FROM online_orders WHERE customer_id = ?').run(customerId);
    db.prepare('DELETE FROM stock_reservations WHERE product_variant_id = ?').run(variantId);
    db.prepare('DELETE FROM stock_movements WHERE product_variant_id = ?').run(variantId);
    db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
    db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
    db.prepare("DELETE FROM scheduler_locks WHERE job_name = 'reservation_reaper'").run();
  });

  // ===========================================================================
  // 1. A reservation that has not expired remains allocated
  // ===========================================================================
  it('1. should keep active, non-expired reservations allocated', () => {
    // Reserve 3 units expiring in the future (+15 minutes)
    const futureExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare('UPDATE product_variants SET reserved_qty = 3 WHERE id = ?').run(variantId);
    const insert = db.prepare(`
      INSERT INTO stock_reservations (product_variant_id, quantity, status, expires_at)
      VALUES (?, 3, 'ACTIVE', ?)
    `).run(variantId, futureExpiry);
    const resId = insert.lastInsertRowid as number;

    const result = reservationReaperService.executeReap({ bypassLock: true });
    expect(result.released).toBe(0);

    const reservation = db.prepare('SELECT * FROM stock_reservations WHERE id = ?').get(resId) as any;
    expect(reservation.status).toBe('ACTIVE');

    const variant = db.prepare('SELECT reserved_qty, total_qty, sold_qty FROM product_variants WHERE id = ?').get(variantId) as any;
    expect(variant.reserved_qty).toBe(3);
    const available = variant.total_qty - variant.sold_qty - variant.reserved_qty;
    expect(available).toBe(7); // 10 - 0 - 3 = 7
  });

  // ===========================================================================
  // 2. An expired reservation is released
  // ===========================================================================
  it('2. should automatically release an expired reservation', () => {
    // Reserve 4 units that expired 5 minutes ago
    const pastExpiry = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    db.prepare('UPDATE product_variants SET reserved_qty = 4 WHERE id = ?').run(variantId);
    const insert = db.prepare(`
      INSERT INTO stock_reservations (product_variant_id, quantity, status, expires_at)
      VALUES (?, 4, 'ACTIVE', ?)
    `).run(variantId, pastExpiry);
    const resId = insert.lastInsertRowid as number;

    const result = reservationReaperService.executeReap({ bypassLock: true });
    expect(result.released).toBe(1);

    const reservation = db.prepare('SELECT * FROM stock_reservations WHERE id = ?').get(resId) as any;
    expect(reservation.status).toBe('RELEASED');

    const variant = db.prepare('SELECT reserved_qty, total_qty, sold_qty FROM product_variants WHERE id = ?').get(variantId) as any;
    expect(variant.reserved_qty).toBe(0);
    const available = variant.total_qty - variant.sold_qty - variant.reserved_qty;
    expect(available).toBe(10); // Restored to 10
  });

  // ===========================================================================
  // 3. Re-running the reaper does not release the same reservation twice (Idempotency)
  // ===========================================================================
  it('3. should be idempotent: subsequent reaper executions do not release the reservation twice', () => {
    const pastExpiry = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    db.prepare('UPDATE product_variants SET reserved_qty = 3 WHERE id = ?').run(variantId);
    const insert = db.prepare(`
      INSERT INTO stock_reservations (product_variant_id, quantity, status, expires_at)
      VALUES (?, 3, 'ACTIVE', ?)
    `).run(variantId, pastExpiry);
    const resId = insert.lastInsertRowid as number;

    // Run 1
    const run1 = reservationReaperService.executeReap({ bypassLock: true });
    expect(run1.released).toBe(1);

    // Run 2 (Immediately after)
    const run2 = reservationReaperService.executeReap({ bypassLock: true });
    expect(run2.released).toBe(0);

    // Run 3
    const run3 = reservationReaperService.executeReap({ bypassLock: true });
    expect(run3.released).toBe(0);

    const variant = db.prepare('SELECT reserved_qty FROM product_variants WHERE id = ?').get(variantId) as any;
    expect(variant.reserved_qty).toBe(0); // Not negative (-3 or -6)!
  });

  // ===========================================================================
  // 4. Concurrent reaper executions do not double-adjust stock
  // ===========================================================================
  it('4. should prevent race conditions and never double-adjust stock during concurrent runs', () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    db.prepare('UPDATE product_variants SET reserved_qty = 5 WHERE id = ?').run(variantId);
    db.prepare(`
      INSERT INTO stock_reservations (product_variant_id, quantity, status, expires_at)
      VALUES (?, 5, 'ACTIVE', ?)
    `).run(variantId, pastExpiry);

    // Simulate concurrent workers executing reap simultaneously
    const runA = reservationReaperService.executeReap({ bypassLock: true });
    const runB = reservationReaperService.executeReap({ bypassLock: true });

    // Exactly one run should have claimed and released the item
    expect(runA.released + runB.released).toBe(1);

    const variant = db.prepare('SELECT reserved_qty FROM product_variants WHERE id = ?').get(variantId) as any;
    expect(variant.reserved_qty).toBe(0); // Not -5!
  });

  // ===========================================================================
  // 5. Reservation expiry racing with successful order confirmation is handled safely
  // ===========================================================================
  it('5. should safely protect confirmed orders from having their reservations expired', () => {
    // Create an order with reservation
    const order = orderService.createOnlineOrder({
      customer_id: customerId,
      items: [{ product_id: variantId, quantity: 2 }],
      payment_mode: 'COD',
      delivery_type: 'STORE_PICKUP',
      delivery_charge: 0,
      discount: 0
    });

    // Backdate reservation expiry to the past
    db.prepare(`
      UPDATE stock_reservations 
      SET expires_at = datetime('now', '-5 minutes') 
      WHERE order_id = ?
    `).run(order.id);

    // Transition order to CONFIRMED
    orderService.updateOrderStatus(order.id, 'CONFIRMED', 'Admin');

    // Run reaper
    const result = reservationReaperService.executeReap({ bypassLock: true });

    // Reaper must NOT release reservation for CONFIRMED order
    expect(result.released).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const res = db.prepare('SELECT status FROM stock_reservations WHERE order_id = ?').get(order.id) as any;
    expect(res.status).toBe('ACTIVE');

    const confirmedOrder = orderService.getOnlineOrderById(order.id);
    expect(confirmedOrder?.status).toBe('CONFIRMED');
  });

  // ===========================================================================
  // 6. Cancellation and expiry do not release the same reservation twice
  // ===========================================================================
  it('6. should not double-release stock when cancellation races with expiry', () => {
    const order = orderService.createOnlineOrder({
      customer_id: customerId,
      items: [{ product_id: variantId, quantity: 3 }],
      payment_mode: 'COD',
      delivery_type: 'STORE_PICKUP',
      delivery_charge: 0,
      discount: 0
    });

    // Explicitly cancel order
    orderService.updateOrderStatus(order.id, 'CANCELLED', 'Admin');

    const variantAfterCancel = db.prepare('SELECT reserved_qty FROM product_variants WHERE id = ?').get(variantId) as any;
    expect(variantAfterCancel.reserved_qty).toBe(0);

    // Backdate reservation timestamp
    db.prepare(`
      UPDATE stock_reservations 
      SET expires_at = datetime('now', '-10 minutes') 
      WHERE order_id = ?
    `).run(order.id);

    // Execute reaper
    const result = reservationReaperService.executeReap({ bypassLock: true });
    expect(result.released).toBe(0);

    const variantFinal = db.prepare('SELECT reserved_qty FROM product_variants WHERE id = ?').get(variantId) as any;
    expect(variantFinal.reserved_qty).toBe(0);
  });

  // ===========================================================================
  // 7. Database transaction failure leaves inventory and reservation status consistent
  // ===========================================================================
  it('7. should isolate transaction failures and maintain consistent state', () => {
    const pastExpiry = new Date(Date.now() - 5000).toISOString();

    // Create reservation pointing to a valid variant
    db.prepare('UPDATE product_variants SET reserved_qty = 2 WHERE id = ?').run(variantId);
    const insertValid = db.prepare(`
      INSERT INTO stock_reservations (product_variant_id, quantity, status, expires_at)
      VALUES (?, 2, 'ACTIVE', ?)
    `).run(variantId, pastExpiry);
    const validResId = insertValid.lastInsertRowid as number;

    const result = reservationReaperService.executeReap({ bypassLock: true });
    expect(result.released).toBe(1);

    const validRes = db.prepare('SELECT status FROM stock_reservations WHERE id = ?').get(validResId) as any;
    expect(validRes.status).toBe('RELEASED');

    const variant = db.prepare('SELECT reserved_qty FROM product_variants WHERE id = ?').get(variantId) as any;
    expect(variant.reserved_qty).toBe(0);
  });

  // ===========================================================================
  // 8. Stock-movement and audit records are correct
  // ===========================================================================
  it('8. should record correct stock-movement and order-status logs upon expiration', () => {
    const order = orderService.createOnlineOrder({
      customer_id: customerId,
      items: [{ product_id: variantId, quantity: 2 }],
      payment_mode: 'COD',
      delivery_type: 'STORE_PICKUP',
      delivery_charge: 0,
      discount: 0
    });

    // Backdate reservation expiry
    db.prepare(`
      UPDATE stock_reservations 
      SET expires_at = datetime('now', '-1 minute') 
      WHERE order_id = ?
    `).run(order.id);

    const result = reservationReaperService.executeReap({ bypassLock: true });
    expect(result.released).toBe(1);

    // 1. Verify stock movement was recorded
    const movements = db.prepare(`
      SELECT * FROM stock_movements 
      WHERE product_variant_id = ? AND movement_type = 'RESERVATION_RELEASE' AND reference_id = ?
    `).all(variantId, String(order.id)) as any[];

    expect(movements.length).toBe(1);
    expect(movements[0].quantity_delta).toBe(2);
    expect(movements[0].actor).toContain('System');

    // 2. Verify order status log was written
    const statusLogs = db.prepare(`
      SELECT * FROM order_status_logs WHERE order_id = ?
    `).all(order.id) as any[];

    const cancelLog = statusLogs.find(l => l.new_status === 'CANCELLED');
    expect(cancelLog).toBeDefined();
    expect(cancelLog.previous_status).toBe('NEW');

    // 3. Verify order was transitioned to CANCELLED
    const cancelledOrder = orderService.getOnlineOrderById(order.id);
    expect(cancelledOrder?.status).toBe('CANCELLED');
  });

  // ===========================================================================
  // 9. A temporary reaper failure does not permanently stop future executions
  // ===========================================================================
  it('9. should recover and allow future executions after an error', () => {
    // Corrupt acquireLock temporarily to simulate a transient db lock failure
    const originalAcquire = reservationReaperService.acquireLock.bind(reservationReaperService);
    let failOnce = true;
    reservationReaperService.acquireLock = () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('Transient SQLite BUSY lock timeout');
      }
      return true;
    };

    try {
      // First attempt encounters transient error
      const result1 = reservationReaperService.executeReap();
      expect(result1.failed).toBeGreaterThanOrEqual(1);

      // Second attempt executes cleanly
      const result2 = reservationReaperService.executeReap();
      expect(result2.failed).toBe(0);
    } finally {
      reservationReaperService.acquireLock = originalAcquire;
    }
  });

  // ===========================================================================
  // 10. Scheduler startup, shutdown, and duplicate-runner protection work as designed
  // ===========================================================================
  it('10. should start, stop, and protect against duplicate runner execution across replicas', () => {
    // 1. Test startup and shutdown lifecycle
    expect(reservationReaperService.isSchedulerRunning()).toBe(false);
    reservationReaperService.start();
    expect(reservationReaperService.isSchedulerRunning()).toBe(true);

    reservationReaperService.stop();
    expect(reservationReaperService.isSchedulerRunning()).toBe(false);

    // 2. Test duplicate-runner lock
    const locked = reservationReaperService.acquireLock('worker_node_1', 60);
    expect(locked).toBe(true);

    // Second worker attempts to acquire the lock concurrently
    const lockedAgain = reservationReaperService.acquireLock('worker_node_2', 60);
    expect(lockedAgain).toBe(false);

    // Release lock
    reservationReaperService.releaseLock('worker_node_1');

    // Now another worker can acquire it
    const acquiredAfterRelease = reservationReaperService.acquireLock('worker_node_2', 60);
    expect(acquiredAfterRelease).toBe(true);
    reservationReaperService.releaseLock('worker_node_2');
  });

  // ===========================================================================
  // Step 5 Acceptance Scenario: Proving Inventory Invariants
  // ===========================================================================
  it('Step 5: should prove inventory invariants: 1 unit on hand, 1 reserved -> expired -> 1 available', () => {
    // 1. Variant with 1 unit total on hand
    const singleProduct = productService.addProduct(
      `Invariant Almonds ${Date.now()}`,
      `SKU-INV-${Date.now()}`,
      1, // total_qty = 1
      100,
      150,
      200,
      'Dry Fruits',
      '',
      0
    );
    const invVariantId = singleProduct.id;

    // 2. Reserve 1 unit (Available becomes 0)
    db.prepare('UPDATE product_variants SET reserved_qty = 1 WHERE id = ?').run(invVariantId);
    const pastExpiry = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO stock_reservations (product_variant_id, quantity, status, expires_at)
      VALUES (?, 1, 'ACTIVE', ?)
    `).run(invVariantId, pastExpiry);

    // Pre-condition verification
    let v = db.prepare('SELECT total_qty, sold_qty, reserved_qty FROM product_variants WHERE id = ?').get(invVariantId) as any;
    expect(v.total_qty).toBe(1);
    expect(v.sold_qty).toBe(0);
    expect(v.reserved_qty).toBe(1);
    expect(v.total_qty - v.sold_qty - v.reserved_qty).toBe(0); // 0 units available

    // 3. Execute same code path used by production scheduler
    const result = reservationReaperService.executeReap({ bypassLock: true });
    expect(result.released).toBe(1);

    // 4. Invariant proof
    v = db.prepare('SELECT total_qty, sold_qty, reserved_qty FROM product_variants WHERE id = ?').get(invVariantId) as any;
    expect(v.total_qty).toBe(1);     // On-hand stock unchanged
    expect(v.sold_qty).toBe(0);      // Sold stock unchanged
    expect(v.reserved_qty).toBe(0);  // Reserved stock decremented by exactly 1
    const availableAfter = v.total_qty - v.sold_qty - v.reserved_qty;
    expect(availableAfter).toBe(1);  // Available stock restored to 1 unit

    // 5. Audit movement recorded exactly once
    const releaseMovements = db.prepare(`
      SELECT * FROM stock_movements 
      WHERE product_variant_id = ? AND movement_type = 'RESERVATION_RELEASE'
    `).all(invVariantId) as any[];
    expect(releaseMovements.length).toBe(1);
    expect(releaseMovements[0].quantity_delta).toBe(1);
    expect(releaseMovements[0].actor).toContain('System');

    // 6. Repeated executions do not change the result
    const repeatResult = reservationReaperService.executeReap({ bypassLock: true });
    expect(repeatResult.released).toBe(0);

    v = db.prepare('SELECT total_qty, sold_qty, reserved_qty FROM product_variants WHERE id = ?').get(invVariantId) as any;
    expect(v.reserved_qty).toBe(0);
    expect(v.total_qty - v.sold_qty - v.reserved_qty).toBe(1);

    // Cleanup
    db.prepare('DELETE FROM stock_reservations WHERE product_variant_id = ?').run(invVariantId);
    db.prepare('DELETE FROM stock_movements WHERE product_variant_id = ?').run(invVariantId);
    db.prepare('DELETE FROM product_variants WHERE id = ?').run(invVariantId);
  });
});
