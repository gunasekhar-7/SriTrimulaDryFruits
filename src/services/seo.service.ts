import { Product } from '../types/index.js';
import { Request } from 'express';
import { getCanonicalBaseUrl, buildCanonicalUrl } from '../config/site.js';

/**
 * Helper to escape XML special entities in sitemap loc and text fields
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validates whether a given date string is trustworthy and formats to ISO YYYY-MM-DD.
 * Returns null if missing, invalid, or untrusted.
 */
export function parseTrustworthyDate(dateStr?: string | null): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

export class SeoService {
  /**
   * Resolves locked canonical site base URL from centralized configuration.
   * Request host headers and forwarded host headers are strictly ignored
   * to prevent Host Header Poisoning and canonical drift.
   */
  getSiteUrl(_req?: Request): string {
    return getCanonicalBaseUrl();
  }

  /**
   * Generates production robots.txt file content ensuring private and transactional
   * routes are not crawled, while keeping all public catalog and static assets indexable.
   */
  generateRobotsTxt(siteUrl?: string): string {
    const canonicalOrigin = (siteUrl || getCanonicalBaseUrl()).replace(/\/+$/, '');

    return `# Robots.txt for Sri Tirumala Dryfruits & Millets
# Tekkali, Srikakulam District, Andhra Pradesh

User-agent: *

# Disallow private customer, order, authentication, cart, checkout, POS, and admin routes
Disallow: /order
Disallow: /orders
Disallow: /checkout
Disallow: /cart
Disallow: /admin
Disallow: /account
Disallow: /customer
Disallow: /auth/
Disallow: /login
Disallow: /sell
Disallow: /stock
Disallow: /add-product
Disallow: /add-stock
Disallow: /edit-product/
Disallow: /bill/
Disallow: /shift/
Disallow: /profit
Disallow: /analytics
Disallow: /online-orders
Disallow: /settings
Disallow: /labels/
Disallow: /api/
Disallow: /health
Disallow: /ready
Disallow: /metrics

# Allow public indexing of storefront, catalog, and rendering assets
Allow: /
Allow: /product/
Allow: /category/
Allow: /track
Allow: /css/
Allow: /js/
Allow: /images/
Allow: /storefront.css
Allow: /storefront.js

# Sitemap location
Sitemap: ${canonicalOrigin}/sitemap.xml
`;
  }

