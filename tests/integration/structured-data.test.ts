import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import { seoService } from '../../src/services/seo.service.js';

describe('Accurate Product and GroceryStore Structured Data (JSON-LD) Suite', () => {
  let inStockProductId: number;
  let outOfStockProductId: number;
  let noSkuProductId: number;
  let specialCharProductId: number;

  beforeAll(() => {
    // 1. In-stock product with full identifiers
    let inStock = db.prepare('SELECT id FROM product_variants WHERE barcode = ?').get('SD-IN-101') as any;
    if (!inStock) {
      db.prepare(`
        INSERT INTO product_variants (name, barcode, category, cost_price, selling_price, mrp, total_qty, sold_qty, active)
        VALUES ('Kashmiri Saffron Almonds', 'SD-IN-101', 'Dry Fruits', 600, 899.50, 1100, 40, 5, 1)
      `).run();
      inStock = db.prepare('SELECT id FROM product_variants WHERE barcode = ?').get('SD-IN-101') as any;
    }
    inStockProductId = inStock.id;

    // 2. Out-of-stock product
    let outStock = db.prepare('SELECT id FROM product_variants WHERE barcode = ?').get('SD-OUT-102') as any;
    if (!outStock) {
      db.prepare(`
        INSERT INTO product_variants (name, barcode, category, cost_price, selling_price, mrp, total_qty, sold_qty, active)
        VALUES ('Jumbo Pistachios Salted', 'SD-OUT-102', 'Dry Fruits', 500, 750, 950, 10, 10, 1)
      `).run();
      outStock = db.prepare('SELECT id FROM product_variants WHERE barcode = ?').get('SD-OUT-102') as any;
    }
    outOfStockProductId = outStock.id;

    // 3. Product with missing optional barcode & SKU
    let noSku = db.prepare('SELECT id FROM product_variants WHERE name = ?').get('Organic Flax Seeds Bulk') as any;
    if (!noSku) {
      db.prepare(`
        INSERT INTO product_variants (name, barcode, category, cost_price, selling_price, mrp, total_qty, sold_qty, active)
        VALUES ('Organic Flax Seeds Bulk', '', 'Seeds', 80, 120, 150, 20, 0, 1)
      `).run();
      noSku = db.prepare('SELECT id FROM product_variants WHERE name = ?').get('Organic Flax Seeds Bulk') as any;
    }
    noSkuProductId = noSku.id;

    // 4. Product with special characters & potential script tags
    let specialChar = db.prepare('SELECT id FROM product_variants WHERE barcode = ?').get('SD-SPEC-104') as any;
    if (!specialChar) {
      db.prepare(`
        INSERT INTO product_variants (name, barcode, category, cost_price, selling_price, mrp, total_qty, sold_qty, active)
        VALUES ('Cashews <Grade A+> & "Royal" Nuts </script><script>alert(1)</script>', 'SD-SPEC-104', 'Dry Fruits', 700, 950, 1200, 30, 0, 1)
      `).run();
      specialChar = db.prepare('SELECT id FROM product_variants WHERE barcode = ?').get('SD-SPEC-104') as any;
    }
    specialCharProductId = specialChar.id;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // A. STORE STRUCTURED DATA (GroceryStore / LocalBusiness)
  // ──────────────────────────────────────────────────────────────────────────
  describe('A. GroceryStore Structured Data on Homepage (/)', () => {
    it('emits valid, parseable GroceryStore and LocalBusiness JSON-LD on Homepage', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);

      // Extract JSON-LD script blocks
      const jsonLdBlocks = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(jsonLdBlocks.length).toBeGreaterThanOrEqual(1);

      const parsedSchemas = jsonLdBlocks.map(b => JSON.parse(b[1]));
      const storeSchema = parsedSchemas.find(s => 
        (Array.isArray(s['@type']) && s['@type'].includes('GroceryStore')) ||
        s['@type'] === 'GroceryStore'
      );

      expect(storeSchema).toBeDefined();
      expect(storeSchema['@context']).toBe('https://schema.org');
      expect(storeSchema['@id']).toBe('https://sritirumaladryfruits.com/#store');
      expect(storeSchema.name).toBe('Sri Tirumala Dryfruits & Millets');
      expect(storeSchema.url).toBe('https://sritirumaladryfruits.com');
      expect(storeSchema.telephone).toBe('+919133133931');
      expect(storeSchema.priceRange).toBe('₹₹');
      expect(storeSchema.currenciesAccepted).toBe('INR');
      expect(storeSchema.paymentAccepted).toContain('UPI');

      // Authentic Tekkali address
      expect(storeSchema.address.streetAddress).toBe('Opposite RTC Complex');
      expect(storeSchema.address.addressLocality).toBe('Tekkali');
      expect(storeSchema.address.addressRegion).toBe('Andhra Pradesh');
      expect(storeSchema.address.postalCode).toBe('532201');
      expect(storeSchema.address.addressCountry).toBe('IN');

      // Authentic GeoCoordinates
      expect(Number(storeSchema.geo.latitude)).toBe(18.6163);
      expect(Number(storeSchema.geo.longitude)).toBe(84.2335);

      // Opening hours
      expect(Array.isArray(storeSchema.openingHoursSpecification)).toBe(true);
      expect(storeSchema.openingHoursSpecification[0].opens).toBe('09:00');
      expect(storeSchema.openingHoursSpecification[0].closes).toBe('21:30');

      // Zero host leakage
      const rawJson = JSON.stringify(storeSchema);
      expect(rawJson).not.toContain('localhost');
      expect(rawJson).not.toContain('127.0.0.1');
      expect(rawJson).not.toContain('http://');
      expect(rawJson).not.toContain('3000');
    });

    it('does NOT emit Product schema on Homepage', async () => {
      const res = await request(app).get('/');
      const jsonLdBlocks = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const parsedSchemas = jsonLdBlocks.map(b => JSON.parse(b[1]));
      const productSchema = parsedSchemas.find(s => s['@type'] === 'Product');
      expect(productSchema).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // B. PRODUCT STRUCTURED DATA (Product & Offer)
  // ──────────────────────────────────────────────────────────────────────────
  describe('B. Product Structured Data on Product Detail Pages (/product/:id)', () => {
    it('emits accurate Product schema matching rendered product details', async () => {
      const res = await request(app)
        .get(`/product/${inStockProductId}`)
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);

      const jsonLdBlocks = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const parsedSchemas = jsonLdBlocks.map(b => JSON.parse(b[1]));
      const productSchema = parsedSchemas.find(s => s['@type'] === 'Product');

      expect(productSchema).toBeDefined();
      expect(productSchema['@context']).toBe('https://schema.org');
      expect(productSchema['@type']).toBe('Product');
      expect(productSchema.name).toBe('Kashmiri Saffron Almonds');
      expect(Array.isArray(productSchema.image)).toBe(true);
      expect(productSchema.image[0]).toMatch(/^https:\/\/sritirumaladryfruits\.com\//);
      expect(productSchema.sku).toBe('SD-IN-101');
      expect(productSchema.mpn).toBe('SD-IN-101');
      expect(productSchema.category).toBe('Dry Fruits');
      expect(productSchema.brand.name).toBe('Sri Tirumala Dry Fruits');

      // Offers verification
      expect(productSchema.offers).toBeDefined();
      expect(productSchema.offers['@type']).toBe('Offer');
      expect(productSchema.offers.priceCurrency).toBe('INR');
      expect(productSchema.offers.price).toBe('899.50');
      expect(productSchema.offers.url).toBe(`https://sritirumaladryfruits.com/product/${inStockProductId}`);
      expect(productSchema.offers.itemCondition).toBe('https://schema.org/NewCondition');
      expect(productSchema.offers.availability).toBe('https://schema.org/InStock');
      expect(productSchema.offers.seller.name).toBe('Sri Tirumala Dry Fruits');
      expect(productSchema.offers.seller['@type']).toBe('GroceryStore');

      // Visible HTML matches schema
      expect(res.text).toContain('899.50');
      expect(res.text).toContain('In Stock');
    });

    it('correctly maps zero or negative stock to OutOfStock availability', async () => {
      const res = await request(app)
        .get(`/product/${outOfStockProductId}`)
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);

      const jsonLdBlocks = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const parsedSchemas = jsonLdBlocks.map(b => JSON.parse(b[1]));
      const productSchema = parsedSchemas.find(s => s['@type'] === 'Product');

      expect(productSchema).toBeDefined();
      expect(productSchema.offers.availability).toBe('https://schema.org/OutOfStock');
      // Visible HTML indicates Out of Stock
      expect(res.text).toContain('Out of Stock');
    });

    it('omits optional sku and mpn when product has no authentic barcode/sku (No Fabrications)', async () => {
      const res = await request(app)
        .get(`/product/${noSkuProductId}`)
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);

      const jsonLdBlocks = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const parsedSchemas = jsonLdBlocks.map(b => JSON.parse(b[1]));
      const productSchema = parsedSchemas.find(s => s['@type'] === 'Product');

      expect(productSchema).toBeDefined();
      // Must NOT contain fabricated identifier like STDF-PROD-xxx
      expect(productSchema.sku).toBeUndefined();
      expect(productSchema.mpn).toBeUndefined();
      expect(JSON.stringify(productSchema)).not.toContain('STDF-PROD-');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // C. SAFE XSS & SCRIPT BREAKOUT ESCAPING
  // ──────────────────────────────────────────────────────────────────────────
  describe('C. Security: Script Breakout & Untrusted Characters Escaping', () => {
    it('safely escapes special characters and closing script tags in JSON-LD', async () => {
      const res = await request(app)
        .get(`/product/${specialCharProductId}`)
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);

      // Verify that </script> in product name was safely encoded and didn't terminate the script element
      expect(res.text).toContain('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>');

      // Verify the entire JSON-LD parses cleanly without syntax errors
      const jsonLdBlocks = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const productBlock = jsonLdBlocks.find(b => b[1].includes('Cashews'));
      expect(productBlock).toBeDefined();

      const parsed = JSON.parse(productBlock![1]);
      expect(parsed.name).toBe('Cashews <Grade A+> & "Royal" Nuts </script><script>alert(1)</script>');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // D. STOREFRONT RENDERING INTEGRITY
  // ──────────────────────────────────────────────────────────────────────────
  describe('D. Storefront Template Rendering Integrity', () => {
    it('renders Add to Cart button, price, and cart controls on product page', async () => {
      const res = await request(app).get(`/product/${inStockProductId}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Add to Cart');
      expect(res.text).toContain('Kashmiri Saffron Almonds');
      expect(res.text).toContain('handleDetailAddToCart');
    });

    it('renders BreadcrumbList along with Product on product detail page', async () => {
      const res = await request(app).get(`/product/${inStockProductId}`);
      const jsonLdBlocks = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const parsedSchemas = jsonLdBlocks.map(b => JSON.parse(b[1]));

      const breadcrumbs = parsedSchemas.find(s => s['@type'] === 'BreadcrumbList');
      expect(breadcrumbs).toBeDefined();
      expect(breadcrumbs.itemListElement.length).toBe(3);
      expect(breadcrumbs.itemListElement[0].name).toBe('Home');
      expect(breadcrumbs.itemListElement[1].name).toBe('Dry Fruits');
      expect(breadcrumbs.itemListElement[2].name).toBe('Kashmiri Saffron Almonds');
    });
  });
});
