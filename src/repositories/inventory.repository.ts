import db from '../database.js';
import { StockMovement, MovementType } from '../types/index.js';
import logger from '../logger.js';
import { metricsAggregator } from '../observability/index.js';
import { reservationReaperService } from '../services/reservation-reaper.service.js';

export class InventoryRepository {
  recordMovement(
    variantId: number,
    quantityDelta: number,
    movementType: MovementType,
    actor: string,
    referenceType?: string,
    referenceId?: string,
    notes?: string
  ): number {
    const result = db.prepare(`
      INSERT INTO stock_movements 
        (product_variant_id, quantity_delta, movement_type, reference_type, reference_id, actor, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(variantId, quantityDelta, movementType, referenceType || null, referenceId || null, actor, notes || null);
    
    return result.lastInsertRowid as number;
  }

  getMovementsForVariant(variantId: number): StockMovement[] {
    return db.prepare(`
      SELECT * FROM stock_movements 
      WHERE product_variant_id = ? 
      ORDER BY timestamp DESC, id DESC
    `).all(variantId) as StockMovement[];
  }
  reserveStock(variantId: number, quantity: number, orderId?: number, cartId?: number, expiryMinutes?: number): number {
    const defaultMins = orderId ? (parseInt(process.env.ORDER_RESERVATION_EXPIRY_MINUTES || '15', 10)) : 15;
    const minutes = expiryMinutes || defaultMins;
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    
    // Atomic update to prevent race conditions
    const update = db.prepare(`
      UPDATE product_variants 
      SET reserved_qty = reserved_qty + ? 
      WHERE id = ? AND (total_qty - sold_qty - reserved_qty) >= ?
    `).run(quantity, variantId, quantity);

    if (update.changes === 0) {
      throw new Error(`Insufficient stock for product variant ${variantId}`);
    }

    const result = db.prepare(`
      INSERT INTO stock_reservations (order_id, cart_id, product_variant_id, quantity, status, expires_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', ?)
    `).run(orderId || null, cartId || null, variantId, quantity, expiresAt);

    logger.info('Inventory reserved', { event: 'inventory.reserved', variantId, quantity, orderId, cartId });

    return result.lastInsertRowid as number;
  }

  updateReservationOrder(reservationId: number, orderId: number): void {
    db.prepare('UPDATE stock_reservations SET order_id = ? WHERE id = ?').run(orderId, reservationId);
  }

  commitReservationByOrder(orderId: number): void {
    const reservations = db.prepare('SELECT * FROM stock_reservations WHERE order_id = ? AND status = ?').all(orderId, 'ACTIVE') as any[];
    for (const res of reservations) {
      const tx = db.transaction(() => {
        const update = db.prepare('UPDATE stock_reservations SET status = ? WHERE id = ? AND status = ?').run('COMMITTED', res.id, 'ACTIVE');
        if (update.changes > 0) {
          db.prepare('UPDATE product_variants SET reserved_qty = MAX(0, reserved_qty - ?) WHERE id = ?').run(res.quantity, res.product_variant_id);
          logger.info('Inventory sold (reservation committed)', { event: 'inventory.sold', variantId: res.product_variant_id, quantity: res.quantity, orderId });
        }
      });
      tx();
    }
  }

  releaseReservationByOrder(orderId: number): void {
    const reservations = db.prepare('SELECT * FROM stock_reservations WHERE order_id = ? AND status = ?').all(orderId, 'ACTIVE') as any[];
    for (const res of reservations) {
      const tx = db.transaction(() => {
        const update = db.prepare('UPDATE stock_reservations SET status = ? WHERE id = ? AND status = ?').run('RELEASED', res.id, 'ACTIVE');
        if (update.changes > 0) {
          db.prepare('UPDATE product_variants SET reserved_qty = MAX(0, reserved_qty - ?) WHERE id = ?').run(res.quantity, res.product_variant_id);
          logger.info('Inventory released', { event: 'inventory.released', variantId: res.product_variant_id, quantity: res.quantity, orderId });
        }
      });
      tx();
    }
  }

  releaseExpiredReservations(): void {
    reservationReaperService.executeReap({ bypassLock: true });
  }
}

export const inventoryRepository = new InventoryRepository();
