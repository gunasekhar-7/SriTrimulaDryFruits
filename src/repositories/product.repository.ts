import db from '../database.js';
import { Product } from '../types/index.js';

export interface StorefrontCategoryInfo {
  name: string;
  slug: string;
  url: string;
  emoji: string;
  tagline: string;
  shortName: string;
  productCount: number;
}

export class ProductRepository {
  getProducts(): Product[] {
    return db.prepare(`
      SELECT pv.*, p.name as base_name, p.category_id
      FROM product_variants pv
      LEFT JOIN products p ON pv.product_id = p.id
      WHERE pv.active = 1
      ORDER BY pv.name ASC
    `).all() as Product[];
  }

  getProductById(id: number): Product | undefined {
    return db.prepare(`
      SELECT pv.*, p.name as base_name, p.category_id, p.description as product_description
      FROM product_variants pv
      LEFT JOIN products p ON pv.product_id = p.id
      WHERE pv.id = ?
    `).get(id) as Product | undefined;
  }

  getCategories(): string[] {
    const rows = db.prepare(`
      SELECT name FROM (
        SELECT name FROM categories WHERE name IS NOT NULL AND TRIM(name) != '' AND name NOT LIKE 'Test%'
        UNION
        SELECT DISTINCT category AS name FROM product_variants WHERE active = 1 AND category IS NOT NULL AND TRIM(category) != '' AND category NOT LIKE 'Test%'
      )
      ORDER BY 
        CASE name
          WHEN 'Dry Fruits' THEN 1
          WHEN 'Millets' THEN 2
          WHEN 'Seeds' THEN 3
          WHEN 'Spices' THEN 4
          WHEN 'Nuts' THEN 5
          WHEN 'Sweets' THEN 6
          ELSE 7
        END,
        name ASC
    `).all() as { name: string }[];
    return rows.map(r => r.name);
  }

  getStorefrontCategories(): StorefrontCategoryInfo[] {
    const categories = this.getCategories();
    
    const countRows = db.prepare(`
      SELECT category, COUNT(*) as count 
      FROM product_variants 
      WHERE active = 1 AND category IS NOT NULL AND TRIM(category) != ''
      GROUP BY category
    `).all() as { category: string; count: number }[];
    
    const countMap = new Map<string, number>();
    for (const row of countRows) {
      countMap.set(row.category.toLowerCase().trim(), row.count);
    }

    const metadata: Record<string, { emoji: string; tagline: string; shortName: string }> = {
      'dry fruits': { emoji: '🌰', tagline: 'Royal Almonds & Cashews', shortName: 'Dry Fruits & Almonds' },
      'millets': { emoji: '🌾', tagline: 'Wholesome Millets', shortName: 'Wholesome Millets' },
      'seeds': { emoji: '🌱', tagline: 'Superfood Berries & Seeds', shortName: 'Superfood Seeds' },
      'spices': { emoji: '🌶️', tagline: 'Kashmiri Walnuts & Saffron', shortName: 'Spices & Saffron' },
      'nuts': { emoji: '🥜', tagline: 'Imported Dates & Figs', shortName: 'Nuts & Dates' },
      'sweets': { emoji: '🍬', tagline: 'Handcrafted Gift Boxes', shortName: 'Artisanal Sweets' },
    };

    return categories.map(cat => {
      const lower = cat.toLowerCase().trim();
      const meta = metadata[lower] || { emoji: '✨', tagline: cat, shortName: cat };
      return {
        name: cat,
        slug: encodeURIComponent(cat),
        url: `/category/${encodeURIComponent(cat)}`,
        emoji: meta.emoji,
        tagline: meta.tagline,
        shortName: meta.shortName,
        productCount: countMap.get(lower) || 0
      };
    });
  }

  getProductsByCategory(category: string): Product[] {
    return db.prepare(`
      SELECT * FROM product_variants 
      WHERE active = 1 AND category = ? 
      ORDER BY name ASC
    `).all(category) as Product[];
  }

  getProductByBarcode(barcode: string): Product | undefined {
    return db.prepare('SELECT * FROM product_variants WHERE barcode = ?').get(barcode) as Product | undefined;
  }

  checkBarcodeExists(barcode: string, excludeId?: number): boolean {
    if (excludeId) {
      return !!db.prepare('SELECT id FROM product_variants WHERE barcode = ? AND id != ?').get(barcode, excludeId);
    }
    return !!db.prepare('SELECT id FROM product_variants WHERE barcode = ?').get(barcode);
  }

  addProduct(data: { name: string; barcode: string; total_qty: number; cost_price: number; selling_price: number; mrp: number; category: string; image_url: string; tax_rate: number; product_id?: number; sku?: string; size_weight?: number; unit?: string }): number {
    const result = db.prepare(
      'INSERT INTO product_variants (name, barcode, total_qty, sold_qty, cost_price, selling_price, mrp, category, image_url, tax_rate, product_id, sku, size_weight, unit) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(data.name, data.barcode, data.total_qty, data.cost_price, data.selling_price, data.mrp, data.category, data.image_url, data.tax_rate, data.product_id || null, data.sku || null, data.size_weight || 1, data.unit || 'unit');
    return result.lastInsertRowid as number;
  }

  updateProduct(id: number, data: { name: string; barcode: string; total_qty: number; cost_price: number; selling_price: number; mrp: number; category: string; image_url: string; tax_rate: number; product_id?: number; sku?: string; size_weight?: number; unit?: string }): void {
    db.prepare(
      'UPDATE product_variants SET name=?, barcode=?, total_qty=?, cost_price=?, selling_price=?, mrp=?, category=?, image_url=?, tax_rate=?, product_id=?, sku=?, size_weight=?, unit=? WHERE id=?'
    ).run(data.name, data.barcode, data.total_qty, data.cost_price, data.selling_price, data.mrp, data.category, data.image_url, data.tax_rate, data.product_id || null, data.sku || null, data.size_weight || 1, data.unit || 'unit', id);
  }

  addStock(id: number, qty: number, imageUrl?: string): void {
    if (imageUrl !== undefined) {
      db.prepare('UPDATE product_variants SET total_qty = total_qty + ?, image_url = ? WHERE id = ?').run(qty, imageUrl, id);
    } else {
      db.prepare('UPDATE product_variants SET total_qty = total_qty + ? WHERE id = ?').run(qty, id);
    }
  }

  deleteProduct(id: number): void {
    db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(id);
  }
}

export const productRepository = new ProductRepository();
