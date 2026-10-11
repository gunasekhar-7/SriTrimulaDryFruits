import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';

describe('Storefront HTML & Metadata Correctness Validation', () => {
  let activeProductId: number;

  beforeAll(() => {
    let prod = db.prepare('SELECT id FROM product_variants WHERE active = 1 LIMIT 1').get() as any;
    if (!prod) {
      db.prepare(`
        INSERT INTO product_variants (name, barcode, category, cost_price, selling_price, mrp, total_qty, sold_qty, active)
        VALUES ('Organic Chia Seeds', 'CS-101', 'Seeds', 120, 199, 240, 50, 0, 1)
      `).run();
      prod = db.prepare("SELECT id FROM product_variants WHERE barcode = 'CS-101'").get() as any;
    }
    activeProductId = prod.id;
  });

  const validateHtmlStructure = (html: string, pageType: string) => {
    // 1. DOCTYPE and HTML envelope
    expect(html, `${pageType}: missing doctype`).toMatch(/^<!DOCTYPE html>/i);
    expect(html, `${pageType}: missing html opening tag`).toContain('<html lang="en">');
    expect(html, `${pageType}: missing html closing tag`).toContain('</html>');

    // 2. Head envelope
    expect(html, `${pageType}: missing head opening tag`).toContain('<head>');
    expect(html, `${pageType}: missing head closing tag`).toContain('</head>');

    // 3. Body envelope
    expect(html, `${pageType}: missing body opening tag`).toContain('<body>');
    expect(html, `${pageType}: missing body closing tag`).toContain('</body>');

    // 4. Meta charset & viewport
    expect(html, `${pageType}: missing charset`).toContain('<meta charset="UTF-8">');

    // 5. Title & Description
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    expect(titleMatch, `${pageType}: missing or empty <title>`).not.toBeNull();
    expect(titleMatch![1].trim().length).toBeGreaterThan(10);

    const descMatch = html.match(/<meta name="description" content="([^"]+)">/);
    expect(descMatch, `${pageType}: missing or empty description`).not.toBeNull();
    expect(descMatch![1].trim().length).toBeGreaterThan(20);

    // 6. Canonical link
    const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)">/);
    expect(canonicalMatch, `${pageType}: missing or invalid canonical link`).not.toBeNull();
    expect(canonicalMatch![1]).toMatch(/^https?:\/\//);

    // 7. Robots tag
    expect(html, `${pageType}: missing robots tag`).toContain('<meta name="robots" content="index, follow');

    // 8. Open Graph standard tags
    expect(html, `${pageType}: missing og:title`).toMatch(/<meta property="og:title" content="[^"]+">/);
    expect(html, `${pageType}: missing og:description`).toMatch(/<meta property="og:description" content="[^"]+">/);
    expect(html, `${pageType}: missing og:url`).toMatch(/<meta property="og:url" content="https?:\/\/[^"]+">/);
    expect(html, `${pageType}: missing og:type`).toMatch(/<meta property="og:type" content="[^"]+">/);

    // 9. Structured Data JSON-LD Validation
    const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
    let match: RegExpExecArray | null;
    let jsonLdCount = 0;
    while ((match = jsonLdRegex.exec(html)) !== null) {
      jsonLdCount++;
      const jsonContent = match[1];
      let parsed: any;
      expect(() => {
        parsed = JSON.parse(jsonContent);
      }, `${pageType}: invalid JSON-LD syntax`).not.toThrow();

      expect(parsed['@context'], `${pageType}: invalid schema context`).toBe('https://schema.org');
      expect(parsed['@type'], `${pageType}: missing schema type`).toBeDefined();
    }
    expect(jsonLdCount, `${pageType}: expected at least one JSON-LD block`).toBeGreaterThanOrEqual(1);
  };

  it('validates generated HTML on Homepage (/)', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    validateHtmlStructure(res.text, 'Homepage');

    // Specific to home
    expect(res.text).toContain('GroceryStore');
  });

  it('validates generated HTML on Product Detail (/product/:id)', async () => {
    const res = await request(app).get(`/product/${activeProductId}`);
    expect(res.status).toBe(200);
    const html = res.text;
    validateHtmlStructure(html, 'Product Detail');

    // Product specific OpenGraph & eCommerce requirements
    expect(html).toContain('<meta property="og:type" content="product">');
    expect(html).toMatch(/<meta property="product:price:amount" content="[0-9.]+">/);
    expect(html).toContain('<meta property="product:price:currency" content="INR">');
    expect(html).toMatch(/<meta property="product:availability" content="(in stock|out of stock)">/);

    // Single H1 tag check
    const h1Matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi);
    expect(h1Matches, 'Product page must have exactly one <h1> tag').not.toBeNull();
    expect(h1Matches!.length).toBe(1);

    // Check JSON-LD Product & Breadcrumbs
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain('"@type":"Offer"');
    expect(html).toContain('"@type":"BreadcrumbList"');
  });

  it('validates generated HTML on Category Page (/category/:category)', async () => {
    const res = await request(app).get('/category/Dry%20Fruits');
    expect(res.status).toBe(200);
    validateHtmlStructure(res.text, 'Category Page');

    expect(res.text).toContain('"@type":"BreadcrumbList"');
  });

  it('validates generated HTML on Order Tracking (/track)', async () => {
    const res = await request(app).get('/track');
    expect(res.status).toBe(200);
    validateHtmlStructure(res.text, 'Order Tracking');
  });

  it('validates private customer & admin pages prevent indexing', async () => {
    const privateEndpoints = [
      '/customer/login',
      '/customer/register',
      '/login'
    ];

    for (const endpoint of privateEndpoints) {
      const res = await request(app).get(endpoint);
      expect(res.status).toBe(200);
      expect(res.text, `${endpoint} should have noindex`).toContain('<meta name="robots" content="noindex, nofollow">');
    }
  });
});
