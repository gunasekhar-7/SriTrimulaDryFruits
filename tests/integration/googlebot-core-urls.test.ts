import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';

const GOOGLEBOT_SMARTPHONE_UA =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.71 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

describe('Googlebot Smartphone Core URLs & Technical SEO QA Suite', () => {
  let product34: any;

  beforeAll(() => {
    // Ensure product 34 exists in database with expected test values
    product34 = db.prepare('SELECT * FROM product_variants WHERE id = 34').get();
    if (!product34) {
      db.prepare(`
        INSERT OR IGNORE INTO product_variants (id, name, barcode, category, cost_price, selling_price, mrp, total_qty, sold_qty, active)
        VALUES (34, 'Almonds Premium', '1034', 'Dry Fruits', 700, 850, 999, 50, 0, 1)
      `).run();
    } else {
      db.prepare(`
        UPDATE product_variants
        SET name = 'Almonds Premium', category = 'Dry Fruits', cost_price = 700, selling_price = 850, mrp = 999, total_qty = 50, sold_qty = 0, active = 1
        WHERE id = 34
      `).run();
    }
    product34 = db.prepare('SELECT * FROM product_variants WHERE id = 34').get();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. HOMEPAGE: https://sritirumaladryfruits.com/
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Homepage (https://sritirumaladryfruits.com/)', () => {
    let res: request.Response;

    beforeAll(async () => {
      res = await request(app)
        .get('/')
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https')
        .set('User-Agent', GOOGLEBOT_SMARTPHONE_UA);
    });

    it('returns HTTP 200 OK directly with zero redirects', () => {
      expect(res.status).toBe(200);
      expect(res.headers.location).toBeUndefined();
    });

    it('has correct canonical URL pointing to https://sritirumaladryfruits.com/', () => {
      const match = res.text.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('https://sritirumaladryfruits.com/');
    });

    it('renders appropriate title and meta description for local SEO', () => {
      const titleMatch = res.text.match(/<title>([^<]+)<\/title>/);
      expect(titleMatch).not.toBeNull();
      expect(titleMatch![1]).toContain('Sri Tirumala Dryfruits');
      expect(titleMatch![1]).toContain('Tekkali');

      const descMatch = res.text.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
      expect(descMatch).not.toBeNull();
      expect(descMatch![1].length).toBeGreaterThan(30);
      expect(descMatch![1]).toContain('Tekkali');
    });

    it('has indexable robots directive and no accidental noindex', () => {
      const robotsMatch = res.text.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
      expect(robotsMatch).not.toBeNull();
      expect(robotsMatch![1]).toContain('index, follow');
      expect(res.text).not.toContain('noindex');
      expect(res.headers['x-robots-tag']).toBeUndefined();
    });

    it('provides mobile viewport tag for Googlebot Smartphone mobile-friendly rendering', () => {
      const viewportMatch = res.text.match(/<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i);
      expect(viewportMatch).not.toBeNull();
      expect(viewportMatch![1]).toContain('width=device-width');
    });

    it('outputs valid Schema.org GroceryStore/LocalBusiness structured data', () => {
      const scriptMatches = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(scriptMatches.length).toBeGreaterThanOrEqual(1);

      const schemas = scriptMatches.map(m => JSON.parse(m[1]));
      const localBiz = schemas.find(s => 
        (Array.isArray(s['@type']) && s['@type'].includes('GroceryStore')) ||
        s['@type'] === 'GroceryStore' ||
        s['@type'] === 'LocalBusiness'
      );
      expect(localBiz).toBeDefined();
      expect(localBiz['@context']).toBe('https://schema.org');
      expect(localBiz.address.addressLocality).toBe('Tekkali');
      expect(localBiz.address.postalCode).toBe('532201');
      expect(Number(localBiz.geo.latitude)).toBe(18.6163);
      expect(Number(localBiz.geo.longitude)).toBe(84.2335);
    });

    it('contains no internal links pointing to non-canonical or broken protocols', () => {
      const links = [...res.text.matchAll(/<a\s+[^>]*href=["']([^"']+)["']/gi)].map(m => m[1]);
      for (const link of links) {
        if (link.startsWith('#') || link.startsWith('javascript:')) continue;
        expect(link).not.toContain('http://');
        expect(link).not.toContain('www.sritirumaladryfruits.com');
        expect(link).not.toContain('localhost');
        expect(link).not.toContain('127.0.0.1');
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. CATEGORY PAGE: https://sritirumaladryfruits.com/category/Dry%20Fruits
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Category Page (https://sritirumaladryfruits.com/category/Dry%20Fruits)', () => {
    let res: request.Response;

    beforeAll(async () => {
      res = await request(app)
        .get('/category/Dry%20Fruits')
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https')
        .set('User-Agent', GOOGLEBOT_SMARTPHONE_UA);
    });

    it('returns HTTP 200 OK directly with category catalog content', () => {
      expect(res.status).toBe(200);
      expect(res.headers.location).toBeUndefined();
      expect(res.text).toContain('Dry Fruits');
    });

    it('has exact canonical URL pointing to https://sritirumaladryfruits.com/category/Dry%20Fruits', () => {
      const match = res.text.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('https://sritirumaladryfruits.com/category/Dry%20Fruits');
    });

    it('renders category-specific title and meta description', () => {
      const titleMatch = res.text.match(/<title>([^<]+)<\/title>/);
      expect(titleMatch).not.toBeNull();
      expect(titleMatch![1]).toContain('Dry Fruits');

      const descMatch = res.text.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
      expect(descMatch).not.toBeNull();
      expect(descMatch![1]).toContain('Dry Fruits');
      expect(descMatch![1].length).toBeGreaterThan(20);
    });

    it('is fully indexable with no accidental noindex directive', () => {
      const robotsMatch = res.text.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
      expect(robotsMatch).not.toBeNull();
      expect(robotsMatch![1]).toContain('index, follow');
      expect(res.text).not.toContain('noindex');
    });

    it('outputs Schema.org BreadcrumbList structured data for category level', () => {
      const scriptMatches = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(scriptMatches.length).toBeGreaterThanOrEqual(1);

      const schemas = scriptMatches.map(m => JSON.parse(m[1]));
      const breadcrumb = schemas.find(s => s['@type'] === 'BreadcrumbList');
      expect(breadcrumb).toBeDefined();
      expect(breadcrumb.itemListElement.length).toBe(2);
      expect(breadcrumb.itemListElement[0].name).toBe('Home');
      expect(breadcrumb.itemListElement[0].item).toBe('https://sritirumaladryfruits.com/');
      expect(breadcrumb.itemListElement[1].name).toBe('Dry Fruits');
      expect(breadcrumb.itemListElement[1].item).toBe('https://sritirumaladryfruits.com/category/Dry%20Fruits');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. PRODUCT DETAIL PAGE: https://sritirumaladryfruits.com/product/34
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. Product Detail Page (https://sritirumaladryfruits.com/product/34)', () => {
    let res: request.Response;

    beforeAll(async () => {
      res = await request(app)
        .get('/product/34')
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https')
        .set('User-Agent', GOOGLEBOT_SMARTPHONE_UA);
    });

    it('returns HTTP 200 OK directly for Product #34', () => {
      expect(res.status).toBe(200);
      expect(res.headers.location).toBeUndefined();
      expect(res.text).toContain('Almonds Premium');
    });

    it('has exact canonical URL pointing to https://sritirumaladryfruits.com/product/34', () => {
      const match = res.text.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('https://sritirumaladryfruits.com/product/34');
    });

    it('contains single <h1> tag containing product name', () => {
      const h1Matches = [...res.text.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
      expect(h1Matches.length).toBe(1);
      expect(h1Matches[0][1]).toContain('Almonds Premium');
    });

    it('displays authentic price and stock availability in page HTML', () => {
      expect(res.text).toContain('850');
      expect(res.text).toMatch(/(In Stock|Available)/i);
    });

    it('has full product OpenGraph metadata', () => {
      expect(res.text).toContain('<meta property="og:type" content="product">');
      expect(res.text).toContain('<meta property="product:price:amount" content="850.00">');
      expect(res.text).toContain('<meta property="product:price:currency" content="INR">');
      expect(res.text).toContain('<meta property="product:availability" content="in stock">');
    });

    it('outputs Schema.org Product structured data matching rendered details', () => {
      const scriptMatches = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(scriptMatches.length).toBeGreaterThanOrEqual(1);

      const schemas = scriptMatches.map(m => JSON.parse(m[1]));
      const productSchema = schemas.find(s => s['@type'] === 'Product');
      expect(productSchema).toBeDefined();
      expect(productSchema.name).toBe('Almonds Premium');
      expect(productSchema.offers.price).toBe('850.00');
      expect(productSchema.offers.priceCurrency).toBe('INR');
      expect(productSchema.offers.availability).toBe('https://schema.org/InStock');
      expect(productSchema.offers.seller.name).toBe('Sri Tirumala Dry Fruits');
      expect(productSchema.offers.url).toBe('https://sritirumaladryfruits.com/product/34');
    });

    it('is fully indexable with no accidental noindex directive', () => {
      const robotsMatch = res.text.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
      expect(robotsMatch).not.toBeNull();
      expect(robotsMatch![1]).toContain('index, follow');
      expect(res.text).not.toContain('noindex');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. RENDERING ASSETS RESOLUTION (CSS, JS, IMAGES)
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. Critical Rendering Assets for Googlebot Smartphone', () => {
    it('resolves /storefront.css with HTTP 200 and text/css', async () => {
      const cssRes = await request(app).get('/storefront.css');
      expect(cssRes.status).toBe(200);
      expect(cssRes.headers['content-type']).toContain('text/css');
      expect(cssRes.text.length).toBeGreaterThan(100);
      // Confirms responsive media query presence
      expect(cssRes.text).toContain('@media');
    });

    it('resolves /storefront.js with HTTP 200 and valid JS content-type', async () => {
      const jsRes = await request(app).get('/storefront.js');
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers['content-type']).toMatch(/(javascript|application\/javascript|text\/javascript)/);
      expect(jsRes.text.length).toBeGreaterThan(100);
    });
  });
});
