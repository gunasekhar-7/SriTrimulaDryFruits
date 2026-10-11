import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

describe('Unit Tests: Inventory & Reservation Logic', () => {
  let db: any;

  beforeEach(() => {
    // In-memory SQLite with schema identical to production
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );

      CREATE TABLE product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        barcode TEXT NOT NULL UNIQUE,
        cost_price REAL NOT NULL DEFAULT 0,
        selling_price REAL NOT NULL DEFAULT 0,
        total_qty REAL NOT NULL DEFAULT 0,
        sold_qty REAL NOT NULL DEFAULT 0,
        reserved_qty REAL NOT NULL DEFAULT 0,
        CONSTRAINT check_inventory CHECK (total_qty - sold_qty >= 0)
      );

      CREATE TABLE stock_reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        product_variant_id INTEGER NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMMITTED', 'RELEASED')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_variant_id INTEGER NOT NULL REFERENCES product_variants(id),
        quantity_delta REAL NOT NULL,
        movement_type TEXT NOT NULL CHECK (movement_type IN ('PURCHASE', 'POS_SALE', 'ONLINE_SALE', 'RETURN', 'RESERVATION', 'RESERVATION_RELEASE')),
        actor TEXT NOT NULL,
        notes TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    db.prepare("INSERT INTO products (id, name) VALUES (1, 'Kashmiri Almonds')").run();
    db.prepare(`
      INSERT INTO product_variants (id, product_id, barcode, cost_price, selling_price, total_qty, sold_qty, reserved_qty)
      VALUES (1, 1, 'TEST_ALMOND_01', 600, 800, 20, 5, 3)
    `).run();
  });

  afterEach(() => {
    db.close();
  });

  describe('1. Inventory Calculations & Constraints', () => {
    it('should compute available stock taking both sold_qty and reserved_qty into account', () => {
      const variant = db.prepare('SELECT total_qty, sold_qty, reserved_qty FROM product_variants WHERE id = 1').get();
      const available = variant.total_qty - variant.sold_qty - variant.reserved_qty;
      // 20 total - 5 sold - 3 reserved = 12 available
      expect(available).toBe(12);
    });

    it('should enforce SQLite check_inventory constraint when sold_qty exceeds total_qty', () => {
      const overSell = () => {
        db.prepare('UPDATE product_variants SET sold_qty = 21 WHERE id = 1').run();
      };
      expect(overSell).toThrow(/check_inventory/);
    });

    it('should prevent in-store POS billing from selling stock reserved for online orders', () => {
      // 20 total - 5 sold - 3 reserved = 12 available initially
      // Online orders reserve 10 more units -> reserved_qty = 13, available = 2
      db.prepare('UPDATE product_variants SET reserved_qty = 13 WHERE id = 1').run();

      const posOversell = () => {
        db.transaction(() => {
          const requestedQty = 5; // greater than 2 available
          const update = db.prepare(`
            UPDATE product_variants 
            SET sold_qty = sold_qty + ? 
            WHERE id = ? AND (total_qty - sold_qty - reserved_qty) >= ?
          `).run(requestedQty, 1, requestedQty);

          if (update.changes === 0) {
            throw new Error('Transaction failed: Item out of stock');
          }
        })();
      };

      expect(posOversell).toThrow(/Transaction failed: Item out of stock/);

      // Verify sold_qty is unchanged
      const variant = db.prepare('SELECT sold_qty, reserved_qty FROM product_variants WHERE id = 1').get();
      expect(variant.sold_qty).toBe(5);
      expect(variant.reserved_qty).toBe(13);

      // Selling within unreserved quantity (2) succeeds
      db.transaction(() => {
        const update = db.prepare(`
          UPDATE product_variants 
          SET sold_qty = sold_qty + ? 
          WHERE id = ? AND (total_qty - sold_qty - reserved_qty) >= ?
        `).run(2, 1, 2);
        expect(update.changes).toBe(1);
      })();

      const updatedVariant = db.prepare('SELECT total_qty, sold_qty, reserved_qty FROM product_variants WHERE id = 1').get();
      expect(updatedVariant.sold_qty).toBe(7);
      expect(updatedVariant.reserved_qty).toBe(13);
      expect(updatedVariant.total_qty - updatedVariant.sold_qty - updatedVariant.reserved_qty).toBe(0);
    });

    it('should accurately replenish inventory on product return', () => {
      const initial = db.prepare('SELECT sold_qty FROM product_variants WHERE id = 1').get();
      expect(initial.sold_qty).toBe(5);

      const returnQty = 2;
      db.transaction(() => {
        db.prepare('UPDATE product_variants SET sold_qty = sold_qty - ? WHERE id = 1').run(returnQty);
        db.prepare(`
          INSERT INTO stock_movements (product_variant_id, quantity_delta, movement_type, actor, notes)
          VALUES (1, ?, 'RETURN', 'Staff', 'Defective packaging return')
        `).run(returnQty);
      })();

      const updated = db.prepare('SELECT sold_qty FROM product_variants WHERE id = 1').get();
      expect(updated.sold_qty).toBe(3);

      const movement = db.prepare("SELECT * FROM stock_movements WHERE movement_type = 'RETURN'").get();
      expect(movement.quantity_delta).toBe(2);
      expect(movement.movement_type).toBe('RETURN');
    });
  });

  describe('2. Reservation Lifecycle & State Locks', () => {
    it('should reserve available stock, increment reserved_qty, and log ACTIVE reservation', () => {
      const orderId = 101;
      const reserveQty = 4;

      db.transaction(() => {
        const item = db.prepare('SELECT total_qty, sold_qty, reserved_qty FROM product_variants WHERE id = 1').get();
        const available = item.total_qty - item.sold_qty - item.reserved_qty;
        if (available < reserveQty) throw new Error('Insufficient stock');

        db.prepare('UPDATE product_variants SET reserved_qty = reserved_qty + ? WHERE id = 1').run(reserveQty);
        db.prepare(`
          INSERT INTO stock_reservations (order_id, product_variant_id, quantity, status, expires_at)
          VALUES (?, 1, ?, 'ACTIVE', datetime('now', '+15 minutes'))
        `).run(orderId, reserveQty);
        db.prepare(`
          INSERT INTO stock_movements (product_variant_id, quantity_delta, movement_type, actor, notes)
          VALUES (1, ?, 'RESERVATION', 'System', 'Online Order #101')
        `).run(-reserveQty);
      })();

      const variant = db.prepare('SELECT total_qty, sold_qty, reserved_qty FROM product_variants WHERE id = 1').get();
      expect(variant.reserved_qty).toBe(7); // 3 original + 4 reserved
      const remainingAvailable = variant.total_qty - variant.sold_qty - variant.reserved_qty;
      expect(remainingAvailable).toBe(8); // 20 - 5 - 7 = 8

      const reservation = db.prepare('SELECT * FROM stock_reservations WHERE order_id = 101').get();
      expect(reservation.status).toBe('ACTIVE');
      expect(reservation.quantity).toBe(4);
    });

    it('should prevent reservation when requested quantity exceeds available unreserved stock', () => {
      const orderId = 102;
      const excessiveQty = 13; // only 12 available (20 - 5 - 3 = 12)

      const tryReserve = () => {
        db.transaction(() => {
          const item = db.prepare('SELECT total_qty, sold_qty, reserved_qty FROM product_variants WHERE id = 1').get();
          const available = item.total_qty - item.sold_qty - item.reserved_qty;
          if (available < excessiveQty) {
            throw new Error(`Insufficient stock. Available: ${available}, Requested: ${excessiveQty}`);
          }
          db.prepare('UPDATE product_variants SET reserved_qty = reserved_qty + ? WHERE id = 1').run(excessiveQty);
        })();
      };

      expect(tryReserve).toThrow(/Insufficient stock/);
    });

    it('should release reservation on order cancellation', () => {
      const orderId = 103;
      const reserveQty = 2;

      // Create reservation
      db.prepare('UPDATE product_variants SET reserved_qty = reserved_qty + ? WHERE id = 1').run(reserveQty);
      db.prepare(`
        INSERT INTO stock_reservations (order_id, product_variant_id, quantity, status, expires_at)
        VALUES (?, 1, ?, 'ACTIVE', datetime('now', '+15 minutes'))
      `).run(orderId, reserveQty);

      // Release reservation
      db.transaction(() => {
        const res = db.prepare("SELECT * FROM stock_reservations WHERE order_id = ? AND status = 'ACTIVE'").get(orderId);
        expect(res).toBeDefined();

        db.prepare('UPDATE product_variants SET reserved_qty = reserved_qty - ? WHERE id = ?').run(res.quantity, res.product_variant_id);
        db.prepare("UPDATE stock_reservations SET status = 'RELEASED' WHERE id = ?").run(res.id);
        db.prepare(`
          INSERT INTO stock_movements (product_variant_id, quantity_delta, movement_type, actor, notes)
          VALUES (?, ?, 'RESERVATION_RELEASE', 'Customer', 'Cancelled Order')
        `).run(res.product_variant_id, res.quantity);
      })();

      const variant = db.prepare('SELECT reserved_qty FROM product_variants WHERE id = 1').get();
      expect(variant.reserved_qty).toBe(3); // restored back to 3

      const updatedRes = db.prepare('SELECT status FROM stock_reservations WHERE order_id = 103').get();
      expect(updatedRes.status).toBe('RELEASED');
    });

    it('should commit reservation on order completion (decrement reserved_qty, increment sold_qty)', () => {
      const orderId = 104;
      const reserveQty = 3;

      // Create active reservation
      db.prepare('UPDATE product_variants SET reserved_qty = reserved_qty + ? WHERE id = 1').run(reserveQty);
      db.prepare(`
        INSERT INTO stock_reservations (order_id, product_variant_id, quantity, status, expires_at)
        VALUES (?, 1, ?, 'ACTIVE', datetime('now', '+15 minutes'))
      `).run(orderId, reserveQty);

      // Commit reservation upon order completion
      db.transaction(() => {
        const res = db.prepare("SELECT * FROM stock_reservations WHERE order_id = ? AND status = 'ACTIVE'").get(orderId);
        expect(res).toBeDefined();

        // 1. Decrement reserved_qty
        db.prepare('UPDATE product_variants SET reserved_qty = reserved_qty - ? WHERE id = ?').run(res.quantity, res.product_variant_id);
        // 2. Increment sold_qty
        db.prepare('UPDATE product_variants SET sold_qty = sold_qty + ? WHERE id = ?').run(res.quantity, res.product_variant_id);
        // 3. Mark reservation COMMITTED
        db.prepare("UPDATE stock_reservations SET status = 'COMMITTED' WHERE id = ?").run(res.id);
        // 4. Log movements
        db.prepare(`
          INSERT INTO stock_movements (product_variant_id, quantity_delta, movement_type, actor, notes)
          VALUES (?, ?, 'ONLINE_SALE', 'Admin', 'Delivered Order #104')
        `).run(res.product_variant_id, -res.quantity);
      })();

      const variant = db.prepare('SELECT total_qty, sold_qty, reserved_qty FROM product_variants WHERE id = 1').get();
      expect(variant.reserved_qty).toBe(3); // was 3+3=6, decremented by 3 => 3
      expect(variant.sold_qty).toBe(8);     // was 5, incremented by 3 => 8
      expect(variant.total_qty - variant.sold_qty - variant.reserved_qty).toBe(9); // 20 - 8 - 3 = 9

      const reservation = db.prepare('SELECT status FROM stock_reservations WHERE order_id = 104').get();
      expect(reservation.status).toBe('COMMITTED');
    });
  });
});
