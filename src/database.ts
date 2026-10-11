import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(process.cwd(), 'data', 'store.db');

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath, { timeout: 5000 });

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 10000');

// ─── Schema ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku TEXT UNIQUE,
    barcode TEXT NOT NULL UNIQUE,
    size_weight REAL NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT 'unit',
    cost_price REAL NOT NULL DEFAULT 0,
    selling_price REAL NOT NULL DEFAULT 0,
    mrp REAL NOT NULL DEFAULT 0,
    total_qty REAL NOT NULL DEFAULT 0,
    sold_qty REAL NOT NULL DEFAULT 0,
    reserved_qty REAL NOT NULL DEFAULT 0,
    category TEXT DEFAULT 'Dry Fruits',
    image_url TEXT DEFAULT '',
    tax_rate REAL NOT NULL DEFAULT 0,
    active INTEGER DEFAULT 1,
    CONSTRAINT check_inventory CHECK (total_qty - sold_qty >= 0)
  );

  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    variant_id INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    is_primary INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    old_mrp REAL,
    new_mrp REAL,
    old_selling_price REAL,
    new_selling_price REAL,
    changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    changed_by TEXT
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

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT DEFAULT '',
    password_hash TEXT,
    account_status TEXT DEFAULT 'ACTIVE',
    delivery_address TEXT DEFAULT '',
    landmark TEXT DEFAULT '',
    pincode TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS customer_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    label TEXT DEFAULT 'Home',
    recipient_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT DEFAULT '',
    landmark TEXT DEFAULT '',
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    pincode TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_id ON customer_addresses(customer_id);

  CREATE TABLE IF NOT EXISTS online_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    subtotal REAL NOT NULL,
    delivery_charge REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    total_amount REAL NOT NULL,
    payment_mode TEXT CHECK (payment_mode IN ('COD', 'UPI_QR')),
    delivery_type TEXT CHECK (delivery_type IN ('DELIVERY', 'STORE_PICKUP')),
    status TEXT DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONFIRMED', 'PACKING', 'READY', 'DISPATCHED', 'COMPLETED', 'CANCELLED')),
    notes TEXT DEFAULT '',
    whatsapp_message_sent INTEGER DEFAULT 0,
    traceparent TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS online_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    unit_price REAL NOT NULL,
    quantity REAL NOT NULL,
    total_price REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_status_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    changed_by TEXT DEFAULT 'SYSTEM',
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS customer_carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS customer_cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cart_id INTEGER NOT NULL REFERENCES customer_carts(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity REAL NOT NULL,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cart_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_variant_id INTEGER NOT NULL REFERENCES product_variants(id),
    quantity_delta REAL NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('PURCHASE', 'POS_SALE', 'ONLINE_SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGED', 'RESERVATION', 'RESERVATION_RELEASE')),
    reference_type TEXT,
    reference_id TEXT,
    actor TEXT NOT NULL,
    notes TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_stock_movements_variant ON stock_movements(product_variant_id);

  CREATE TABLE IF NOT EXISTS stock_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES online_orders(id) ON DELETE CASCADE,
    cart_id INTEGER REFERENCES customer_carts(id) ON DELETE CASCADE,
    product_variant_id INTEGER NOT NULL REFERENCES product_variants(id),
    quantity REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMMITTED', 'RELEASED')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_stock_reservations_status ON stock_reservations(status);
  CREATE INDEX IF NOT EXISTS idx_stock_reservations_order ON stock_reservations(order_id);
  CREATE INDEX IF NOT EXISTS idx_stock_reservations_status_expires ON stock_reservations(status, expires_at);

  CREATE TABLE IF NOT EXISTS scheduler_locks (
    job_name TEXT PRIMARY KEY,
    locked_by TEXT NOT NULL,
    locked_until TEXT NOT NULL,
    last_run_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    response_status INTEGER,
    response_body TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS whatsapp_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    status_event TEXT NOT NULL,
    message_id TEXT,
    delivery_status TEXT NOT NULL CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED')),
    error_reason TEXT,
    attempts INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_id, status_event)
  );

  CREATE TABLE IF NOT EXISTS phone_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('REGISTRATION', 'ACCOUNT_LINK', 'PHONE_UPDATE')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    expires_at TEXT NOT NULL,
    resend_available_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_phone_verifications_active ON phone_verifications(phone, purpose, consumed_at, expires_at);
  CREATE INDEX IF NOT EXISTS idx_phone_verifications_rate_limit ON phone_verifications(phone, purpose, created_at);

  CREATE TABLE IF NOT EXISTS background_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_until TEXT,
    last_error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_background_jobs_polling ON background_jobs(status, run_at);
  CREATE INDEX IF NOT EXISTS idx_background_jobs_idempotency ON background_jobs(idempotency_key);

  CREATE TABLE IF NOT EXISTS backup_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    filepath TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    integrity_status TEXT NOT NULL CHECK(integrity_status IN ('PASSED', 'FAILED', 'PENDING')),
    upload_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(upload_status IN ('PENDING', 'UPLOADED', 'FAILED', 'SKIPPED')),
    restore_verified INTEGER NOT NULL DEFAULT 0,
    restore_tested_at TEXT,
    duration_ms INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_backup_history_created ON backup_history(created_at);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT NOT NULL,
    metadata TEXT,
    prev_hash TEXT,
    hash TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);

  CREATE TRIGGER IF NOT EXISTS prevent_audit_log_update
  BEFORE UPDATE ON audit_logs
  BEGIN
    SELECT RAISE(FAIL, 'Immutable audit log: UPDATE operations are strictly prohibited.');
  END;

  CREATE TRIGGER IF NOT EXISTS prevent_audit_log_delete
  BEFORE DELETE ON audit_logs
  BEGIN
    SELECT RAISE(FAIL, 'Immutable audit log: DELETE operations are strictly prohibited.');
  END;
`);

// Add traceparent column to online_orders if not present in existing databases
try {
  const tableInfo = db.pragma('table_info(online_orders)') as Array<{ name: string }>;
  if (tableInfo.length > 0 && !tableInfo.some(col => col.name === 'traceparent')) {
    db.exec(`ALTER TABLE online_orders ADD COLUMN traceparent TEXT`);
  }
} catch {
  // column already exists
}

// Seed the 6 official storefront categories if not already present
try {
  const seedCategories = [
    ['Dry Fruits', 'Premium California almonds, cashews, pistachios, raisins, and walnuts.'],
    ['Millets', 'Nutritious unpolished foxtail, barnyard, kodo, little, and pearl millets.'],
    ['Seeds', 'Superfood chia, pumpkin, flax, sunflower, and watermelon seeds.'],
    ['Spices', 'Handpicked Kashmiri saffron, cardamom, cloves, cinnamon, and black pepper.'],
    ['Nuts', 'Gourmet macadamias, hazelnuts, Brazil nuts, and pine nuts.'],
    ['Sweets', 'Traditional artisanal dry fruit laddoos, halwa, and festive gift boxes.']
  ];
  const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)');
  for (const [name, desc] of seedCategories) {
    insertCat.run(name, desc);
  }
} catch {
  // Categories already initialized or schema busy
}

import { instrumentDatabase } from './observability/index.js';
instrumentDatabase(db);

export function closeDatabase(): void {
  try {
    if (db && db.open) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    }
  } catch {
    // Ignore if already closed
  }
}

export default db;
