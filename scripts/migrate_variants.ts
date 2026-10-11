import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(process.cwd(), 'data', 'store.db'));

function migrate() {
  db.transaction(() => {
    // Check if migrated
    const hasCategories = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'").get();
    if (hasCategories) {
      console.log('Already migrated');
      return;
    }

    // 1. Rename table (this automatically updates foreign keys in SQLite)
    db.pragma('foreign_keys = ON');
    db.exec('ALTER TABLE products RENAME TO product_variants');

    // 2. Create new tables
    db.exec(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT ''
      );
      
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER REFERENCES categories(id),
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        active INTEGER DEFAULT 1
      );
      
      CREATE TABLE product_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        is_primary INTEGER DEFAULT 0
      );
      
      CREATE TABLE price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
        old_mrp REAL,
        new_mrp REAL,
        old_selling_price REAL,
        new_selling_price REAL,
        changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        changed_by TEXT
      );
    `);

    // 3. Add columns
    db.exec(`
      ALTER TABLE product_variants ADD COLUMN product_id INTEGER REFERENCES products(id) ON DELETE CASCADE;
      ALTER TABLE product_variants ADD COLUMN sku TEXT;
      ALTER TABLE product_variants ADD COLUMN size_weight REAL NOT NULL DEFAULT 1;
      ALTER TABLE product_variants ADD COLUMN unit TEXT NOT NULL DEFAULT 'unit';
      ALTER TABLE product_variants ADD COLUMN active INTEGER DEFAULT 1;
    `);

    // 4. Data Migration
    db.exec(`
      INSERT INTO categories (name) 
      SELECT DISTINCT category FROM product_variants WHERE category IS NOT NULL AND category != '';
    `);

    const variants = db.prepare('SELECT id, name, category, image_url FROM product_variants').all() as any[];
    
    const insertProduct = db.prepare('INSERT INTO products (category_id, name) VALUES (?, ?)');
    const updateVariant = db.prepare('UPDATE product_variants SET product_id = ?, unit = ?, size_weight = ?, sku = ? WHERE id = ?');
    const insertImage = db.prepare('INSERT INTO product_images (product_id, variant_id, image_url, is_primary) VALUES (?, ?, ?, 1)');

    for (const v of variants) {
      const cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(v.category) as any;
      const catId = cat ? cat.id : null;

      let baseName = v.name;
      let size_weight = 1;
      let unit = 'unit';

      const match = v.name.match(/^(.*?)\\s*(\\d+(?:\\.\\d+)?)\\s*(g|kg|ml|l|pcs|pc)$/i);
      if (match) {
        baseName = match[1].trim();
        size_weight = parseFloat(match[2]);
        unit = match[3].toLowerCase();
      }

      const pResult = insertProduct.run(catId, baseName);
      const pId = pResult.lastInsertRowid;
      const sku = `SKU-${v.id}`;

      updateVariant.run(pId, unit, size_weight, sku, v.id);

      if (v.image_url) {
        insertImage.run(pId, v.id, v.image_url);
      }
    }

    console.log('Migration successful');
  })();
}

migrate();
