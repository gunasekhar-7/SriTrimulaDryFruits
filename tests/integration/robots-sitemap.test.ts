import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import { seoService } from '../../src/services/seo.service.js';

describe('Robots.txt & XML Sitemap Validation Suite', () => {
  let sampleActiveProductId: number;

  beforeAll(() => {
    // Ensure active test product in store.db
    let prod = db.prepare('SELECT id FROM product_variants WHERE active = 1 LIMIT 1').get() as any;
    if (!prod) {
      db.prepare(`
        INSERT INTO product_variants (name, barcode, category, cost_price, selling_price, mrp, total_qty, sold_qty, active)
        VALUES ('Organic Medjool Dates', 'DT-ROBOTS-01', 'Dry Fruits', 400, 650, 800, 30, 0, 1)
      `).run();
      prod = db.prepare("SELECT id FROM product_variants WHERE barcode = 'DT-ROBOTS-01'").get() as any;
    }
    sampleActiveProductId = prod.id;
  });

  describe('A. Robots.txt Specification & Route Accessibility', () => {
    it('returns HTTP 200 with text/plain content-type', async () => {
      const res = await request(app).get('/robots.txt');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('contains required /order and /orders disallow directives', async () => {
      const res = await request(app).get('/robots.txt');
      const text = res.text;

      // Project checklist: /order and /orders must be explicitly disallowed
      expect(text).toContain('Disallow: /order\n');
      expect(text).toContain('Disallow: /orders\n');

      // Private checkout, cart, customer, account, admin routes disallowed
      expect(text).toContain('Disallow: /checkout\n');
      expect(text).toContain('Disallow: /cart\n');
      expect(text).toContain('Disallow: /admin\n');
      expect(text).toContain('Disallow: /account\n');
      expect(text).toContain('Disallow: /customer\n');
      expect(text).toContain('Disallow: /auth/\n');
      expect(text).toContain('Disallow: /login\n');
      expect(text).toContain('Disallow: /api/\n');
    });

    it('declares exact HTTPS, non-WWW sitemap address', async () => {
      const res = await request(app).get('/robots.txt');
      expect(res.text).toContain('Sitemap: https://sritirumaladryfruits.com/sitemap.xml');
      expect(res.text).not.toContain('http://');
      expect(res.text).not.toContain('www.sritirumaladryfruits.com');
    });

    it('explicitly allows crawlable public catalog and rendering assets (CSS, JS, images)', async () => {
      const res = await request(app).get('/robots.txt');
      const text = res.text;

      expect(text).toContain('Allow: /\n');
      expect(text).toContain('Allow: /product/\n');
      expect(text).toContain('Allow: /category/\n');
      expect(text).toContain('Allow: /track\n');
      expect(text).toContain('Allow: /css/\n');
      expect(text).toContain('Allow: /js/\n');
      expect(text).toContain('Allow: /images/\n');
      expect(text).toContain('Allow: /storefront.css\n');
      expect(text).toContain('Allow: /storefront.js\n');

      // Crucial: ensure public assets are NOT accidentally disallowed
      expect(text).not.toContain('Disallow: /css');
      expect(text).not.toContain('Disallow: /js');
      expect(text).not.toContain('Disallow: /images');
      expect(text).not.toContain('Disallow: /storefront');
      expect(text).not.toContain('Disallow: /product');
      expect(text).not.toContain('Disallow: /category');
    });
  });

  describe('B. XML Sitemap Validation & Integrity', () => {
    it('returns HTTP 200 with application/xml content-type and valid XML envelope', async () => {
      const res = await request(app).get('/sitemap.xml');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/xml');

      const xml = res.text;
      expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(xml.trim()).toMatch(/<\/urlset>$/);
    });

    it('ensures all sitemap URLs strictly use the configured canonical origin', async () => {
      const res = await request(app).get('/sitemap.xml');
      const locMatches = res.text.match(/<loc>([^<]+)<\/loc>/g) || [];
      expect(locMatches.length).toBeGreaterThan(0);

      for (const locTag of locMatches) {
        const url = locTag.replace(/<\/?loc>/g, '');
        expect(url).toMatch(/^https:\/\/sritirumaladryfruits\.com(\/.*)?$/);
        expect(url).not.toContain('localhost');
        expect(url).not.toContain('http://');
        expect(url).not.toContain('www.sritirumaladryfruits.com');
      }
    });

    it('guarantees zero duplicate URLs are emitted', async () => {
      const res = await request(app).get('/sitemap.xml');
      const locMatches = res.text.match(/<loc>([^<]+)<\/loc>/g) || [];
      const urls = locMatches.map(m => m.replace(/<\/?loc>/g, ''));

      const uniqueUrls = new Set(urls);
      expect(urls.length).toBe(uniqueUrls.size);
    });

    it('strictly excludes private, admin, checkout, cart, or customer-specific URLs', async () => {
      const res = await request(app).get('/sitemap.xml');
      const xml = res.text;

      expect(xml).not.toContain('/admin');
      expect(xml).not.toContain('/checkout');
      expect(xml).not.toContain('/cart');
      expect(xml).not.toContain('/customer');
      expect(xml).not.toContain('/account');
      expect(xml).not.toContain('/login');
      expect(xml).not.toContain('/register');
      expect(xml).not.toContain('/order/');
      expect(xml).not.toContain('/orders');
      expect(xml).not.toContain('/api');
    });

    it('includes public homepage, public tracking, active categories, and active products', async () => {
      const res = await request(app).get('/sitemap.xml');
      const xml = res.text;

      // Public core hubs
      expect(xml).toContain('<loc>https://sritirumaladryfruits.com/</loc>');
      expect(xml).toContain('<loc>https://sritirumaladryfruits.com/track</loc>');

      // Sample active product
      expect(xml).toContain(`<loc>https://sritirumaladryfruits.com/product/${sampleActiveProductId}</loc>`);
    });

    it('does NOT fabricate fake current-date lastmod timestamps when timestamps do not exist', async () => {
      const res = await request(app).get('/sitemap.xml');
      const xml = res.text;

      // Extract url blocks
      const urlBlocks = xml.split('</url>');
      // Find sampleActiveProductId block
      const productBlock = urlBlocks.find(b => b.includes(`/product/${sampleActiveProductId}`));
      expect(productBlock).toBeDefined();

      // In database, product_variants lacks created_at/updated_at, so lastmod must NOT be invented
      expect(productBlock).not.toContain('<lastmod>');
    });

    it('sitemap generator handles empty or corrupted/malformed database gracefully', () => {
      // Empty input
      const emptyXml = seoService.generateSitemapXml('https://sritirumaladryfruits.com', [], []);
      expect(emptyXml).toContain('<loc>https://sritirumaladryfruits.com/</loc>');
      expect(emptyXml).toContain('<loc>https://sritirumaladryfruits.com/track</loc>');

      // Malformed records (nulls, missing ids, negative ids, inactive items)
      const malformedProducts: any[] = [
        null,
        undefined,
        { id: 'not-a-number' },
        { id: 0 },
        { id: -99 },
        { id: 9999, active: 0 } // inactive must be omitted
      ];
      const malformedCategories: any[] = [null, '', '   ', undefined];

      const robustXml = seoService.generateSitemapXml(
        'https://sritirumaladryfruits.com',
        malformedProducts,
        malformedCategories
      );

      expect(robustXml).toContain('<loc>https://sritirumaladryfruits.com/</loc>');
      expect(robustXml).not.toContain('/product/not-a-number');
      expect(robustXml).not.toContain('/product/0');
      expect(robustXml).not.toContain('/product/-99');
      expect(robustXml).not.toContain('/product/9999');
      expect(robustXml).not.toContain('/category/');
    });
  });
});
