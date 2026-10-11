import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import { productService } from '../../src/services/product.service.js';

describe('Storefront Internal Linking & Related Products Suite', () => {
  let sampleProduct1Id: number;
  let sampleProduct2Id: number;
  let isolatedSeedId: number;

  const SIX_CATEGORIES = [
    'Dry Fruits',
    'Millets',
    'Seeds',
    'Spices',
    'Nuts',
    'Sweets'
  ];

  beforeAll(() => {
    db.prepare("DELETE FROM product_variants WHERE barcode LIKE 'BC_LINK_%'").run();

    // 1. Create two related Dry Fruits products (almonds)
    const res1 = db.prepare(`
      INSERT INTO product_variants (name, barcode, total_qty, sold_qty, cost_price, selling_price, mrp, category, image_url, tax_rate, active)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 1)
    `).run(
      'Imperial Royal California Almonds 500g',
      'BC_LINK_001_' + Date.now(),
      25,
      400,
      550,
      650,
      'Dry Fruits',
      '/images/almonds.jpg'
    );
    sampleProduct1Id = res1.lastInsertRowid as number;

    const res2 = db.prepare(`
      INSERT INTO product_variants (name, barcode, total_qty, sold_qty, cost_price, selling_price, mrp, category, image_url, tax_rate, active)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 1)
    `).run(
      'Gourmet Kashmiri Mamra Almonds 250g',
      'BC_LINK_002_' + Date.now(),
      15,
      600,
      850,
      950,
      'Dry Fruits',
      '/images/mamra.jpg'
    );
    sampleProduct2Id = res2.lastInsertRowid as number;

    // 2. Create products in Seeds category
    const res3 = db.prepare(`
      INSERT INTO product_variants (name, barcode, total_qty, sold_qty, cost_price, selling_price, mrp, category, image_url, tax_rate, active)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 1)
    `).run(
      'Organic Roasted Pumpkin Seeds 200g',
      'BC_LINK_003_' + Date.now(),
      40,
      150,
      220,
      250,
      'Seeds',
      '/images/seeds.jpg'
    );
    isolatedSeedId = res3.lastInsertRowid as number;

    const res4 = db.prepare(`
      INSERT INTO product_variants (name, barcode, total_qty, sold_qty, cost_price, selling_price, mrp, category, image_url, tax_rate, active)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 1)
    `).run(
      'Organic Peruvian Chia Seeds 250g',
      'BC_LINK_004_' + Date.now(),
      30,
      180,
      280,
      320,
      'Seeds',
      '/images/chia.jpg'
    );
    sampleProduct2Id = res4.lastInsertRowid as number;
  });

  afterAll(() => {
    db.prepare("DELETE FROM product_variants WHERE barcode LIKE 'BC_LINK_%'").run();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // A. HOMEPAGE CATEGORY LINKS
  // ──────────────────────────────────────────────────────────────────────────
  describe('A. Homepage Category Links', () => {
    it('directly links all six canonical product categories using crawlable <a> anchor tags', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);

      // Verify each of the six canonical categories is linked via an HTML anchor element
      SIX_CATEGORIES.forEach(category => {
        const encoded = encodeURIComponent(category);
        const expectedHref = `/category/${encoded}`;
        // Ensure href="/category/{encoded}" is present
        expect(res.text).toContain(`href="${expectedHref}"`);
      });

      // Verify the presence of crawlable anchor elements inside provenance pills container
      expect(res.text).toMatch(/<div class="cat-pill-scroll"[^>]*role="navigation"/);
      expect(res.text).toContain('🥥 All Harvests');
    });

    it('uses actual canonical URLs without session IDs or tracking parameters on the homepage', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);

      // Extract all category links from homepage
      const categoryLinks = res.text.match(/href="\/category\/[^"]+"/g) || [];
      expect(categoryLinks.length).toBeGreaterThanOrEqual(6);

      categoryLinks.forEach(link => {
        expect(link).not.toContain('?');
        expect(link).not.toContain('&');
        expect(link).not.toContain('utm_');
        expect(link).not.toContain('sessionId');
      });
    });

    it('does not expose internal administrative categories (e.g. Test Category) on the homepage', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);

      expect(res.text).not.toContain('/category/Test%20Category');
      expect(res.text).not.toContain('Test Category');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // B. FOOTER CATEGORY LINKS
  // ──────────────────────────────────────────────────────────────────────────
  describe('B. Footer Category Links', () => {
    it('ensures all six eligible categories are directly discoverable in the footer Collections column', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);

      // Inspect footer section
      const footerMatch = res.text.match(/<footer[\s\S]*?<\/footer>/);
      expect(footerMatch).not.toBeNull();
      const footerHtml = footerMatch![0];

      // Verify all six categories are listed with their exact names
      SIX_CATEGORIES.forEach(category => {
        const encoded = encodeURIComponent(category);
        expect(footerHtml).toContain(`href="/category/${encoded}"`);
        expect(footerHtml).toContain(`>${category}</a>`);
      });
    });

    it('avoids duplicate or malformed URLs in the footer Collections navigation', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);

      const footerMatch = res.text.match(/<footer[\s\S]*?<\/footer>/);
      expect(footerMatch).not.toBeNull();
      const footerHtml = footerMatch![0];

      // Extract Collections list items
      const collectionsMatch = footerHtml.match(/<h6 class="footer-nav-heading">Collections<\/h6>[\s\S]*?<ul class="footer-link-list">([\s\S]*?)<\/ul>/);
      expect(collectionsMatch).not.toBeNull();
      const collectionsListHtml = collectionsMatch![1];

      // Each category should appear exactly once in the collections list
      SIX_CATEGORIES.forEach(category => {
        const encoded = encodeURIComponent(category);
        const occurrences = (collectionsListHtml.match(new RegExp(`href="/category/${encoded}"`, 'g')) || []).length;
        expect(occurrences).toBe(1);
      });
    });

    it('preserves existing legal, tracking, and contact links in the footer', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);

      expect(res.text).toContain('href="/track"');
      expect(res.text).toContain('href="/sitemap.xml"');
      expect(res.text).toContain('tel:+919133133931');
      expect(res.text).toContain('FSSAI Certified');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // C. CATEGORY ROUTE RESOLUTION & EMPTY CATEGORY HANDLING
  // ──────────────────────────────────────────────────────────────────────────
  describe('C. Category Route Resolution & Empty Category Handling', () => {
    it('successfully resolves all six official category routes with HTTP 200', async () => {
      for (const category of SIX_CATEGORIES) {
        const encoded = encodeURIComponent(category);
        const res = await request(app).get(`/category/${encoded}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain(`canonical" href="https://sritirumaladryfruits.com/category/${encoded}"`);
      }
    });

    it('handles empty storefront categories gracefully with an elegant coming soon notice instead of 404', async () => {
      // 'Spices' currently has 0 active variants in catalog
      const res = await request(app).get('/category/Spices');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Spices Collection Arriving Soon');
      expect(res.text).toContain('Browse Royal Dry Fruits');
    });

    it('returns 404 with error page for non-existent or malicious category paths', async () => {
      const res = await request(app).get('/category/NonExistentCategoryXYZ999');
      expect(res.status).toBe(404);
      expect(res.text).toContain('Category Not Found');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // D. RELATED PRODUCTS SECTION ON PRODUCT DETAIL PAGES
  // ──────────────────────────────────────────────────────────────────────────
  describe('D. Related Products Section on Product Detail Pages', () => {
    it('renders a "Related Products" section (not "Related Harvests") with canonical product links', async () => {
      const res = await request(app).get(`/product/${isolatedSeedId}`);
      expect(res.status).toBe(200);

      // Must be labeled "Related Products", not "Related Harvests"
      expect(res.text).toContain('Related Products');
      expect(res.text).not.toContain('Related Harvests');

      // Product cards must link to canonical detail paths /product/:id
      expect(res.text).toContain(`href="/product/${sampleProduct2Id}"`);
    });

    it('strictly excludes the current product from its own related list', async () => {
      const res = await request(app).get(`/product/${sampleProduct1Id}`);
      expect(res.status).toBe(200);

      // Inspect related products container
      const relatedSectionMatch = res.text.match(/<div class="related-carousel-container"[\s\S]*?<\/div>[\s\S]*?<\/div>/);
      expect(relatedSectionMatch).not.toBeNull();
      const sectionHtml = relatedSectionMatch![0];

      // The related section must NOT contain a card linking back to sampleProduct1Id
      const selfLinkPattern = new RegExp(`href="/product/${sampleProduct1Id}"`);
      expect(sectionHtml).not.toMatch(selfLinkPattern);
    });

    it('includes accessible carousel controls with proper aria-labels and native scroll support', async () => {
      const res = await request(app).get(`/product/${sampleProduct1Id}`);
      expect(res.status).toBe(200);

      expect(res.text).toContain('aria-label="Scroll previous related products"');
      expect(res.text).toContain('aria-label="Scroll next related products"');
      expect(res.text).toContain('role="region" aria-label="Related products carousel"');
      expect(res.text).toContain('tabindex="0"');
    });

    it('provides deterministic results across multiple requests without random shuffling', async () => {
      const res1 = await request(app).get(`/product/${sampleProduct1Id}`);
      const res2 = await request(app).get(`/product/${sampleProduct1Id}`);

      // Extract card names in order from both responses
      const cards1 = res1.text.match(/class="grid-product-name[^"]*" title="([^"]+)"/g) || [];
      const cards2 = res2.text.match(/class="grid-product-name[^"]*" title="([^"]+)"/g) || [];

      expect(cards1.length).toBeGreaterThan(0);
      expect(cards1).toEqual(cards2);
    });

    it('handles isolated products or sparse categories safely without crashing', async () => {
      const res = await request(app).get(`/product/${isolatedSeedId}`);
      expect(res.status).toBe(200);

      // The page should render safely, offering complementary related selections
      expect(res.text).toContain('Related Products');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // E. CATALOGUE DATA AND METRICS VERIFICATION
  // ──────────────────────────────────────────────────────────────────────────
  describe('E. Catalogue Data and Category Counts', () => {
    it('accurately reports the 6 storefront categories and their active item counts', () => {
      const categories = productService.getStorefrontCategories();
      expect(categories).toHaveLength(6);

      const names = categories.map(c => c.name);
      expect(names).toEqual(SIX_CATEGORIES);

      // Check counts are non-negative numbers
      categories.forEach(cat => {
        expect(typeof cat.productCount).toBe('number');
        expect(cat.productCount).toBeGreaterThanOrEqual(0);
        expect(cat.url).toBe(`/category/${cat.slug}`);
      });

      // Verify Dry Fruits has the bulk of the variants
      const dryFruits = categories.find(c => c.name === 'Dry Fruits');
      expect(dryFruits!.productCount).toBeGreaterThan(600);
    });
  });
});
