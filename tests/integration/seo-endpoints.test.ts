import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { app } from '../../server.js';
import db from '../../src/database.js';

describe('Storefront Technical SEO Endpoints (Integration)', () => {

  describe('GET /robots.txt', () => {
    it('should serve text/plain robots.txt with disallow directives for private paths', async () => {
      const res = await request(app).get('/robots.txt');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);

      const body = res.text;
      expect(body).toContain('User-agent: *');
      expect(body).toContain('Disallow: /admin');
      expect(body).toContain('Disallow: /account');
      expect(body).toContain('Disallow: /customer');
      expect(body).toContain('Disallow: /checkout');
      expect(body).toContain('Disallow: /sell');
      expect(body).toContain('Disallow: /stock');
      expect(body).toContain('Disallow: /bill/');
      expect(body).toContain('Disallow: /shift/');
      expect(body).toContain('Disallow: /profit');
      expect(body).toContain('Disallow: /analytics');
      expect(body).toContain('Disallow: /login');
      expect(body).toContain('Disallow: /metrics');

      // Public allowed routes
      expect(body).toContain('Allow: /');
      expect(body).toContain('Allow: /product/');
      expect(body).toContain('Allow: /category/');
      expect(body).toContain('Allow: /track');

      // Sitemap directive
      expect(body).toMatch(/Sitemap: https?:\/\/.*\/sitemap\.xml/);
    });
  });

  describe('GET /sitemap.xml', () => {
    it('should serve well-formed XML sitemap with public URLs', async () => {
      const res = await request(app).get('/sitemap.xml');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/xml/);

      const xml = res.text;
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(xml).toContain('</urlset>');

      // Homepage & tracking
      expect(xml).toMatch(/<loc>https?:\/\/.*\/<\/loc>/);
      expect(xml).toMatch(/<loc>https?:\/\/.*\/track<\/loc>/);

      // Verify category entries exist
      expect(xml).toMatch(/<loc>https?:\/\/.*\/category\/.*<\/loc>/);

      // Verify product entries exist
      expect(xml).toMatch(/<loc>https?:\/\/.*\/product\/.*<\/loc>/);
    });
  });

  describe('Homepage SEO (GET /)', () => {
    it('should render correct metadata, canonical URL, Open Graph, and LocalBusiness Schema', async () => {
      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      const html = res.text;

      // Title & Description
      expect(html).toContain('<title>Sri Tirumala Dryfruits &amp; Millets');
      expect(html).toMatch(/<meta name="description" content="[^"]+Tekkali[^"]+">/);

      // Canonical
      expect(html).toMatch(/<link rel="canonical" href="https?:\/\/[^"]+\/">/);

      // Robots tag (public page should index & follow)
      expect(html).toContain('<meta name="robots" content="index, follow');

      // Open Graph
      expect(html).toContain('<meta property="og:site_name" content="Sri Tirumala Dryfruits">');
      expect(html).toContain('<meta property="og:type" content="website">');
      expect(html).toMatch(/<meta property="og:title" content="[^"]+">/);

      // LocalBusiness / GroceryStore Structured Data
      expect(html).toContain('application/ld+json');
      expect(html).toContain('GroceryStore');
      expect(html).toContain('LocalBusiness');
      expect(html).toContain('Tekkali');
      expect(html).toContain('532201');
    });
  });

  describe('Product Detail SEO (GET /product/:id)', () => {
    let testProductId: number;

    beforeAll(() => {
      // Find or insert an active product variant
      let prod = db.prepare('SELECT id FROM product_variants WHERE active = 1 LIMIT 1').get() as any;
      if (!prod) {
        db.prepare(`
          INSERT INTO product_variants (name, barcode, category, cost_price, selling_price, mrp, total_qty, sold_qty, active)
          VALUES ('Premium Kashmiri Saffron', 'SF-001', 'Spices', 250, 399, 450, 20, 2, 1)
        `).run();
        prod = db.prepare("SELECT id FROM product_variants WHERE barcode = 'SF-001'").get() as any;
      }
      testProductId = prod.id;
    });

    it('should render unique title, canonical URL, pricing OpenGraph, and Schema.org Product data', async () => {
      const res = await request(app).get(`/product/${testProductId}`);

      expect(res.status).toBe(200);
      const html = res.text;

      // Unique title & meta description
      expect(html).toContain('<title>');
      expect(html).toContain('Buy Online');
      expect(html).toMatch(/<meta name="description" content="[^"]+">/);

      // Canonical link pointing directly to /product/:id
      expect(html).toMatch(new RegExp(`<link rel="canonical" href="https?:\\/\\/[^"]+\\/product\\/${testProductId}">`));

      // Open Graph Product tags
      expect(html).toContain('<meta property="og:type" content="product">');
      expect(html).toMatch(/<meta property="product:price:amount" content="[0-9.]+">/);
      expect(html).toContain('<meta property="product:price:currency" content="INR">');
      expect(html).toMatch(/<meta property="product:availability" content="(in stock|out of stock)">/);

      // Schema.org Product & BreadcrumbList structured data
      expect(html).toContain('application/ld+json');
      expect(html).toContain('"@type":"Product"');
      expect(html).toContain('"@type":"Offer"');
      expect(html).toContain('"priceCurrency":"INR"');
      expect(html).toContain('"@type":"BreadcrumbList"');

      // Semantic crawlable internal links
      expect(html).toContain('href="/category/');
    });

    it('should return 404 with noindex for a nonexistent product ID', async () => {
      const res = await request(app).get('/product/99999999');

      expect(res.status).toBe(404);
      expect(res.text).toContain('<meta name="robots" content="noindex, nofollow">');
    });
  });

  describe('Category View SEO (GET /category/:category)', () => {
    it('should render category-specific title, canonical URL, and breadcrumb structured data', async () => {
      const res = await request(app).get('/category/Dry%20Fruits');

      expect(res.status).toBe(200);
      const html = res.text;

      expect(html).toContain('<title>Buy Premium Dry Fruits Online');
      expect(html).toMatch(/<link rel="canonical" href="https?:\/\/[^"]+\/category\/Dry%20Fruits">/);
      expect(html).toContain('application/ld+json');
      expect(html).toContain('"@type":"BreadcrumbList"');
    });
  });

  describe('Private & Account Pages Isolation', () => {
    it('should output noindex, nofollow on customer login page', async () => {
      const res = await request(app).get('/customer/login');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<meta name="robots" content="noindex, nofollow">');
    });

    it('should output noindex, nofollow on customer register page', async () => {
      const res = await request(app).get('/customer/register');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<meta name="robots" content="noindex, nofollow">');
    });

    it('should output noindex, nofollow on staff login page', async () => {
      const res = await request(app).get('/login');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<meta name="robots" content="noindex, nofollow">');
    });

    it('should ensure private templates enforce noindex, nofollow in their markup', () => {
      const privateViews = [
        'checkout.ejs',
        'customer_login.ejs',
        'customer_register.ejs',
        'customer_dashboard.ejs',
        'customer_orders.ejs',
        'customer_order_detail.ejs',
        'customer_profile.ejs',
        'customer_addresses.ejs',
        'customer_wishlist.ejs',
        'barcode_label.ejs',
        'login.ejs',
        'error.ejs'
      ];

      for (const viewName of privateViews) {
        const filePath = path.join(process.cwd(), 'views', viewName);
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content, `${viewName} must contain <meta name="robots" content="noindex, nofollow">`).toContain(
          '<meta name="robots" content="noindex, nofollow">'
        );
      }
    });
  });

});
