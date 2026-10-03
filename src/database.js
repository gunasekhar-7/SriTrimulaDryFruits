import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../data/store.db');
// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const db = new Database(dbPath);
// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// ─── Schema ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff'))
  );

  CREATE TABLE IF NOT EXISTS products (
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
    tax_rate REAL NOT NULL DEFAULT 0,
    CONSTRAINT check_inventory CHECK (total_qty - sold_qty >= 0)
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    opening_time TEXT NOT NULL,
    closing_time TEXT,
    opening_cash REAL NOT NULL DEFAULT 0,
    expected_closing_cash REAL,
    actual_closing_cash REAL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))
  );

  CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_date TEXT NOT NULL,
    bill_time TEXT NOT NULL,
    total_amount REAL NOT NULL DEFAULT 0,
    customer_name TEXT DEFAULT '',
    customer_phone TEXT DEFAULT '',
    discount_amount REAL NOT NULL DEFAULT 0,
    payment_method TEXT DEFAULT 'Cash',
    shift_id INTEGER REFERENCES shifts(id)
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES bills(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty_sold REAL NOT NULL,
    profit_made REAL NOT NULL DEFAULT 0,
    sale_date TEXT NOT NULL,
    unit_price REAL NOT NULL
  );
`);
export default db;
