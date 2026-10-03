import db from '../src/database.js';

console.log('Running database migrations...');

// 1. Add Payment Method to Bills
try {
    const checkColumn = db.prepare("PRAGMA table_info(bills)").all() as any[];
    const hasPaymentMethod = checkColumn.some(col => col.name === 'payment_method');
    
    if (!hasPaymentMethod) {
        db.prepare("ALTER TABLE bills ADD COLUMN payment_method TEXT DEFAULT 'Cash'").run();
        console.log('✅ Added payment_method column to bills table.');
    } else {
        console.log('⏭️ payment_method column already exists.');
    }
} catch (error) {
    console.error('❌ Error adding payment_method:', error);
}

// 2. Add Stock CHECK Constraint to Products
// SQLite doesn't support adding CHECK via ALTER TABLE. We must recreate the table.
try {
    db.transaction(() => {
        // Create new table with constraint
        db.prepare(`
            CREATE TABLE IF NOT EXISTS products_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                barcode TEXT UNIQUE NOT NULL,
                cost_price REAL NOT NULL,
                selling_price REAL NOT NULL,
                mrp REAL,
                total_qty REAL NOT NULL,
                sold_qty REAL DEFAULT 0,
                category TEXT,
                image_url TEXT,
                CHECK (total_qty - sold_qty >= 0)
            )
        `).run();

        // Copy data
        db.prepare(`INSERT INTO products_new SELECT * FROM products`).run();

        // Drop old table
        db.prepare(`DROP TABLE products`).run();

        // Rename new table to original name
        db.prepare(`ALTER TABLE products_new RENAME TO products`).run();
        
        console.log('✅ Recreated products table with strict stock constraints (total_qty - sold_qty >= 0).');
    })();
} catch (error) {
    console.error('❌ Error adding stock constraint:', error);
}

console.log('Migrations complete.');
