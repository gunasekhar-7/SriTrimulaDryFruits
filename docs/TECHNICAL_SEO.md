# Technical SEO Architecture & Specification
**Sri Tirumala Dryfruits & Millets Storefront**
*Location: Tekkali, Srikakulam District, Andhra Pradesh - 532201*

---

## 1. Executive Summary

This document details the Technical Search Engine Optimization (SEO) architecture implemented for the public e-commerce storefront. The implementation establishes search engine indexing, crawl efficiency, rich snippets eligibility (Schema.org / Google Search Central standards), local SEO prominence in Andhra Pradesh, and strict isolation of internal/private routes.

---

## 2. URL Strategy & Canonicalization

### 2.1 Canonical URL Structure
To eliminate duplicate content penalties from tracking parameters, sessions, or faceted navigation, every indexable page declares a self-referential `<link rel="canonical">` tag.

| Route Pattern | Canonical Format | Purpose |
|---|---|---|
| `/` | `https://sritirumaladryfruits.com/` | Storefront Homepage |
| `/product/:id` | `https://sritirumaladryfruits.com/product/:id` | Product Detail Page (PDP) |
| `/category/:category` | `https://sritirumaladryfruits.com/category/:category` | Category Listing Page (PLP) |
| `/track` | `https://sritirumaladryfruits.com/track` | Public Order Tracking Page |

Canonical base URLs are strictly locked to the immutable canonical origin `https://sritirumaladryfruits.com` via `src/config/site.ts`.

### 2.2 Single-Hop Canonical Origin & HTTPS / WWW Normalization Policy
All inbound public traffic is normalized to the canonical origin in strictly **one permanent redirect (HTTP 301)**:
* `http://sritirumaladryfruits.com/*` $\to$ `https://sritirumaladryfruits.com/*` (301, 1 hop)
* `http://www.sritirumaladryfruits.com/*` $\to$ `https://sritirumaladryfruits.com/*` (301, 1 hop — zero intermediate HTTPS-WWW hops)
* `https://www.sritirumaladryfruits.com/*` $\to$ `https://sritirumaladryfruits.com/*` (301, 1 hop)
* `https://sritirumaladryfruits.com/*` $\to$ HTTP 200 OK (Served directly, zero redirects)

Key Architecture Rules:
1. **Preservation**: Full path and query string parameters are preserved across redirects.
2. **Security**: Untrusted arbitrary hostnames are rejected with HTTP 400 Bad Request to prevent open redirect vulnerabilities (CWE-601).
3. **Exemptions**: Internal health probes (`/health`, `/ready`, `/metrics`), container local traffic (`localhost`, `127.0.0.1`), and search crawler metadata files (`/robots.txt`, `/sitemap.xml`) bypass hostname redirects.
4. **Dual Enforcement**: Enforced both at the edge reverse proxy layer (`nginx/conf.d/sritirumaladryfruits.conf` or Cloudflare Page/Transform Rules) and in the application middleware (`src/middleware/canonical-redirect.ts`).


---

## 3. Metadata Standards

### 3.1 Titles & Meta Descriptions

1. **Homepage (`/`)**:
   - **Title**: `Sri Tirumala Dryfruits & Millets | Premium Organic Dry Fruits in Tekkali, AP`
   - **Description**: `Shop 100% natural organic dry fruits, crunchy cashews, premium almonds, wholesome millets, seeds, and spices online at Sri Tirumala Dryfruits, Tekkali. Free local delivery available.`

2. **Category Listing (`/category/:category`)**:
   - **Title**: `Buy Premium {Category} Online | Sri Tirumala Dryfruits Tekkali`
   - **Description**: `Order fresh, wholesome {Category} online from Sri Tirumala Dryfruits in Tekkali, Andhra Pradesh. Pure grading, 100% chemical-free quality with fast delivery.`

3. **Product Detail (`/product/:id`)**:
   - **Title**: `{Name} ({Category}) - Buy Online at ₹{Price} | Sri Tirumala Dryfruits`
   - **Description**: `Buy fresh, chemical-free {Name} online at Sri Tirumala Dryfruits, Tekkali. Grade A quality, ₹{Price}. {In Stock / Out of Stock}. Fast express delivery in AP.`

