import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OrderStateMachine, OrderStatus } from '../src/services/order-state-machine.js';
import { orderService } from '../src/services/order.service.js';
import { customerRepository } from '../src/repositories/customer.repository.js';
import { productService } from '../src/services/product.service.js';
import db from '../src/database.js';
import request from 'supertest';
import { app } from '../server.js';

describe('Order State Machine', () => {
  it('should allow valid transitions', () => {
    expect(() => OrderStateMachine.validateTransition('NEW', 'CONFIRMED')).not.toThrow();
    expect(() => OrderStateMachine.validateTransition('CONFIRMED', 'PACKING')).not.toThrow();
    expect(() => OrderStateMachine.validateTransition('PACKING', 'READY')).not.toThrow();
    expect(() => OrderStateMachine.validateTransition('READY', 'DISPATCHED')).not.toThrow();
    expect(() => OrderStateMachine.validateTransition('DISPATCHED', 'COMPLETED')).not.toThrow();
  });

  it('should allow cancellations from appropriate states', () => {
    expect(() => OrderStateMachine.validateTransition('NEW', 'CANCELLED')).not.toThrow();
    expect(() => OrderStateMachine.validateTransition('CONFIRMED', 'CANCELLED')).not.toThrow();
    expect(() => OrderStateMachine.validateTransition('PACKING', 'CANCELLED')).not.toThrow();
    expect(() => OrderStateMachine.validateTransition('READY', 'CANCELLED')).not.toThrow();
    expect(() => OrderStateMachine.validateTransition('DISPATCHED', 'CANCELLED')).not.toThrow();
    expect(() => OrderStateMachine.validateTransition('COMPLETED', 'CANCELLED')).not.toThrow();
  });

  it('should reject invalid transitions', () => {
    expect(() => OrderStateMachine.validateTransition('COMPLETED', 'NEW')).toThrow(/Invalid order status transition/);
    expect(() => OrderStateMachine.validateTransition('CANCELLED', 'PACKING')).toThrow(/Invalid order status transition/);
    expect(() => OrderStateMachine.validateTransition('DISPATCHED', 'CONFIRMED')).toThrow(/Invalid order status transition/);
    expect(() => OrderStateMachine.validateTransition('NEW', 'READY')).toThrow(/Invalid order status transition/);
  });

  it('should reject repeated transitions', () => {
    expect(() => OrderStateMachine.validateTransition('NEW', 'NEW')).toThrow(/Invalid order status transition/);
    expect(() => OrderStateMachine.validateTransition('CONFIRMED', 'CONFIRMED')).toThrow(/Invalid order status transition/);
    expect(() => OrderStateMachine.validateTransition('CANCELLED', 'CANCELLED')).toThrow(/Invalid order status transition/);
  });
});

describe('Order Service State Enforcement', () => {
  let customerId: number;
  let variantId: number;

  beforeEach(() => {
    const c = customerRepository.createCustomer('OSM Cust', '9999922222', 'osm@example.com', 'pwd');
    customerId = c.id;
    const p = productService.addProduct('OSM Product', 'OSM-1', 10, 100, 150, 200, 'Dry Fruits', '', 0);
    variantId = p.id;
  });

  afterEach(() => {
    db.prepare('DELETE FROM online_order_items WHERE product_id = ?').run(variantId);
    db.prepare('DELETE FROM order_status_logs WHERE order_id IN (SELECT id FROM online_orders WHERE customer_id = ?)').run(customerId);
    db.prepare('DELETE FROM stock_reservations WHERE product_variant_id = ?').run(variantId);
    db.prepare('DELETE FROM online_orders WHERE customer_id = ?').run(customerId);
    db.prepare('DELETE FROM stock_movements WHERE product_variant_id = ?').run(variantId);
    db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
    db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
  });

  it('should enforce state machine in service layer', () => {
    const order = orderService.createOnlineOrder({
      customer_id: customerId,
      items: [{ product_id: variantId, quantity: 1 }],
      payment_mode: 'COD',
      delivery_type: 'STORE_PICKUP',
      delivery_charge: 0,
      discount: 0
    });

    // Valid
    expect(() => orderService.updateOrderStatus(order.id, 'CONFIRMED', 'Admin')).not.toThrow();
    
    // Invalid jump
    expect(() => orderService.updateOrderStatus(order.id, 'DISPATCHED', 'Admin')).toThrow(/Invalid order status transition/);

    // Cancel
    expect(() => orderService.updateOrderStatus(order.id, 'CANCELLED', 'Admin')).not.toThrow();

    // From Cancelled is invalid
    expect(() => orderService.updateOrderStatus(order.id, 'PACKING', 'Admin')).toThrow(/Invalid order status transition/);
  });

  it('should reject unauthorized transitions via API', async () => {
    const order = orderService.createOnlineOrder({
      customer_id: customerId,
      items: [{ product_id: variantId, quantity: 1 }],
      payment_mode: 'COD',
      delivery_type: 'STORE_PICKUP',
      delivery_charge: 0,
      discount: 0
    });

    // Anonymous request
    const res = await request(app)
      .post(`/admin/online-orders/${order.id}/status`)
      .send({ new_status: 'CONFIRMED' });
    
    // Should be redirected to login because requireAuth (staff auth) blocks it
    expect(res.status).toBe(302);
    expect(res.header.location).toBe('/login');
    
    // Customer auth request
    // We would simulate customer login, but since this uses session, we can just pass an empty session which requireAuth rejects.
    // The previous tests verify that customer auth uses requireCustomerAuth and staff uses requireAuth.
  });
});
