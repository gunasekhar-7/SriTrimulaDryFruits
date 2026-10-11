import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import { getEnrichedProductContent, extractVerifiedGrade, getStorageInstructions } from '../../src/utils/product-content.js';
import { Product } from '../../src/types/index.js';

describe('Product Content Quality, Differentiation & Indexability Support Suite', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. DATABASE INTEGRITY CHECKS
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Database Catalog Integrity', () => {
    it('ensures zero empty or whitespace-only product names in active catalog', () => {
      const invalidNames = db.prepare(`
        SELECT id, name FROM product_variants 
        WHERE active = 1 AND (name IS NULL OR trim(name) = '')
      `).all();

      expect(invalidNames.length).toBe(0);
    });

    it('ensures all active products have non-negative prices and valid category', () => {
      const invalidPricing = db.prepare(`
        SELECT id, name, selling_price, category 
        FROM product_variants 
        WHERE active = 1 AND (selling_price <= 0 OR category IS NULL OR trim(category) = '')
      `).all();

      expect(invalidPricing.length).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. CONTENT DIFFERENTIATION & BOILERPLATE ELIMINATION
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Content Differentiation vs Boilerplate', () => {
    it('generates distinct, non-duplicate descriptions across different commodities', () => {
      const p1: Product = {
        id: 34,
        name: 'Almonds Premium',
        barcode: '1001',
        cost_price: 700,
        selling_price: 850,
        mrp: 999,
        total_qty: 50,
        sold_qty: 0,
        reserved_qty: 0,
        category: 'Dry Fruits',
        tax_rate: 0
      };

      const p2: Product = {
        id: 35,
        name: 'Cashews W210',
        barcode: '1002',
        cost_price: 800,
        selling_price: 950,
        mrp: 1100,
        total_qty: 40,
        sold_qty: 0,
        reserved_qty: 0,
        category: 'Dry Fruits',
        tax_rate: 0
      };

      const p3: Product = {
        id: 40,
        name: 'Dried Figs',
        barcode: '1007',
        cost_price: 600,
        selling_price: 750,
        mrp: 900,
        total_qty: 25,
        sold_qty: 0,
        reserved_qty: 0,
        category: 'Dry Fruits',
        tax_rate: 0
      };

      const c1 = getEnrichedProductContent(p1);
      const c2 = getEnrichedProductContent(p2);
      const c3 = getEnrichedProductContent(p3);

      // Descriptions must be unique and differentiated
      expect(c1.description).not.toBe(c2.description);
      expect(c2.description).not.toBe(c3.description);
      expect(c1.description).not.toBe(c3.description);

      // Verified grade extracted only where substantiated
      expect(c1.gradeVariety).toBeUndefined(); // Almonds Premium has no verified grade
      expect(c2.gradeVariety).toBe('W-210 (Jumbo Wholes)'); // Cashews W210 has verified grade
      expect(c3.gradeVariety).toBe('Whole Dried Figs (Anjeer)');
    });

    it('tailors storage instructions by commodity type rather than generic text', () => {
      const figStorage = getStorageInstructions('Dry Fruits', 'Dried Figs');
      const cashewStorage = getStorageInstructions('Dry Fruits', 'Cashews W210');
      const milletStorage = getStorageInstructions('Millets', 'Foxtail Millet');

      expect(figStorage.toLowerCase()).toContain('refrigeration');
      expect(cashewStorage).toContain('cool, dry place');
      expect(milletStorage).toContain('pantry');
      expect(figStorage).not.toBe(cashewStorage);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. STOREFRONT HTML & IMAGE ACCESSIBILITY
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. Storefront Rendered HTML & Image Accessibility', () => {
    it('renders descriptive alt text for product images', async () => {
      const res = await request(app).get('/product/34');
      expect(res.status).toBe(200);

      // If an image tag is rendered, confirm alt is non-empty
      const imgMatches = [...res.text.matchAll(/<img[^>]+>/gi)];
      for (const match of imgMatches) {
        const imgTag = match[0];
        if (imgTag.includes('product-card-img') || imgTag.includes('object-fit-cover')) {
          expect(imgTag).toMatch(/alt=["'][^"']+["']/);
        }
      }
    });

    it('renders verified attributes table with non-empty attributes', async () => {
      const res = await request(app).get('/product/34');
      expect(res.status).toBe(200);

      expect(res.text).toContain('Specifications & Product Details');
      expect(res.text).toContain('Product Name');
      expect(res.text).toContain('Category');
      expect(res.text).toContain('Storage Guidance');
      expect(res.text).toContain('Allergen Notice');
      expect(res.text).toContain('Tekkali');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. URL CONSISTENCY & CANONICAL ALIGNMENT
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. URL Consistency & Internal Links', () => {
    it('renders strictly canonical HTTPS non-WWW product URLs', async () => {
      const res = await request(app)
        .get('/product/34')
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);

      const canonMatch = res.text.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
      expect(canonMatch).not.toBeNull();
      expect(canonMatch![1]).toBe('https://sritirumaladryfruits.com/product/34');

      // Zero internal links pointing to non-canonical variants
      const links = [...res.text.matchAll(/<a\s+[^>]*href=["']([^"']+)["']/gi)].map(m => m[1]);
      for (const link of links) {
        if (link.startsWith('#') || link.startsWith('javascript:')) continue;
        expect(link).not.toContain('http://');
        expect(link).not.toContain('www.sritirumaladryfruits.com');
      }
    });
  });
});