4. **Order Tracking (`/track`)**:
   - **Title**: `Track Your Order Status | Sri Tirumala Dryfruits Tekkali`
   - **Description**: `Track your live dry fruits and millets order status, dispatch, and delivery from Sri Tirumala Dryfruits, Tekkali.`

### 3.2 Open Graph & Twitter Cards

Every public page outputs compliant Open Graph protocol (`og:*`) and Twitter Card (`twitter:*`) tags:
- `og:site_name`: `Sri Tirumala Dryfruits`
- `og:locale`: `en_IN`
- `og:type`: `website` (for home/category/track) or `product` (for PDPs)
- `og:title`, `og:description`, `og:url`, `og:image`
- Product-specific tags for e-commerce rich previews:
  - `product:price:amount`: Number formatted to 2 decimals (e.g. `850.00`)
  - `product:price:currency`: `INR`
  - `product:availability`: `in stock` | `out of stock`

---

## 4. Robots & Crawl Control

### 4.1 robots.txt (`GET /robots.txt`)

Dynamic, non-cached text/plain response configured with strict directives:

```txt
User-agent: *

# Disallow private customer, authentication, cart, checkout, POS, and admin routes
Disallow: /admin/
Disallow: /account/
Disallow: /customer/
Disallow: /checkout
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
Disallow: /order/
Disallow: /labels/
Disallow: /api/
Disallow: /login
Disallow: /health
Disallow: /ready
Disallow: /metrics

# Allow public indexing
Allow: /
Allow: /product/
Allow: /category/
Allow: /track
Allow: /storefront.css
Allow: /storefront.js

# Sitemap location
Sitemap: https://sritirumaladryfruits.com/sitemap.xml
```

### 4.2 robots Meta Directives

- **Public Storefront Pages**:
  `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">`
- **Private & Protected Views**:
  `<meta name="robots" content="noindex, nofollow">`
  Applied explicitly across:
  - `views/checkout.ejs`
  - `views/customer_login.ejs`
  - `views/customer_register.ejs`
  - `views/customer_dashboard.ejs`
  - `views/customer_orders.ejs`
  - `views/customer_order_detail.ejs`
  - `views/customer_profile.ejs`
  - `views/customer_addresses.ejs`
  - `views/customer_wishlist.ejs`
  - `views/login.ejs` (Staff login)
  - `views/barcode_label.ejs`
  - `views/error.ejs` (404 and 500 pages)
  - Any view loaded within an active staff session (`session.user`).

---

## 5. XML Sitemap (`GET /sitemap.xml`)

Dynamic `application/xml` sitemap containing:
1. Storefront root (`/`) — priority `1.0`, change frequency `daily`
2. All distinct category URLs (`/category/{Category}`) — priority `0.8`, change frequency `weekly`
3. All catalog product URLs (`/product/{id}`) — priority `0.9`, change frequency `daily`
4. Public order tracking (`/track`) — priority `0.5`, change frequency `monthly`
5. Strict XML entity escaping (`&` $\to$ `&amp;`) and W3C ISO-8601 `<lastmod>` dates.

---

## 6. Schema.org Structured Data (JSON-LD)

Structured data is rendered as valid, separate `<script type="application/ld+json">` blocks:

### 6.1 Product Markup (`@type: "Product"`)
```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Royal Kashmiri Almonds",
  "image": ["https://sritirumaladryfruits.com/uploads/almonds.jpg"],
  "description": "100% natural, sorted with hygiene standards...",
  "sku": "ALM-001",
  "mpn": "ALM-001",
  "category": "Dry Fruits",
  "brand": {
    "@type": "Brand",
    "name": "Sri Tirumala Dry Fruits"
  },
  "offers": {
    "@type": "Offer",
    "url": "https://sritirumaladryfruits.com/product/1",
    "priceCurrency": "INR",
    "price": "850.00",
    "priceValidUntil": "2027-12-31",
    "itemCondition": "https://schema.org/NewCondition",
    "availability": "https://schema.org/InStock",
    "seller": {
      "@type": "GroceryStore",
      "name": "Sri Tirumala Dry Fruits",
      "telephone": "+919133133931",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "Opposite RTC Complex",
        "addressLocality": "Tekkali",
        "addressRegion": "Andhra Pradesh",
        "postalCode": "532201",
        "addressCountry": "IN"
      }
    }
  }
}
```

