import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SeoService } from '../../src/services/seo.service.js';
import { Product } from '../../src/types/index.js';
import { validateSiteUrl, buildCanonicalUrl, validateProductionSiteConfig, getCanonicalBaseUrl } from '../../src/config/site.js';

describe('SeoService (Unit Tests)', () => {
  let seoService: SeoService;
  const originalEnvSiteUrl = process.env.SITE_URL;

  beforeEach(() => {
    seoService = new SeoService();
    delete process.env.SITE_URL;
  });

  afterEach(() => {
    if (originalEnvSiteUrl) {
      process.env.SITE_URL = originalEnvSiteUrl;
    } else {
      delete process.env.SITE_URL;
    }
  });

  describe('getSiteUrl and Canonical Origin Security', () => {
    it('should respect process.env.SITE_URL when defined and valid', () => {
      process.env.SITE_URL = 'https://sritirumaladryfruits.com/';
      const url = seoService.getSiteUrl();
      expect(url).toBe('https://sritirumaladryfruits.com');
    });

    it('should NEVER allow attacker-controlled Host or forwarded headers to mutate canonical origin', () => {
      const mockAttackerReq = {
        headers: {
          'x-forwarded-proto': 'http',
          'x-forwarded-host': 'evil-attacker.com',
          host: 'malicious-phishing.com'
        },
        get: (h: string) => h === 'host' ? 'malicious-phishing.com' : undefined,
        protocol: 'http'
      } as any;

      const url = seoService.getSiteUrl(mockAttackerReq);
      expect(url).toBe('https://sritirumaladryfruits.com');
      expect(url).not.toContain('evil-attacker.com');
      expect(url).not.toContain('malicious-phishing.com');
    });

    it('should fall back safely to default production domain when SITE_URL is not set', () => {
      delete process.env.SITE_URL;
      const url = seoService.getSiteUrl();
      expect(url).toBe('https://sritirumaladryfruits.com');
    });
  });

  describe('generateRobotsTxt', () => {
    it('should generate valid robots.txt with required /order, /orders disallows, asset allowances, and canonical sitemap', () => {
      const robots = seoService.generateRobotsTxt('https://sritirumaladryfruits.com');

      expect(robots).toContain('User-agent: *');
      // Crucial Prompt 2 requirement: /order and /orders explicitly disallowed
      expect(robots).toContain('Disallow: /order\n');
      expect(robots).toContain('Disallow: /orders\n');
      expect(robots).toContain('Disallow: /checkout\n');
      expect(robots).toContain('Disallow: /cart\n');
      expect(robots).toContain('Disallow: /admin\n');
      expect(robots).toContain('Disallow: /account\n');
      expect(robots).toContain('Disallow: /customer\n');
      expect(robots).toContain('Disallow: /auth/\n');
      expect(robots).toContain('Disallow: /login\n');
      expect(robots).toContain('Disallow: /api/\n');

      // Asset and public route crawling permissions
      expect(robots).toContain('Allow: /\n');
      expect(robots).toContain('Allow: /product/\n');
      expect(robots).toContain('Allow: /category/\n');
      expect(robots).toContain('Allow: /track\n');
      expect(robots).toContain('Allow: /css/\n');
      expect(robots).toContain('Allow: /js/\n');
      expect(robots).toContain('Allow: /images/\n');
      expect(robots).toContain('Allow: /storefront.css\n');
      expect(robots).toContain('Allow: /storefront.js\n');

      // Exact HTTPS non-WWW sitemap reference
      expect(robots).toContain('Sitemap: https://sritirumaladryfruits.com/sitemap.xml');
    });
  });

  describe('generateSitemapXml', () => {
    const mockProducts: Product[] = [
      {
        id: 1,
        name: 'Royal Kashmiri Almonds & Cashews',
        category: 'Dry Fruits',
        barcode: 'DF-001',
        cost_price: 600,
        selling_price: 850,
        mrp: 950,
        total_qty: 50,
        sold_qty: 10,
        reserved_qty: 0,
        tax_rate: 0,
        created_at: '2026-09-01 10:00:00'
      } as any,
      {
        id: 2,
        name: 'Organic Foxtail Millet',
        category: 'Millets',
        barcode: 'ML-002',
        cost_price: 80,
        selling_price: 120,
        mrp: 140,
        total_qty: 100,
        sold_qty: 25,
        reserved_qty: 0,
        tax_rate: 0
        // No trustworthy timestamp - lastmod should NOT be fabricated
      } as any,
      {
        id: 3,
        name: 'Discontinued Item',
        category: 'Dry Fruits',
        barcode: 'DF-DISC',
        cost_price: 10,
        selling_price: 20,
        mrp: 20,
        total_qty: 0,
        sold_qty: 0,
        reserved_qty: 0,
        tax_rate: 0,
        active: 0 // Inactive product must be excluded from sitemap
      } as any
    ];

    it('should generate well-formed XML sitemap with correct encoding, trustworthy lastmod, and exclude inactive products', () => {
      const categories = ['Dry Fruits', 'Millets', 'Seeds'];
      const xml = seoService.generateSitemapXml('https://sritirumaladryfruits.com', mockProducts, categories);

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(xml).toContain('</urlset>');

      // Homepage entry
      expect(xml).toContain('<loc>https://sritirumaladryfruits.com/</loc>');
      expect(xml).toContain('<priority>1.0</priority>');

      // Track order entry
      expect(xml).toContain('<loc>https://sritirumaladryfruits.com/track</loc>');
      expect(xml).toContain('<priority>0.5</priority>');

      // Category entries
      expect(xml).toContain('<loc>https://sritirumaladryfruits.com/category/Dry%20Fruits</loc>');
      expect(xml).toContain('<loc>https://sritirumaladryfruits.com/category/Millets</loc>');
      expect(xml).toContain('<loc>https://sritirumaladryfruits.com/category/Seeds</loc>');

      // Product 1 has genuine timestamp: should have <lastmod>
      expect(xml).toContain('<loc>https://sritirumaladryfruits.com/product/1</loc>');
      expect(xml).toContain('<lastmod>2026-09-01</lastmod>');

      // Product 2 has NO timestamp: must NOT fabricate lastmod
      expect(xml).toContain('<loc>https://sritirumaladryfruits.com/product/2</loc>');

      // Product 3 is inactive: must NOT be included in sitemap
      expect(xml).not.toContain('<loc>https://sritirumaladryfruits.com/product/3</loc>');
    });

    it('should deduplicate URLs and ignore malformed products or empty categories', () => {
      const dirtyProducts = [
        { id: 10, name: 'Walnut', active: 1 } as any,
        { id: 10, name: 'Walnut Duplicate', active: 1 } as any, // duplicate ID
        { id: null, name: 'Invalid ID' } as any,
        { id: -1, name: 'Negative ID' } as any,
        null as any
      ];
      const dirtyCategories = ['Dry Fruits', 'Dry Fruits', '  ', ''];

      const xml = seoService.generateSitemapXml('https://sritirumaladryfruits.com', dirtyProducts, dirtyCategories);

      // Product 10 appears exactly once
      const countP10 = (xml.match(/<loc>https:\/\/sritirumaladryfruits\.com\/product\/10<\/loc>/g) || []).length;
      expect(countP10).toBe(1);

      // Malformed entries excluded
      expect(xml).not.toContain('/product/null');
      expect(xml).not.toContain('/product/-1');

      // Category Dry Fruits appears exactly once, blank categories ignored
      const countCat = (xml.match(/<loc>https:\/\/sritirumaladryfruits\.com\/category\/Dry%20Fruits<\/loc>/g) || []).length;
      expect(countCat).toBe(1);
      expect(xml).not.toContain('<loc>https://sritirumaladryfruits.com/category/</loc>');
    });

    it('should generate valid XML when database products and categories are completely empty', () => {
      const xml = seoService.generateSitemapXml('https://sritirumaladryfruits.com', [], []);

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(xml).toContain('<loc>https://sritirumaladryfruits.com/</loc>');
      expect(xml).toContain('<loc>https://sritirumaladryfruits.com/track</loc>');
      expect(xml).toContain('</urlset>');
    });
  });

  describe('buildProductStructuredData', () => {
    it('should build valid Schema.org Product markup with price and in-stock status', () => {
      const product: Product = {
        id: 101,
        name: 'Premium California Walnuts',
        category: 'Nuts',
        barcode: 'WN-101',
        cost_price: 700,
        selling_price: 990,
        mrp: 1100,
        total_qty: 25,
        sold_qty: 5,
        image_url: '/uploads/walnuts.jpg'
      };

      const sd = seoService.buildProductStructuredData(product, 'https://sritirumaladryfruits.com') as any;

      expect(sd['@context']).toBe('https://schema.org');
      expect(sd['@type']).toBe('Product');
      expect(sd.name).toBe('Premium California Walnuts');
      expect(sd.sku).toBe('WN-101');
      expect(sd.brand.name).toBe('Sri Tirumala Dry Fruits');
      expect(sd.offers['@type']).toBe('Offer');
      expect(sd.offers.price).toBe('990.00');
      expect(sd.offers.priceCurrency).toBe('INR');
      expect(sd.offers.availability).toBe('https://schema.org/InStock');
      expect(sd.offers.seller.name).toBe('Sri Tirumala Dry Fruits');
    });

    it('should reflect OutOfStock availability when inventory is exhausted', () => {
      const product: Product = {
        id: 102,
        name: 'Golden Raisins Kishmish',
        category: 'Dry Fruits',
        barcode: 'RS-102',
        cost_price: 200,
        selling_price: 320,
        total_qty: 10,
        sold_qty: 10
      };

      const sd = seoService.buildProductStructuredData(product, 'https://sritirumaladryfruits.com') as any;
      expect(sd.offers.availability).toBe('https://schema.org/OutOfStock');
    });
  });

  describe('buildStoreStructuredData & buildBreadcrumbsStructuredData', () => {
    it('should create valid GroceryStore / LocalBusiness Schema with Tekkali address', () => {
      const storeSd = seoService.buildStoreStructuredData('https://sritirumaladryfruits.com') as any;

      expect(storeSd['@context']).toBe('https://schema.org');
      expect(storeSd['@type']).toEqual(['GroceryStore', 'LocalBusiness']);
      expect(storeSd.name).toBe('Sri Tirumala Dryfruits & Millets');
      expect(storeSd.address.addressLocality).toBe('Tekkali');
      expect(storeSd.address.addressRegion).toBe('Andhra Pradesh');
      expect(storeSd.address.postalCode).toBe('532201');
      expect(storeSd.telephone).toBe('+919133133931');
    });

    it('should create valid 1-based BreadcrumbList Schema', () => {
      const crumbs = [
        { name: 'Home', url: 'https://sritirumaladryfruits.com/' },
        { name: 'Dry Fruits', url: 'https://sritirumaladryfruits.com/category/Dry%20Fruits' },
        { name: 'Almonds', url: 'https://sritirumaladryfruits.com/product/1' }
      ];

      const breadcrumbSd = seoService.buildBreadcrumbsStructuredData(crumbs) as any;

      expect(breadcrumbSd['@context']).toBe('https://schema.org');
      expect(breadcrumbSd['@type']).toBe('BreadcrumbList');
      expect(breadcrumbSd.itemListElement.length).toBe(3);
      expect(breadcrumbSd.itemListElement[0].position).toBe(1);
      expect(breadcrumbSd.itemListElement[0].name).toBe('Home');
      expect(breadcrumbSd.itemListElement[2].position).toBe(3);
      expect(breadcrumbSd.itemListElement[2].name).toBe('Almonds');
    });
  });

  describe('Page SEO builders', () => {
    it('buildHomeSeo should generate complete home SEO meta and canonical URL', () => {
      const seo = seoService.buildHomeSeo('https://sritirumaladryfruits.com');
      expect(seo.pageTitle).toContain('Sri Tirumala Dryfruits & Millets');
      expect(seo.canonicalUrl).toBe('https://sritirumaladryfruits.com/');
      expect(seo.ogType).toBe('website');
      expect(seo.structuredData).toBeDefined();
    });

    it('buildCategorySeo should generate unique category title and canonical URL', () => {
      const seo = seoService.buildCategorySeo('Millets', 'https://sritirumaladryfruits.com');
      expect(seo.pageTitle).toContain('Millets');
      expect(seo.canonicalUrl).toBe('https://sritirumaladryfruits.com/category/Millets');
      expect(seo.structuredData).toBeDefined();
    });

    it('buildProductSeo should generate price, stock availability, and paired schemas', () => {
      const product: Product = {
        id: 77,
        name: 'Chia Seeds',
        category: 'Seeds',
        barcode: 'CH-077',
        cost_price: 150,
        selling_price: 240,
        mrp: 290,
        total_qty: 30,
        sold_qty: 2
      };

      const seo = seoService.buildProductSeo(product, 'https://sritirumaladryfruits.com');
      expect(seo.pageTitle).toContain('Chia Seeds');
      expect(seo.pageTitle).toContain('₹240.00');
      expect(seo.canonicalUrl).toBe('https://sritirumaladryfruits.com/product/77');
      expect(seo.productPrice).toBe('240.00');
      expect(seo.productAvailability).toBe('in stock');
      expect(Array.isArray(seo.structuredData)).toBe(true);
      expect(seo.structuredData.length).toBe(2);
    });
  });

  describe('Site Configuration & Canonical URL Validator (site.ts)', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    describe('validateSiteUrl', () => {
      it('should validate and normalize a valid production HTTPS URL', () => {
        expect(validateSiteUrl('https://sritirumaladryfruits.com/', true)).toBe('https://sritirumaladryfruits.com');
        expect(validateSiteUrl('https://sritirumaladryfruits.com', true)).toBe('https://sritirumaladryfruits.com');
        expect(validateSiteUrl('https://staging.sritirumaladryfruits.com', true)).toBe('https://staging.sritirumaladryfruits.com');
      });

      it('should throw error for non-https protocol in production', () => {
        expect(() => validateSiteUrl('http://sritirumaladryfruits.com', true))
          .toThrow(/must use "https:" in production/);
      });

      it('should throw error for untrusted domain in production', () => {
        expect(() => validateSiteUrl('https://attacker-domain.com', true))
          .toThrow(/unexpected production domain/);
      });

      it('should throw error for invalid malformed URL string', () => {
        expect(() => validateSiteUrl('not-a-url', false))
          .toThrow(/not a valid absolute URL/);
        expect(() => validateSiteUrl('', false))
          .toThrow(/cannot be empty/);
      });

      it('should throw error if URL contains query parameters or hash fragments', () => {
        expect(() => validateSiteUrl('https://sritirumaladryfruits.com?ref=123', true))
          .toThrow(/must not contain query parameters/);
        expect(() => validateSiteUrl('https://sritirumaladryfruits.com#anchor', true))
          .toThrow(/must not contain query parameters/);
      });

      it('should allow http localhost in development mode', () => {
        expect(validateSiteUrl('http://localhost:3000', false)).toBe('http://localhost:3000');
        expect(validateSiteUrl('http://127.0.0.1:3000', false)).toBe('http://127.0.0.1:3000');
      });
    });

    describe('buildCanonicalUrl', () => {
      it('should build clean root canonical URL with trailing slash', () => {
        expect(buildCanonicalUrl('/')).toBe('https://sritirumaladryfruits.com/');
        expect(buildCanonicalUrl('')).toBe('https://sritirumaladryfruits.com/');
      });

      it('should build subpath canonical URL without trailing slash', () => {
        expect(buildCanonicalUrl('/product/34')).toBe('https://sritirumaladryfruits.com/product/34');
        expect(buildCanonicalUrl('category/Millets')).toBe('https://sritirumaladryfruits.com/category/Millets');
      });

      it('should strip query parameters and hash fragments to prevent indexation poisoning', () => {
        expect(buildCanonicalUrl('/product/34?ref=adwords&utm_source=fb'))
          .toBe('https://sritirumaladryfruits.com/product/34');
        expect(buildCanonicalUrl('/track?orderNumber=STDF-101&phone=919133133931'))
          .toBe('https://sritirumaladryfruits.com/track');
        expect(buildCanonicalUrl('/category/Dry%20Fruits#products'))
          .toBe('https://sritirumaladryfruits.com/category/Dry%20Fruits');
      });
    });

    describe('validateProductionSiteConfig', () => {
      it('should pass cleanly when SITE_URL is valid in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.SITE_URL = 'https://sritirumaladryfruits.com';
        expect(() => validateProductionSiteConfig()).not.toThrow();
      });

      it('should fail safely and throw when SITE_URL is invalid in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.SITE_URL = 'http://insecure-domain.com';
        expect(() => validateProductionSiteConfig()).toThrow();
      });
    });
  });
});
