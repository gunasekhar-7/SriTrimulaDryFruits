import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';
import { validateProductionSiteConfig } from '../../src/config/site.js';

describe('Production Canonical Base Domain & Host Header Security Suite', () => {
  let activeProductId: number;
  let activeProductBarcode: string;
  const originalSiteUrl = process.env.SITE_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    // Ensure test product exists
    let prod = db.prepare('SELECT id, barcode FROM product_variants WHERE active = 1 LIMIT 1').get() as any;
    if (!prod) {
      db.prepare(`
        INSERT INTO product_variants (name, barcode, category, cost_price, selling_price, mrp, total_qty, sold_qty, active)
        VALUES ('Royal Kashmiri Almonds', 'ALM-CANON-01', 'Dry Fruits', 500, 750, 900, 40, 0, 1)
      `).run();
      prod = db.prepare("SELECT id, barcode FROM product_variants WHERE barcode = 'ALM-CANON-01'").get() as any;
    }
    activeProductId = prod.id;
    activeProductBarcode = prod.barcode;
  });

  afterAll(() => {
    if (originalSiteUrl) {
      process.env.SITE_URL = originalSiteUrl;
    } else {
      delete process.env.SITE_URL;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('1. Homepage canonical uses the configured production domain', async () => {
    process.env.SITE_URL = 'https://sritirumaladryfruits.com';
    const res = await request(app).get('/');
    expect(res.status).toBe(200);

    // Verify canonical tag has exact production origin with root trailing slash
    expect(res.text).toContain('<link rel="canonical" href="https://sritirumaladryfruits.com/">');
  });

  it('2. Category and product canonical URLs use the configured production domain', async () => {
    process.env.SITE_URL = 'https://sritirumaladryfruits.com';

    // Category page
    const catRes = await request(app).get('/category/Dry%20Fruits');
    expect(catRes.status).toBe(200);
    expect(catRes.text).toContain('<link rel="canonical" href="https://sritirumaladryfruits.com/category/Dry%20Fruits">');

    // Product page
    const prodRes = await request(app).get(`/product/${activeProductId}`);
    expect(prodRes.status).toBe(200);
    expect(prodRes.text).toContain(`<link rel="canonical" href="https://sritirumaladryfruits.com/product/${activeProductId}">`);
  });

  it('3. An attacker-controlled Host header or X-Forwarded headers CANNOT change canonical URLs', async () => {
    process.env.SITE_URL = 'https://sritirumaladryfruits.com';

    const attackRes = await request(app)
      .get('/')
      .set('Host', 'evil-phishing-domain.com')
      .set('X-Forwarded-Host', 'attacker-controlled.net')
      .set('X-Forwarded-Proto', 'http');

    expect(attackRes.status).toBe(200);

    // Canonical tag must strictly remain the configured canonical domain
    expect(attackRes.text).toContain('<link rel="canonical" href="https://sritirumaladryfruits.com/">');
    expect(attackRes.text).not.toContain('evil-phishing-domain.com');
    expect(attackRes.text).not.toContain('attacker-controlled.net');

    // Product page under host-header attack
    const prodAttackRes = await request(app)
      .get(`/product/${activeProductId}`)
      .set('Host', 'evil-phishing-domain.com')
      .set('X-Forwarded-Host', 'attacker-controlled.net');

    expect(prodAttackRes.status).toBe(200);
    expect(prodAttackRes.text).toContain(`<link rel="canonical" href="https://sritirumaladryfruits.com/product/${activeProductId}">`);
    expect(prodAttackRes.text).not.toContain('evil-phishing-domain.com');
  });

  it('4. Open Graph URLs use the configured production domain', async () => {
    process.env.SITE_URL = 'https://sritirumaladryfruits.com';

    // Homepage OpenGraph
    const homeRes = await request(app).get('/');
    expect(homeRes.status).toBe(200);
    expect(homeRes.text).toContain('<meta property="og:url" content="https://sritirumaladryfruits.com/">');

    // Category OpenGraph
    const catRes = await request(app).get('/category/Dry%20Fruits');
    expect(catRes.status).toBe(200);
    expect(catRes.text).toContain('<meta property="og:url" content="https://sritirumaladryfruits.com/category/Dry%20Fruits">');

    // Product OpenGraph
    const prodRes = await request(app).get(`/product/${activeProductId}`);
    expect(prodRes.status).toBe(200);
    expect(prodRes.text).toContain(`<meta property="og:url" content="https://sritirumaladryfruits.com/product/${activeProductId}">`);
  });

  it('5. Sitemap URLs use the configured production domain', async () => {
    process.env.SITE_URL = 'https://sritirumaladryfruits.com';

    const sitemapRes = await request(app)
      .get('/sitemap.xml')
      .set('Host', 'spoofed-host.org');

    expect(sitemapRes.status).toBe(200);
    expect(sitemapRes.headers['content-type']).toContain('application/xml');

    const sitemapXml = sitemapRes.text;
    expect(sitemapXml).toContain('<loc>https://sritirumaladryfruits.com/</loc>');
    expect(sitemapXml).toContain('<loc>https://sritirumaladryfruits.com/track</loc>');
    expect(sitemapXml).toContain('<loc>https://sritirumaladryfruits.com/category/Dry%20Fruits</loc>');
    expect(sitemapXml).toContain(`<loc>https://sritirumaladryfruits.com/product/${activeProductId}</loc>`);

    // Verify spoofed host was completely ignored
    expect(sitemapXml).not.toContain('spoofed-host.org');
  });

  it('6. Product JSON-LD structured data URLs use the configured production domain', async () => {
    process.env.SITE_URL = 'https://sritirumaladryfruits.com';

    const res = await request(app).get(`/product/${activeProductId}`);
    expect(res.status).toBe(200);

    // Extract all JSON-LD scripts
    const jsonLdMatches = res.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    expect(jsonLdMatches).not.toBeNull();

    let foundProductSchema = false;
    let foundBreadcrumbSchema = false;

    for (const block of jsonLdMatches!) {
      const rawJson = block.replace(/<script[^>]*>|<\/script>/g, '');
      const parsed = JSON.parse(rawJson);

      if (parsed['@type'] === 'Product') {
        foundProductSchema = true;
        expect(parsed.offers.url).toBe(`https://sritirumaladryfruits.com/product/${activeProductId}`);
        expect(parsed.offers.seller.url || parsed.offers.seller.name).toBeDefined();
        if (parsed.image && Array.isArray(parsed.image)) {
          parsed.image.forEach((img: string) => {
            expect(img).toMatch(/^https:\/\/sritirumaladryfruits\.com\//);
          });
        }
      }

      if (parsed['@type'] === 'BreadcrumbList') {
        foundBreadcrumbSchema = true;
        parsed.itemListElement.forEach((crumb: any) => {
          expect(crumb.item).toMatch(/^https:\/\/sritirumaladryfruits\.com/);
        });
      }
    }

    expect(foundProductSchema).toBe(true);
    expect(foundBreadcrumbSchema).toBe(true);
  });

  it('7. Production configuration fails safely if SITE_URL is invalid or untrusted', () => {
    process.env.NODE_ENV = 'production';

    // HTTP instead of HTTPS
    process.env.SITE_URL = 'http://sritirumaladryfruits.com';
    expect(() => validateProductionSiteConfig()).toThrow(/must use "https:" in production/);

    // Untrusted domain
    process.env.SITE_URL = 'https://phishing-attacker.com';
    expect(() => validateProductionSiteConfig()).toThrow(/unexpected production domain/);

    // Malformed string
    process.env.SITE_URL = 'invalid-url';
    expect(() => validateProductionSiteConfig()).toThrow(/not a valid absolute URL/);

    // Query parameters injected into base URL
    process.env.SITE_URL = 'https://sritirumaladryfruits.com?param=evil';
    expect(() => validateProductionSiteConfig()).toThrow(/must not contain query parameters/);
  });

  it('8. Existing storefront and checkout behavior is unaffected', async () => {
    process.env.SITE_URL = 'https://sritirumaladryfruits.com';

    // Storefront search / product listing
    const homeRes = await request(app).get('/');
    expect(homeRes.status).toBe(200);
    expect(homeRes.text).toContain('Sri Tirumala Dryfruits');

    // Cart API endpoint works as expected
    const cartRes = await request(app).get('/api/cart');
    expect(cartRes.status).toBe(200);

    // Checkout page with empty cart redirects to homepage
    const checkoutRes = await request(app).get('/checkout');
    expect(checkoutRes.status).toBe(302);
    expect(checkoutRes.headers.location).toBe('/');
  });

  it('9. robots.txt sitemap reference uses the locked canonical domain', async () => {
    process.env.SITE_URL = 'https://sritirumaladryfruits.com';

    const robotsRes = await request(app)
      .get('/robots.txt')
      .set('Host', 'attacker-host.com');

    expect(robotsRes.status).toBe(200);
    expect(robotsRes.text).toContain('Sitemap: https://sritirumaladryfruits.com/sitemap.xml');
    expect(robotsRes.text).not.toContain('attacker-host.com');
  });

  it('10. Strips query parameters from canonical tags to prevent duplicate content indexing', async () => {
    process.env.SITE_URL = 'https://sritirumaladryfruits.com';

    const dirtyProductRes = await request(app)
      .get(`/product/${activeProductId}?utm_source=google&utm_medium=cpc&gclid=test12345`);

    expect(dirtyProductRes.status).toBe(200);
    expect(dirtyProductRes.text).toContain(`<link rel="canonical" href="https://sritirumaladryfruits.com/product/${activeProductId}">`);
    expect(dirtyProductRes.text).not.toContain('utm_source');
    expect(dirtyProductRes.text).not.toContain('gclid');
  });
});