### 6.2 Local Business & Grocery Store Markup (`@type: ["GroceryStore", "LocalBusiness"]`)
Establishes Google Maps, Local Pack, and Merchant Center eligibility in Tekkali:
- `@id`: `https://sritirumaladryfruits.com/#store` (Unique persistent entity URI)
- Address: Opposite RTC Complex, Tekkali, Srikakulam District, Andhra Pradesh - 532201
- Geo-coordinates: Latitude `18.6163`, Longitude `84.2335`
- Telephone: `+919133133931`
- OpeningHoursSpecification: Monday - Sunday, 09:00 - 21:30
- PriceRange: `₹₹`
- CurrenciesAccepted: `INR`
- PaymentAccepted: `Cash, UPI, Credit Card, Debit Card`
- Script-Breakout Defense: Safely encoded with `\u003c` escaping in `views/header.ejs` to eliminate XSS.

### 6.3 BreadcrumbList Markup & Navigation (`@type: "BreadcrumbList"`)
Renders hierarchical breadcrumbs both visibly in the storefront UI via `views/partials/breadcrumbs.ejs` and to crawlers via Schema.org JSON-LD:
- **Category Pages:**
  - Position 1: `Home` (`https://sritirumaladryfruits.com/`)
  - Position 2: `{Category}` (`https://sritirumaladryfruits.com/category/{Category}`)
- **Product Detail Pages:**
  - Position 1: `Home` (`https://sritirumaladryfruits.com/`)
  - Position 2: `{Category}` (`https://sritirumaladryfruits.com/category/{Category}`)
  - Position 3: `{Product Name}` (`https://sritirumaladryfruits.com/product/{id}`)
- **Graceful Uncategorized Fallback:**
  - When product category is missing/null/empty: Omits fictitious category entries and renders 2-level trail (`Home` -> `{Product Name}`).
- **Accessibility & Mobile UX:**
  - Fully semantic `<nav aria-label="Breadcrumb">` landmark.
  - Active page item identified with `aria-current="page"`.
  - Responsive flexbox wrapping and text truncation on small mobile screens.

---

## 7. Automated Testing & HTML Validation

The technical SEO and content test suite includes:
1. `tests/unit/seo.unit.test.ts` (25 unit tests): Validates XML sanitization, sitemap priorities, URL canonicalization, and schema builders.
2. `tests/integration/canonical-domain.test.ts` (10 integration tests): Validates locked canonical domain across all SEO templates.
3. `tests/integration/robots-sitemap.test.ts` (11 integration tests): Validates robots.txt, XML sitemap envelope, and crawling directives.
4. `tests/integration/single-hop-redirect.test.ts` (15 integration tests): Validates single-hop 301 normalization across all 4 origin variants.
5. `tests/integration/html-validation.test.ts` (5 integration tests): Validates HTML envelope tags, single `<h1>` tag per PDP, non-empty metadata, and zero-error `JSON.parse()`.
6. `tests/integration/googlebot-core-urls.test.ts` (21 integration tests): Simulates Googlebot Smartphone crawl across core proof URLs.
7. `tests/integration/structured-data.test.ts` (8 integration tests): Validates Product & GroceryStore JSON-LD parsing, inventory-to-availability mapping, INR pricing, missing-identifier handling, and script breakout prevention.
8. `tests/integration/product-content-quality.test.ts` (7 integration tests): Validates elimination of thin boilerplate, commodity-tailored storage instructions, authentic grade extractions, and accessible image alt tags.
9. `tests/integration/breadcrumbs.test.ts` (10 integration tests): Validates visible navigation, BreadcrumbList JSON-LD, URL encoding with spaces, missing-category handling, 404 for deleted categories, mobile accessibility, and Host header immunity.
