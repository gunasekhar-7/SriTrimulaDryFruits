import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../data/store.db');

const db = new Database(dbPath);

console.log('Starting products table migration...');

// We use a transaction to ensure atomicity
const migrate = db.transaction(() => {
  // 1. Create a new temporary table with the constraint
  db.exec(`
    CREATE TABLE IF NOT EXISTS products_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      barcode TEXT NOT NULL UNIQUE,
      cost_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      mrp REAL NOT NULL DEFAULT 0,
      total_qty REAL NOT NULL DEFAULT 0,
      sold_qty REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'Dry Fruits',
      image_url TEXT DEFAULT '',
      CONSTRAINT check_inventory CHECK (total_qty - sold_qty >= 0)
    )
  `);

  // 2. Copy data from the old table to the new one
  db.exec(`
    INSERT INTO products_new (id, name, barcode, cost_price, selling_price, mrp, total_qty, sold_qty, category, image_url)
    SELECT id, name, barcode, cost_price, selling_price, mrp, total_qty, sold_qty, category, image_url
    FROM products
  `);

  // 3. Drop the old table
  db.exec(`DROP TABLE products`);

  // 4. Rename the new table
  db.exec(`ALTER TABLE products_new RENAME TO products`);
});

try {
  migrate();
  console.log('Migration completed successfully!');
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}
