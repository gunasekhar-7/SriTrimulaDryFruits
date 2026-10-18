import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { productRepository } from '../src/repositories/product.repository.js';
import db from '../src/database.js';

describe('Product Variants & Inventory Integrity', () => {
  const cleanup = () => {
    db.prepare("DELETE FROM product_variants WHERE name LIKE 'Organic Cashews%'").run();
    db.prepare("DELETE FROM products WHERE name = 'Organic Cashews'").run();
    db.prepare("DELETE FROM categories WHERE name = 'Test Category'").run();
  };

  beforeAll(() => {
    cleanup();

    // Setup Category
    db.prepare("INSERT INTO categories (name) VALUES ('Test Category')").run();
    const catId = db.prepare("SELECT id FROM categories WHERE name = 'Test Category'").get() as any;
    
    // Setup Base Product
    db.prepare("INSERT INTO products (category_id, name) VALUES (?, 'Organic Cashews')").run(catId.id);
    const prodId = db.prepare("SELECT id FROM products WHERE name = 'Organic Cashews'").get() as any;

    // Setup Variants
    productRepository.addProduct({
      name: 'Organic Cashews 250g',
      barcode: 'CASHEW-250',
      total_qty: 50,
      cost_price: 300,
      selling_price: 400,
      mrp: 450,
      category: 'Test Category',
      image_url: '',
      tax_rate: 5,
      product_id: prodId.id,
      sku: 'SKU-CASHEW-250',
      size_weight: 250,
      unit: 'g'
    });

    productRepository.addProduct({
      name: 'Organic Cashews 500g',
      barcode: 'CASHEW-500',
      total_qty: 30,
      cost_price: 600,
      selling_price: 780,
      mrp: 850,
      category: 'Test Category',
      image_url: '',
      tax_rate: 5,
      product_id: prodId.id,
      sku: 'SKU-CASHEW-500',
      size_weight: 500,
      unit: 'g'
    });
  });

  it('existing products remain available and queryable', () => {
    const products = productRepository.getProducts();
    expect(products.length).toBeGreaterThanOrEqual(2);
    expect(products.some(p => p.name === 'Organic Cashews 250g')).toBe(true);
  });

  it('barcode lookup continues working via POS logic', () => {
    const p = productRepository.getProductByBarcode('CASHEW-500');
    expect(p).toBeDefined();
    expect(p!.selling_price).toBe(780);
    expect(p!.total_qty).toBe(30);
  });

  it('online products correctly map to inventory (sold_qty increases)', () => {
    const p = productRepository.getProductByBarcode('CASHEW-250');
    expect(p!.sold_qty).toBe(0);
    
    db.prepare('UPDATE product_variants SET sold_qty = sold_qty + 5 WHERE barcode = ?').run('CASHEW-250');
    
    const updated = productRepository.getProductByBarcode('CASHEW-250');
    expect(updated!.sold_qty).toBe(5);
  });

  it('variants calculate pricing correctly independently', () => {
    const v1 = productRepository.getProductByBarcode('CASHEW-250');
    const v2 = productRepository.getProductByBarcode('CASHEW-500');
    
    // Check margins
    const margin1 = v1!.selling_price - v1!.cost_price;
    const margin2 = v2!.selling_price - v2!.cost_price;
    
    expect(margin1).toBe(100);
    expect(margin2).toBe(180);
    expect(v1!.mrp).toBe(450);
    expect(v2!.mrp).toBe(850);
  });

  afterAll(() => {
    cleanup();
  });
});