  /**
   * Generates dynamic sitemap.xml for homepage, categories, products, and tracking.
   * Enforces deduplication, XML escaping, canonical host locking, and authentic lastmod handling.
   */
  generateSitemapXml(siteUrl?: string, products: Product[] = [], categories: string[] = []): string {
    const canonicalOrigin = (siteUrl || getCanonicalBaseUrl()).replace(/\/+$/, '');
    const safeProducts = Array.isArray(products) ? products : [];
    const safeCategories = Array.isArray(categories) ? categories : [];

    let urlsXml = '';
    const seenUrls = new Set<string>();

    const addUrl = (loc: string, priority: string, changefreq: string, lastmod?: string | null) => {
      if (!loc || seenUrls.has(loc)) return;
      seenUrls.add(loc);

      const escapedLoc = escapeXml(loc);
      const lastmodTag = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : '';

      urlsXml += `  <url>
    <loc>${escapedLoc}</loc>${lastmodTag}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>\n`;
    };

    // 1. Homepage
    addUrl(`${canonicalOrigin}/`, '1.0', 'daily');

    // 2. Categories
    safeCategories.forEach(cat => {
      if (!cat || typeof cat !== 'string') return;
      const cleanCat = cat.trim();
      if (!cleanCat) return;
      const encoded = encodeURIComponent(cleanCat);
      addUrl(`${canonicalOrigin}/category/${encoded}`, '0.8', 'weekly');
    });

    // 3. Public Order Tracking
    addUrl(`${canonicalOrigin}/track`, '0.5', 'monthly');

    // 4. Products (Eligible active products only)
    safeProducts.forEach(p => {
      if (!p || typeof p.id !== 'number' || isNaN(p.id) || p.id <= 0) return;
      if ((p as any).active !== undefined && (p as any).active === 0) return;

      const lastmod = parseTrustworthyDate((p as any).updated_at || (p as any).created_at);
      addUrl(`${canonicalOrigin}/product/${p.id}`, '0.9', 'daily', lastmod);
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlsXml}</urlset>`;
  }

  /**
   * Generates Schema.org Product structured data from authentic product entity
   */
  buildProductStructuredData(product: Product, siteUrl: string): object {
    const rawStock = (product.total_qty || 0) - (product.sold_qty || 0) - ((product as any).reserved_qty || 0);
    const isAvailable = (product as any).active !== 0 && rawStock > 0;
    const productUrl = `${siteUrl}/product/${product.id}`;
    
    // Resolve absolute image URL if provided
    let imageUrl = `${siteUrl}/images/default-dryfruits.jpg`;
    if (product.image_url && typeof product.image_url === 'string' && product.image_url.trim() !== '') {
      const cleanImg = product.image_url.trim();
      imageUrl = cleanImg.startsWith('http') 
        ? cleanImg 
        : `${siteUrl}${cleanImg.startsWith('/') ? '' : '/'}${cleanImg}`;
    }

    const schema: Record<string, any> = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      image: [imageUrl],
      description: `100% natural, sorted with hygiene standards. Sourced directly for wholesome nutrition: ${product.name} (${product.category || 'Dry Fruits'}). Buy online at Sri Tirumala Dryfruits, Tekkali with fast delivery.`,
      category: product.category || 'Dry Fruits',
      brand: {
        '@type': 'Brand',
        name: 'Sri Tirumala Dry Fruits'
      },
      offers: {
        '@type': 'Offer',
        url: productUrl,
        priceCurrency: 'INR',
        price: Number(product.selling_price).toFixed(2),
        priceValidUntil: '2027-12-31',
        itemCondition: 'https://schema.org/NewCondition',
        availability: isAvailable ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        seller: {
          '@type': 'GroceryStore',
          name: 'Sri Tirumala Dry Fruits',
          telephone: '+919133133931',
          address: {
            '@type': 'PostalAddress',
            streetAddress: 'Opposite RTC Complex',
            addressLocality: 'Tekkali',
            addressRegion: 'Andhra Pradesh',
            postalCode: '532201',
            addressCountry: 'IN'
          }
        }
      }
    };

    // Authentic product identifiers (Omit rather than invent if missing)
    const authenticSku = (product as any).sku || product.barcode;
    if (authenticSku && typeof authenticSku === 'string' && authenticSku.trim() !== '') {
      schema.sku = authenticSku.trim();
      schema.mpn = authenticSku.trim();
    }

    return schema;
  }

  /**
   * Generates Schema.org LocalBusiness / GroceryStore structured data for Homepage
   */
  buildStoreStructuredData(siteUrl: string): object {
    return {
      '@context': 'https://schema.org',
      '@type': ['GroceryStore', 'LocalBusiness'],
      '@id': `${siteUrl}/#store`,
      name: 'Sri Tirumala Dryfruits & Millets',
      url: siteUrl,
      image: `${siteUrl}/images/store.jpg`,
      telephone: '+919133133931',
      priceRange: '₹₹',
      currenciesAccepted: 'INR',
      paymentAccepted: 'Cash, UPI, Credit Card, Debit Card',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Opposite RTC Complex',
        addressLocality: 'Tekkali',
        addressRegion: 'Andhra Pradesh',
        postalCode: '532201',
        addressCountry: 'IN'
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: 18.6163,
        longitude: 84.2335
      },
      openingHoursSpecification: [
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: [
            'Monday',
            'Tuesday',
            'Wednesday',
            'Thursday',
            'Friday',
            'Saturday',
            'Sunday'
          ],
          opens: '09:00',
          closes: '21:30'
        }
      ]
    };
  }

  /**
   * Safely serializes structured data to JSON string, escaping < to \u003c
   * to guarantee zero HTML script-breakout or XSS vulnerabilities.
   */
  serializeJsonLd(data: object): string {
    return JSON.stringify(data).replace(/</g, '\\u003c');
  }

  /**
   * Generates Schema.org BreadcrumbList structured data
   */
  buildBreadcrumbsStructuredData(crumbs: { name: string; url: string }[]): object {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((crumb, idx) => ({
        '@type': 'ListItem',
        position: idx + 1,
        name: crumb.name,
        item: crumb.url
      }))
    };
  }

  /**
   * SEO Metadata for Homepage
   */
  buildHomeSeo(siteUrl: string) {
    return {
      pageTitle: 'Sri Tirumala Dryfruits & Millets | Premium Organic Dry Fruits in Tekkali, AP',
      metaDescription: 'Shop 100% natural organic dry fruits, crunchy cashews, premium almonds, wholesome millets, seeds, and spices online at Sri Tirumala Dryfruits, Tekkali. Free local delivery available.',
      canonicalUrl: `${siteUrl}/`,
      ogType: 'website',
      ogTitle: 'Sri Tirumala Dryfruits & Millets — Wholesome Nutrition in Tekkali',
      ogDescription: 'Shop organic dry fruits, wholesome millets, crunchy nuts, and rich spices online. Fast local delivery across Tekkali and Andhra Pradesh.',
      ogImage: `${siteUrl}/images/og-storefront.jpg`,
      structuredData: this.buildStoreStructuredData(siteUrl)
    };
  }

  /**
   * SEO Metadata for Category Pages
   */
  buildCategorySeo(category: string, siteUrl: string) {
    const trimmedCat = (category || '').trim();
    const encoded = encodeURIComponent(trimmedCat);
    const crumbs = [
      { name: 'Home', url: `${siteUrl}/` },
      { name: trimmedCat, url: `${siteUrl}/category/${encoded}` }
    ];

    return {
      pageTitle: `Buy Premium ${trimmedCat} Online | Sri Tirumala Dryfruits Tekkali`,
      metaDescription: `Order fresh, wholesome ${trimmedCat} online from Sri Tirumala Dryfruits in Tekkali, Andhra Pradesh. Pure grading, 100% chemical-free quality with fast delivery.`,
      canonicalUrl: `${siteUrl}/category/${encoded}`,
      ogType: 'website',
      ogTitle: `Premium ${trimmedCat} Collection — Sri Tirumala Dryfruits`,
      ogDescription: `Discover high-quality, organic ${trimmedCat} sourced fresh with guaranteed hygiene and authentic flavor in Tekkali.`,
      ogImage: `${siteUrl}/images/og-category-${trimmedCat.toLowerCase().replace(/\s+/g, '-')}.jpg`,
      breadcrumbs: [
        { name: 'Home', url: '/' },
        { name: trimmedCat, current: true }
      ],
      structuredData: this.buildBreadcrumbsStructuredData(crumbs)
    };
  }

  /**
   * SEO Metadata for Product Details Pages
   */
  buildProductSeo(product: Product, siteUrl: string) {
    const rawCat = (product.category || '').trim();
    const hasCategory = rawCat.length > 0;
    const priceFormatted = Number(product.selling_price).toFixed(2);
    const stock = product.total_qty - (product.sold_qty || 0);

    const sdCrumbs: { name: string; url: string }[] = [
      { name: 'Home', url: `${siteUrl}/` }
    ];
    const viewCrumbs: { name: string; url?: string; current?: boolean }[] = [
      { name: 'Home', url: '/' }
    ];

    if (hasCategory) {
      sdCrumbs.push({ name: rawCat, url: `${siteUrl}/category/${encodeURIComponent(rawCat)}` });
      viewCrumbs.push({ name: rawCat, url: `/category/${encodeURIComponent(rawCat)}` });
    }

    sdCrumbs.push({ name: product.name, url: `${siteUrl}/product/${product.id}` });
    viewCrumbs.push({ name: product.name, current: true });

    return {
      pageTitle: `${product.name}${hasCategory ? ` (${rawCat})` : ''} - Buy Online at ₹${priceFormatted} | Sri Tirumala Dryfruits`,
      metaDescription: `Buy fresh, chemical-free ${product.name} online at Sri Tirumala Dryfruits, Tekkali. Grade A quality, ₹${priceFormatted}. ${stock > 0 ? 'In Stock' : 'Out of Stock'}. Fast express delivery in AP.`,
      canonicalUrl: `${siteUrl}/product/${product.id}`,
      ogType: 'product',
      ogTitle: `${product.name} — Sri Tirumala Dryfruits Tekkali`,
      ogDescription: `100% natural, sorted with hygiene standards. Sourced directly for wholesome nutrition. Buy online at ₹${priceFormatted}.`,
      ogImage: product.image_url ? (product.image_url.startsWith('http') ? product.image_url : `${siteUrl}${product.image_url}`) : `${siteUrl}/images/default-dryfruits.jpg`,
      productPrice: priceFormatted,
      productAvailability: stock > 0 ? 'in stock' : 'out of stock',
      breadcrumbs: viewCrumbs,
      structuredData: [
        this.buildProductStructuredData(product, siteUrl),
        this.buildBreadcrumbsStructuredData(sdCrumbs)
      ]
    };
  }

  /**
   * SEO Metadata for Order Tracking Page
   */
  buildTrackOrderSeo(siteUrl: string) {
    return {
      pageTitle: 'Track Your Order Status | Sri Tirumala Dryfruits Tekkali',
      metaDescription: 'Track your live dry fruits and millets order status, dispatch, and delivery from Sri Tirumala Dryfruits, Tekkali.',
      canonicalUrl: `${siteUrl}/track`,
      ogType: 'website',
      ogTitle: 'Track Live Order — Sri Tirumala Dryfruits',
      ogDescription: 'Check real-time delivery and packing status for your Sri Tirumala Dryfruits order in Tekkali, AP.',
      ogImage: `${siteUrl}/images/og-storefront.jpg`,
      structuredData: this.buildBreadcrumbsStructuredData([
        { name: 'Home', url: `${siteUrl}/` },
        { name: 'Track Order', url: `${siteUrl}/track` }
      ])
    };
  }
}

export const seoService = new SeoService();
