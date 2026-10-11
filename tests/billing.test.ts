import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

describe('Retail POS Financial Integrity Tests', () => {
  let testDb: any;

  beforeEach(() => {
    testDb = new Database(':memory:');
    // Execute schema for product_variants, bills, sales
    testDb.exec(`
      CREATE TABLE product_variants (
        id INTEGER PRIMARY KEY,
        name TEXT, cost_price REAL, selling_price REAL,
        total_qty REAL, sold_qty REAL DEFAULT 0,
        reserved_qty REAL DEFAULT 0,
        CONSTRAINT check_inventory CHECK (total_qty - sold_qty >= 0)
      );
      CREATE TABLE bills (
        id INTEGER PRIMARY KEY, total_amount REAL, discount_amount REAL
      );
      CREATE TABLE sales (
        id INTEGER PRIMARY KEY, bill_id INTEGER, product_id INTEGER,
        qty_sold REAL, profit_made REAL, unit_price REAL
      );
    `);
    testDb.prepare("INSERT INTO product_variants VALUES (1, 'Almonds', 700, 900, 10, 0, 0)").run();
  });

  it('should prevent ringing up items when requested quantity exceeds available stock', () => {
    const sellMoreThanStock = () => {
      testDb.transaction(() => {
        testDb.prepare("UPDATE product_variants SET sold_qty = sold_qty + 15 WHERE id = 1").run();
      })();
    };
    expect(sellMoreThanStock).toThrow(/check_inventory/);
  });

  it('should prevent POS checkout when requested quantity exceeds available unreserved stock (total_qty - sold_qty - reserved_qty >= ?)', () => {
    // 10 total - 0 sold - 8 reserved = 2 available for in-store POS
    testDb.prepare("UPDATE product_variants SET reserved_qty = 8 WHERE id = 1").run();

    const sellMoreThanAvailable = () => {
      testDb.transaction(() => {
        const requestedQty = 5;
        const update = testDb.prepare(`
          UPDATE product_variants 
          SET sold_qty = sold_qty + ? 
          WHERE id = ? AND (total_qty - sold_qty - reserved_qty) >= ?
        `).run(requestedQty, 1, requestedQty);

        if (update.changes === 0) {
          throw new Error('Transaction failed: Item out of stock');
        }
      })();
    };

    expect(sellMoreThanAvailable).toThrow(/Transaction failed: Item out of stock/);

    // Verify database state is untouched
    const variant = testDb.prepare("SELECT sold_qty, reserved_qty FROM product_variants WHERE id = 1").get();
    expect(variant.sold_qty).toBe(0);
    expect(variant.reserved_qty).toBe(8);

    // Selling within unreserved available stock (qty = 2) succeeds
    testDb.transaction(() => {
      const update = testDb.prepare(`
        UPDATE product_variants 
        SET sold_qty = sold_qty + ? 
        WHERE id = ? AND (total_qty - sold_qty - reserved_qty) >= ?
      `).run(2, 1, 2);
      expect(update.changes).toBe(1);
    })();

    const updated = testDb.prepare("SELECT sold_qty, reserved_qty FROM product_variants WHERE id = 1").get();
    expect(updated.sold_qty).toBe(2);
  });

  it('should accurately distribute cart discounts proportionally across items without penny loss', () => {
    const subtotal = 1000;
    const discount = 100;
    const item1 = { total: 600 };
    const item2 = { total: 400 };

    const disc1 = Math.round(discount * (item1.total / subtotal) * 100) / 100;
    const disc2 = discount - disc1; // Remaining discount on last item

    expect(disc1).toBe(60);
    expect(disc2).toBe(40);
    expect(disc1 + disc2).toBe(discount);
  });
});

describe('BillingService Integration with Stock Reservations', () => {
  it('should reject POS billing when online orders have reserved physical stock', async () => {
    const { default: db } = await import('../src/database.js');
    const { billingService } = await import('../src/services/billing.service.js');

    // Create test product with total_qty = 10, sold_qty = 0, reserved_qty = 8
    const p = db.prepare("INSERT INTO products (name) VALUES ('POS Reservation Guard Product')").run();
    const prodId = p.lastInsertRowid as number;
    const v = db.prepare(`
      INSERT INTO product_variants (product_id, name, barcode, selling_price, cost_price, total_qty, sold_qty, reserved_qty, category)
      VALUES (?, 'POS Reservation Guard Almonds', 'POS_RES_GUARD_01', 500, 350, 10, 0, 8, 'Dry Fruits')
    `).run(prodId);
    const variantId = v.lastInsertRowid as number;

    try {
      // 1. Attempt to ring up 5 units (exceeds available unreserved stock: 10 - 0 - 8 = 2)
      expect(() => {
        billingService.createBill('2026-10-11', '10:00 AM', [{
          id: variantId,
          name: 'POS Reservation Guard Almonds',
          qty: 5,
          price: 500,
          mrp: 600,
          cost: 350,
          total: 2500,
          tax_rate: 0
        }], 'Walk-in', '9876543210', 0, 'Cash', null);
      }).toThrow('Transaction failed: Item out of stock');

      // Verify no stock or sale was committed
      const variantAfterFail = db.prepare('SELECT sold_qty, reserved_qty FROM product_variants WHERE id = ?').get(variantId) as any;
      expect(variantAfterFail.sold_qty).toBe(0);
      expect(variantAfterFail.reserved_qty).toBe(8);

      // 2. Ringing up 2 units (exactly available unreserved stock) succeeds
      const bill = billingService.createBill('2026-10-11', '10:05 AM', [{
        id: variantId,
        name: 'POS Reservation Guard Almonds',
        qty: 2,
        price: 500,
        mrp: 600,
        cost: 350,
        total: 1000,
        tax_rate: 0
      }], 'Walk-in', '9876543210', 0, 'Cash', null);

      expect(bill).toBeDefined();
      expect(bill.total_amount).toBe(1000);

      const variantAfterSuccess = db.prepare('SELECT sold_qty, reserved_qty FROM product_variants WHERE id = ?').get(variantId) as any;
      expect(variantAfterSuccess.sold_qty).toBe(2);
      expect(variantAfterSuccess.reserved_qty).toBe(8);
      // Available unreserved stock is now 0 (10 - 2 - 8 = 0)
      expect(variantAfterSuccess.sold_qty + variantAfterSuccess.reserved_qty).toBe(10);

      // 3. Any additional POS attempt now fails
      expect(() => {
        billingService.createBill('2026-10-11', '10:10 AM', [{
          id: variantId,
          name: 'POS Reservation Guard Almonds',
          qty: 1,
          price: 500,
          mrp: 600,
          cost: 350,
          total: 500,
          tax_rate: 0
        }], 'Walk-in', '9876543210', 0, 'Cash', null);
      }).toThrow('Transaction failed: Item out of stock');

      // Cleanup
      db.prepare('DELETE FROM sales WHERE bill_id = ?').run(bill.id);
      db.prepare('DELETE FROM bills WHERE id = ?').run(bill.id);
      db.prepare('DELETE FROM stock_movements WHERE product_variant_id = ?').run(variantId);
    } finally {
      db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
      db.prepare('DELETE FROM products WHERE id = ?').run(prodId);
    }
  });
});
