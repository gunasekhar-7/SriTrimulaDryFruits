import db from '../src/database.js';

try {
  db.exec(`
    DROP TABLE IF EXISTS stock_reservations;
    
    CREATE TABLE stock_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER REFERENCES online_orders(id) ON DELETE CASCADE,
      cart_id INTEGER REFERENCES customer_carts(id) ON DELETE CASCADE,
      product_variant_id INTEGER NOT NULL REFERENCES product_variants(id),
      quantity REAL NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMMITTED', 'RELEASED')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX idx_stock_reservations_status ON stock_reservations(status);
    CREATE INDEX idx_stock_reservations_order ON stock_reservations(order_id);
  `);
  console.log('Recreated stock_reservations table with cart_id');
} catch (e) {
  console.error(e);
}
