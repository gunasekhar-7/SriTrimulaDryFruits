import db from '../src/database.js';

try {
  db.exec(`
    ALTER TABLE product_variants ADD COLUMN reserved_qty REAL NOT NULL DEFAULT 0;
  `);
  console.log('Added reserved_qty to product_variants');
} catch (e: any) {
  if (!e.message.includes('duplicate column')) {
    console.error(e);
  } else {
    console.log('reserved_qty already exists');
  }
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER REFERENCES online_orders(id) ON DELETE CASCADE,
      product_variant_id INTEGER NOT NULL REFERENCES product_variants(id),
      quantity REAL NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMMITTED', 'RELEASED')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stock_reservations_status ON stock_reservations(status);
    CREATE INDEX IF NOT EXISTS idx_stock_reservations_order ON stock_reservations(order_id);
  `);
  console.log('Created stock_reservations table');
} catch (e: any) {
  console.error(e);
}
