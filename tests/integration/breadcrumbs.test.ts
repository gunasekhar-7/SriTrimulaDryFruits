import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';

describe('Breadcrumb Navigation & BreadcrumbList Structured Data Suite', () => {
  let sampleProductWithCatId: number;
  let sampleProductWithoutCatId: number;

  beforeAll(() => {
    db.prepare("DELETE FROM product_variants WHERE barcode LIKE 'BC_BCRUMB_%'").run();

    // 1. Create a product with a valid category
    const res1 = db.prepare(`
      INSERT INTO product_variants (name, barcode, total_qty, sold_qty, cost_price, selling_price, mrp, category, image_url, tax_rate, active)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 1)
    `).run(
      'Kashmiri Mamra Almonds W180',
      'BC_BCRUMB_001_' + Date.now(),
      50,
      800,
      1200,
      1400,
      'Dry Fruits',
      '/images/mamra.jpg'
    );
    sampleProductWithCatId = res1.lastInsertRowid as number;

    // 2. Create a product with missing / empty category
    const res2 = db.prepare(`
      INSERT INTO product_variants (name, barcode, total_qty, sold_qty, cost_price, selling_price, mrp, category, image_url, tax_rate, active)
      VALUES (?, ?, ?, 0, ?, ?, ?, '', ?, 0, 1)
    `).run(
      'Mystery Uncategorized Item',
      'BC_BCRUMB_002_' + Date.now(),
      20,
      100,
      150,
      200,
      ''
    );
    sampleProductWithoutCatId = res2.lastInsertRowid as number;
  });

  afterAll(() => {
    db.prepare("DELETE FROM product_variants WHERE barcode LIKE 'BC_BCRUMB_%'").run();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. HOMEPAGE BEHAVIOR
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Homepage Behavior', () => {
    it('does not render category breadcrumb on homepage and omits BreadcrumbList at site root', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);

      // Homepage is root — should not render category collection breadcrumb
      expect(res.text).not.toContain('class="category-breadcrumb-section"');

      // Structured data at root emits GroceryStore / LocalBusiness, not BreadcrumbList
      const scriptMatches = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const schemas = scriptMatches.map(m => JSON.parse(m[1]));
      const breadcrumbs = schemas.find(s => s['@type'] === 'BreadcrumbList');
      expect(breadcrumbs).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. CATEGORY BREADCRUMB RENDERING
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Category Breadcrumb Rendering', () => {
    it('renders 2-level hierarchy: Home > Category on category pages', async () => {
      const res = await request(app).get('/category/Dry%20Fruits');
      expect(res.status).toBe(200);

      const html = res.text;
      // User-facing navigation
      expect(html).toContain('aria-label="Breadcrumb"');
      expect(html).toContain('href="/"');
      expect(html).toContain('Home');
      expect(html).toContain('Dry Fruits');
      expect(html).toContain('aria-current="page"');

      // Schema.org BreadcrumbList structured data
      const scriptMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const schemas = scriptMatches.map(m => JSON.parse(m[1]));
      const breadcrumb = schemas.find(s => s['@type'] === 'BreadcrumbList');

      expect(breadcrumb).toBeDefined();
      expect(breadcrumb['@context']).toBe('https://schema.org');
      expect(breadcrumb.itemListElement.length).toBe(2);

      // Position 1: Home
      expect(breadcrumb.itemListElement[0].position).toBe(1);
      expect(breadcrumb.itemListElement[0].name).toBe('Home');
      expect(breadcrumb.itemListElement[0].item).toBe('https://sritirumaladryfruits.com/');

      // Position 2: Category
      expect(breadcrumb.itemListElement[1].position).toBe(2);
      expect(breadcrumb.itemListElement[1].name).toBe('Dry Fruits');
      expect(breadcrumb.itemListElement[1].item).toBe('https://sritirumaladryfruits.com/category/Dry%20Fruits');

      // Canonical URL agreement
      const canonicalMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
      expect(canonicalMatch).not.toBeNull();
      expect(canonicalMatch![1]).toBe(breadcrumb.itemListElement[1].item);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. PRODUCT BREADCRUMB RENDERING
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. Product Breadcrumb Rendering', () => {
    it('renders 3-level hierarchy: Home > Category > Product on standard product pages', async () => {
      const res = await request(app).get(`/product/${sampleProductWithCatId}`);
      expect(res.status).toBe(200);

      const html = res.text;
      // User-facing navigation
      expect(html).toContain('aria-label="Breadcrumb"');
      expect(html).toContain('href="/"');
      expect(html).toContain('href="/category/Dry%20Fruits"');
      expect(html).toContain('Kashmiri Mamra Almonds W180');
      expect(html).toContain('aria-current="page"');

      // Schema.org BreadcrumbList structured data
      const scriptMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const schemas = scriptMatches.map(m => JSON.parse(m[1]));
      const breadcrumb = schemas.find(s => s['@type'] === 'BreadcrumbList');

      expect(breadcrumb).toBeDefined();
      expect(breadcrumb.itemListElement.length).toBe(3);

      // Position 1: Home
      expect(breadcrumb.itemListElement[0].position).toBe(1);
      expect(breadcrumb.itemListElement[0].name).toBe('Home');
      expect(breadcrumb.itemListElement[0].item).toBe('https://sritirumaladryfruits.com/');

      // Position 2: Category
      expect(breadcrumb.itemListElement[1].position).toBe(2);
      expect(breadcrumb.itemListElement[1].name).toBe('Dry Fruits');
      expect(breadcrumb.itemListElement[1].item).toBe('https://sritirumaladryfruits.com/category/Dry%20Fruits');

      // Position 3: Product
      expect(breadcrumb.itemListElement[2].position).toBe(3);
      expect(breadcrumb.itemListElement[2].name).toBe('Kashmiri Mamra Almonds W180');
      expect(breadcrumb.itemListElement[2].item).toBe(`https://sritirumaladryfruits.com/product/${sampleProductWithCatId}`);

      // Canonical URL agreement
      const canonicalMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
      expect(canonicalMatch).not.toBeNull();
      expect(canonicalMatch![1]).toBe(breadcrumb.itemListElement[2].item);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. URL ENCODING & SPACES IN CATEGORY NAMES
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. URL Encoding & Spaces in Category Names', () => {
    it('properly encodes spaces in category URLs while preserving human-readable text', async () => {
      const res = await request(app).get('/category/Dry%20Fruits');
      expect(res.status).toBe(200);

      const html = res.text;
      // In visible links: encoded as /category/Dry%20Fruits, text is "Dry Fruits"
      expect(html).toContain('href="/category/Dry%20Fruits"');
      expect(html).toContain('>Dry Fruits<');

      // In JSON-LD structured data: encoded URL without unencoded spaces
      const scriptMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const schemas = scriptMatches.map(m => JSON.parse(m[1]));
      const breadcrumb = schemas.find(s => s['@type'] === 'BreadcrumbList');
      expect(breadcrumb.itemListElement[1].item).toBe('https://sritirumaladryfruits.com/category/Dry%20Fruits');
      expect(breadcrumb.itemListElement[1].item).not.toContain(' ');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. MISSING OR DELETED CATEGORY BEHAVIOR
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. Missing or Deleted Category Behavior', () => {
    it('gracefully returns 404 for nonexistent/deleted categories instead of rendering soft 404', async () => {
      const res = await request(app).get('/category/NonExistentCategoryXYZ123');
      expect(res.status).toBe(404);
      expect(res.text).toContain('Category Not Found');
      expect(res.text).toContain('noindex, nofollow');
    });

    it('gracefully handles missing product-category relationships without displaying fictitious entries', async () => {
      const res = await request(app).get(`/product/${sampleProductWithoutCatId}`);
      expect(res.status).toBe(200);

      const html = res.text;
      // Visible breadcrumb should skip category and show Home > Product
      expect(html).toContain('aria-label="Breadcrumb"');
      expect(html).toContain('href="/"');
      // Must NOT fabricate category link inside breadcrumb navigation
      const breadcrumbNav = html.match(/<nav[^>]*aria-label=["']Breadcrumb["'][\s\S]*?<\/nav>/i);
      expect(breadcrumbNav).not.toBeNull();
      expect(breadcrumbNav![0]).not.toContain('/category/');

      // Schema.org BreadcrumbList should have 2 items: Home -> Product
      const scriptMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const schemas = scriptMatches.map(m => JSON.parse(m[1]));
      const breadcrumb = schemas.find(s => s['@type'] === 'BreadcrumbList');

      expect(breadcrumb).toBeDefined();
      expect(breadcrumb.itemListElement.length).toBe(2);
      expect(breadcrumb.itemListElement[0].position).toBe(1);
      expect(breadcrumb.itemListElement[0].name).toBe('Home');
      expect(breadcrumb.itemListElement[1].position).toBe(2);
      expect(breadcrumb.itemListElement[1].name).toBe('Mystery Uncategorized Item');
      expect(breadcrumb.itemListElement[1].item).toBe(`https://sritirumaladryfruits.com/product/${sampleProductWithoutCatId}`);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. INVALID PRODUCT HANDLING
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. Invalid Product Handling', () => {
    it('returns 404 with noindex for non-existent product ID', async () => {
      const res = await request(app).get('/product/99999999');
      expect(res.status).toBe(404);
      expect(res.text).toContain('Product Not Found');
      expect(res.text).toContain('noindex, nofollow');
    });

    it('returns 404 with noindex for malformed non-numeric product ID', async () => {
      const res = await request(app).get('/product/invalid-slug-id');
      expect(res.status).toBe(404);
      expect(res.text).toContain('Product Not Found');
      expect(res.text).toContain('noindex, nofollow');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. CANONICAL HOSTNAME CONSISTENCY
  // ──────────────────────────────────────────────────────────────────────────
  describe('7. Canonical Hostname Consistency', () => {
    it('preserves locked canonical production domain in BreadcrumbList despite hostile Host header', async () => {
      const res = await request(app)
        .get(`/product/${sampleProductWithCatId}`)
        .set('Host', 'evil-phishing-host.com')
        .set('X-Forwarded-Host', 'malicious.org');

      expect(res.status).toBe(200);

      const scriptMatches = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const schemas = scriptMatches.map(m => JSON.parse(m[1]));
      const breadcrumb = schemas.find(s => s['@type'] === 'BreadcrumbList');

      expect(breadcrumb).toBeDefined();
      breadcrumb.itemListElement.forEach((item: any) => {
        expect(item.item).toMatch(/^https:\/\/sritirumaladryfruits\.com/);
        expect(item.item).not.toContain('evil-phishing-host.com');
        expect(item.item).not.toContain('malicious.org');
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. MOBILE LAYOUT & LINK ACCESSIBILITY
  // ──────────────────────────────────────────────────────────────────────────
  describe('8. Mobile Layout & Link Accessibility', () => {
    it('includes accessibility attributes and responsive truncation classes', async () => {
      const res = await request(app).get(`/product/${sampleProductWithCatId}`);
      expect(res.status).toBe(200);

      const html = res.text;
      // Accessibility landmark
      expect(html).toContain('aria-label="Breadcrumb"');
      // aria-current="page" on current item
      expect(html).toContain('aria-current="page"');
      // Responsive classes
      expect(html).toContain('text-truncate');
      expect(html).toContain('d-flex flex-wrap');
    });
  });
});
