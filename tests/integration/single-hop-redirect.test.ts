import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import db from '../../src/database.js';

describe('Single-Hop Canonical Origin & HTTPS / WWW Normalization Suite', () => {
  let activeProductId: number;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnforce = process.env.ENFORCE_CANONICAL_REDIRECT;

  beforeAll(() => {
    // Enable enforcement for this verification test suite
    process.env.ENFORCE_CANONICAL_REDIRECT = 'true';

    let prod = db.prepare('SELECT id FROM product_variants WHERE active = 1 LIMIT 1').get() as any;
    if (!prod) {
      db.prepare(`
        INSERT INTO product_variants (name, barcode, category, cost_price, selling_price, mrp, total_qty, sold_qty, active)
        VALUES ('Premium Afghan Figs', 'FG-REDIR-01', 'Dry Fruits', 450, 700, 850, 25, 0, 1)
      `).run();
      prod = db.prepare("SELECT id FROM product_variants WHERE barcode = 'FG-REDIR-01'").get() as any;
    }
    activeProductId = prod.id;
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalEnforce !== undefined) {
      process.env.ENFORCE_CANONICAL_REDIRECT = originalEnforce;
    } else {
      delete process.env.ENFORCE_CANONICAL_REDIRECT;
    }
  });

  describe('1. Homepage (/) Single-Hop Origin Resolution across all 4 Variants', () => {
    it('Variant A: http://sritirumaladryfruits.com/ -> 301 to https://sritirumaladryfruits.com/', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'http');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('https://sritirumaladryfruits.com/');
    });

    it('Variant B: http://www.sritirumaladryfruits.com/ -> 301 to https://sritirumaladryfruits.com/ (Single Hop, no chain)', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'www.sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'http');

      expect(res.status).toBe(301);
      // Strictly 1 hop directly to canonical root, NOT to https://www first
      expect(res.headers.location).toBe('https://sritirumaladryfruits.com/');
    });

    it('Variant C: https://www.sritirumaladryfruits.com/ -> 301 to https://sritirumaladryfruits.com/', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'www.sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('https://sritirumaladryfruits.com/');
    });

    it('Variant D: https://sritirumaladryfruits.com/ -> 200 OK (Served directly, zero redirects)', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);
      expect(res.headers.location).toBeUndefined();
      expect(res.text).toContain('Sri Tirumala Dryfruits');
    });
  });

  describe('2. Representative Category Route Single-Hop Resolution with Query Parameters', () => {
    const targetPath = '/category/Dry%20Fruits?sort=price_asc&filter=in_stock';

    it('Variant A: http://sritirumaladryfruits.com/:category -> 301 preserving path and query string', async () => {
      const res = await request(app)
        .get(targetPath)
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'http');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe(`https://sritirumaladryfruits.com${targetPath}`);
    });

    it('Variant B: http://www.sritirumaladryfruits.com/:category -> 301 directly to canonical in 1 Hop', async () => {
      const res = await request(app)
        .get(targetPath)
        .set('Host', 'www.sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'http');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe(`https://sritirumaladryfruits.com${targetPath}`);
    });

    it('Variant C: https://www.sritirumaladryfruits.com/:category -> 301 to canonical non-WWW', async () => {
      const res = await request(app)
        .get(targetPath)
        .set('Host', 'www.sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe(`https://sritirumaladryfruits.com${targetPath}`);
    });

    it('Variant D: https://sritirumaladryfruits.com/:category -> 200 OK without redirect', async () => {
      const res = await request(app)
        .get(targetPath)
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);
      expect(res.headers.location).toBeUndefined();
    });
  });

  describe('3. Representative Product Detail Route Single-Hop Resolution', () => {
    it('Variant A: http://sritirumaladryfruits.com/product/:id -> 301 to canonical product URL', async () => {
      const res = await request(app)
        .get(`/product/${activeProductId}`)
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'http');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe(`https://sritirumaladryfruits.com/product/${activeProductId}`);
    });

    it('Variant B: http://www.sritirumaladryfruits.com/product/:id -> 301 to canonical product URL in 1 Hop', async () => {
      const res = await request(app)
        .get(`/product/${activeProductId}`)
        .set('Host', 'www.sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'http');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe(`https://sritirumaladryfruits.com/product/${activeProductId}`);
    });

    it('Variant C: https://www.sritirumaladryfruits.com/product/:id -> 301 to canonical product URL', async () => {
      const res = await request(app)
        .get(`/product/${activeProductId}`)
        .set('Host', 'www.sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(301);
      expect(res.headers.location).toBe(`https://sritirumaladryfruits.com/product/${activeProductId}`);
    });

    it('Variant D: https://sritirumaladryfruits.com/product/:id -> 200 OK directly', async () => {
      const res = await request(app)
        .get(`/product/${activeProductId}`)
        .set('Host', 'sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(200);
      expect(res.headers.location).toBeUndefined();
    });
  });

  describe('4. Security & Edge Hardening: Untrusted Hosts & Health Probes', () => {
    it('rejects untrusted arbitrary hostnames with HTTP 400 to prevent open redirects (CWE-601)', async () => {
      const res = await request(app)
        .get('/')
        .set('Host', 'evil-attacker-site.com')
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(400);
      expect(res.text).toContain('Bad Request: Invalid Host header');
      expect(res.headers.location).toBeUndefined();
    });

    it('exempts internal health probes (/health, /ready, /metrics) from redirection', async () => {
      const healthRes = await request(app)
        .get('/health')
        .set('Host', 'localhost:3000')
        .set('X-Forwarded-Proto', 'http');

      expect(healthRes.status).toBe(200);
      expect(healthRes.body.status).toBe('UP');
      expect(healthRes.headers.location).toBeUndefined();

      const readyRes = await request(app)
        .get('/ready')
        .set('Host', 'localhost:3000')
        .set('X-Forwarded-Proto', 'http');

      expect(readyRes.status).toBe(200);
      expect(readyRes.body.status).toBe('READY');
      expect(readyRes.headers.location).toBeUndefined();
    });

    it('prevents protocol-relative path manipulation (//evil.com)', async () => {
      const res = await request(app)
        .get('//evil-phishing.com/test')
        .set('Host', 'www.sritirumaladryfruits.com')
        .set('X-Forwarded-Proto', 'http');

      expect(res.status).toBe(301);
      // Clean path starts with a single slash, preventing browser host hijacking
      expect(res.headers.location).toBe('https://sritirumaladryfruits.com/evil-phishing.com/test');
    });
  });
});
