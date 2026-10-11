import db from '../database.js';
import { OnlineOrder, OnlineOrderItem, OrderStatusLog } from '../types/index.js';

export class OnlineOrderRepository {
  insertOrder(data: { order_number: string, customer_id: number, subtotal: number, delivery_charge: number, discount: number, total_amount: number, payment_mode: string, delivery_type: string, notes: string, status: string, traceparent?: string }): number {
    const result = db.prepare(`
      INSERT INTO online_orders (order_number, customer_id, subtotal, delivery_charge, discount, total_amount, payment_mode, delivery_type, notes, status, traceparent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.order_number, data.customer_id, data.subtotal, data.delivery_charge, data.discount, data.total_amount, data.payment_mode, data.delivery_type, data.notes, data.status, data.traceparent || null);
    return result.lastInsertRowid as number;
  }

  updateTraceparent(orderId: number, traceparent: string): void {
    db.prepare('UPDATE online_orders SET traceparent = ? WHERE id = ?').run(traceparent, orderId);
  }

  updateOrderNumber(orderId: number, orderNumber: string): void {
    db.prepare('UPDATE online_orders SET order_number = ? WHERE id = ?').run(orderNumber, orderId);
  }

  insertOrderItem(orderId: number, productId: number, productName: string, unitPrice: number, quantity: number, totalPrice: number): void {
    db.prepare(`
      INSERT INTO online_order_items (order_id, product_id, product_name, unit_price, quantity, total_price)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(orderId, productId, productName, unitPrice, quantity, totalPrice);
  }

  insertStatusLog(orderId: number, previousStatus: string | null, newStatus: string, changedBy: string): void {
    db.prepare(`
      INSERT INTO order_status_logs (order_id, previous_status, new_status, changed_by)
      VALUES (?, ?, ?, ?)
    `).run(orderId, previousStatus, newStatus, changedBy);
  }

  getOrderById(id: number): OnlineOrder | undefined {
    return db.prepare('SELECT * FROM online_orders WHERE id = ?').get(id) as OnlineOrder | undefined;
  }

  getOrderItems(orderId: number): OnlineOrderItem[] {
    return db.prepare('SELECT * FROM online_order_items WHERE order_id = ?').all(orderId) as OnlineOrderItem[];
  }

  getOrders(filters?: { status?: string, search?: string, startDate?: string, endDate?: string, limit?: number, offset?: number }): OnlineOrder[] {
    let query = 'SELECT o.* FROM online_orders o JOIN customers c ON o.customer_id = c.id WHERE 1=1';
    const params: any[] = [];
    
    if (filters?.status && filters.status !== 'ALL') {
      query += ' AND o.status = ?';
      params.push(filters.status);
    }
    
    if (filters?.startDate) {
      query += ' AND date(o.created_at) >= ?';
      params.push(filters.startDate);
    }
    
    if (filters?.endDate) {
      query += ' AND date(o.created_at) <= ?';
      params.push(filters.endDate);
    }
    
    if (filters?.search) {
      query += ' AND (o.order_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)';
      const searchWildcard = `%${filters.search}%`;
      params.push(searchWildcard, searchWildcard, searchWildcard);
    }
    
    query += ' ORDER BY o.id DESC';
    
    if (filters?.limit !== undefined) {
      query += ' LIMIT ?';
      params.push(filters.limit);
      if (filters?.offset !== undefined) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    }
    return db.prepare(query).all(...params) as OnlineOrder[];
  }

  getOrdersByCustomer(customerId: number): OnlineOrder[] {
    return db.prepare('SELECT * FROM online_orders WHERE customer_id = ? ORDER BY id DESC').all(customerId) as OnlineOrder[];
  }

  updateOrderStatus(orderId: number, status: string): void {
    db.prepare('UPDATE online_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, orderId);
  }

  getPendingOrdersCount(): number {
    const result = db.prepare(`SELECT COUNT(*) as count FROM online_orders WHERE status IN ('NEW', 'CONFIRMED', 'PACKING')`).get() as { count: number };
    return result.count;
  }

  markWhatsAppSent(orderId: number): void {
    db.prepare('UPDATE online_orders SET whatsapp_message_sent = 1 WHERE id = ?').run(orderId);
  }

  getStatusLogs(orderId: number): OrderStatusLog[] {
    return db.prepare('SELECT * FROM order_status_logs WHERE order_id = ? ORDER BY timestamp DESC').all(orderId) as OrderStatusLog[];
  }

  getRecentPendingOrderByPhone(phone: string): OnlineOrder | undefined {
    return db.prepare(`
      SELECT o.*
      FROM online_orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE c.phone LIKE ? AND o.status IN ('NEW', 'PENDING')
      ORDER BY o.created_at DESC
      LIMIT 1
    `).get(`%${phone}`) as OnlineOrder | undefined;
  }

  getOrderByOrderNumber(orderNumber: string): OnlineOrder | undefined {
    return db.prepare('SELECT * FROM online_orders WHERE order_number = ?').get(orderNumber) as OnlineOrder | undefined;
  }

  getOrderByNumberAndPhone(orderNumber: string, phone: string): OnlineOrder | undefined {
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    return db.prepare(`
      SELECT o.*
      FROM online_orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE (o.order_number = ? OR o.order_number = ?) AND c.phone LIKE ?
    `).get(orderNumber.trim(), orderNumber.trim().toUpperCase(), `%${cleanPhone}`) as OnlineOrder | undefined;
  }
}

export const onlineOrderRepository = new OnlineOrderRepository();
