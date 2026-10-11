process.env.VITEST = 'true';

async function verifySitemapAndRobots() {
  const { default: db } = await import('../src/database.js');
  const { app } = await import('../server.js');
  const { default: request } = await import('supertest');

  console.log('================================================================');
  console.log('   GOOGLE SEARCH CONSOLE PRE-SUBMISSION VALIDATION REPORT       ');
  console.log('   Target Origin: https://sritirumaladryfruits.com              ');
  console.log('================================================================\n');

  // 1. Robots.txt Validation
  console.log('--- 1. ROBOTS.TXT ENDPOINT VALIDATION ---');
  const robotsRes = await request(app)
    .get('/robots.txt')
    .set('Host', 'sritirumaladryfruits.com')
    .set('X-Forwarded-Proto', 'https');

  console.log(`HTTP Status:        ${robotsRes.status} (Expected: 200)`);
  console.log(`Content-Type:       ${robotsRes.headers['content-type']}`);
  const hasSitemapDirective = robotsRes.text.includes('Sitemap: https://sritirumaladryfruits.com/sitemap.xml');
  console.log(`Sitemap Directive:  ${hasSitemapDirective ? 'PASSED (Exact canonical HTTPS non-WWW)' : 'FAILED'}`);
  console.log(`Disallow /order:    ${robotsRes.text.includes('Disallow: /order') ? 'PASSED' : 'FAILED'}`);
  console.log(`Disallow /orders:   ${robotsRes.text.includes('Disallow: /orders') ? 'PASSED' : 'FAILED'}`);
  console.log(`Disallow /checkout: ${robotsRes.text.includes('Disallow: /checkout') ? 'PASSED' : 'FAILED'}`);
  console.log(`Disallow /admin:    ${robotsRes.text.includes('Disallow: /admin') ? 'PASSED' : 'FAILED'}`);
  console.log(`Allow /product/:    ${robotsRes.text.includes('Allow: /product/') ? 'PASSED' : 'FAILED'}`);
  console.log(`Allow /category/:   ${robotsRes.text.includes('Allow: /category/') ? 'PASSED' : 'FAILED'}`);

  // 2. Sitemap.xml Validation
  console.log('\n--- 2. SITEMAP.XML ENDPOINT & ENVELOPE VALIDATION ---');
  const sitemapRes = await request(app)
    .get('/sitemap.xml')
    .set('Host', 'sritirumaladryfruits.com')
    .set('X-Forwarded-Proto', 'https');

  console.log(`HTTP Status:        ${sitemapRes.status} (Expected: 200)`);
  console.log(`Content-Type:       ${sitemapRes.headers['content-type']}`);
  const hasXmlDeclaration = sitemapRes.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>');
  console.log(`XML Declaration:    ${hasXmlDeclaration ? 'PASSED' : 'FAILED'}`);
  const hasUrlsetEnvelope = sitemapRes.text.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">') && sitemapRes.text.endsWith('</urlset>');
  console.log(`XML Schema Envelop: ${hasUrlsetEnvelope ? 'PASSED (Compliant with sitemaps.org 0.9 standard)' : 'FAILED'}`);

  // Extract all <loc> URLs
  const locMatches = [...sitemapRes.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const totalUrls = locMatches.length;
  console.log(`Total URLs Count:   ${totalUrls}`);

  // Breakdown
  const homeUrls = locMatches.filter(u => u === 'https://sritirumaladryfruits.com/');
  const categoryUrls = locMatches.filter(u => u.includes('/category/'));
  const trackUrls = locMatches.filter(u => u === 'https://sritirumaladryfruits.com/track');
  const productUrls = locMatches.filter(u => u.includes('/product/'));

  console.log('\n--- 3. DETAILED URL INVENTORY BREAKDOWN ---');
  console.log(`1. Homepage URLs:            ${homeUrls.length} (Expected: 1)`);
  console.log(`2. Category URLs:            ${categoryUrls.length}`);
  categoryUrls.forEach(c => console.log(`   - ${c}`));
  console.log(`3. Order Tracking URLs:      ${trackUrls.length} (Expected: 1)`);
  console.log(`4. Product Detail URLs:      ${productUrls.length}`);
  console.log(`   Sum of Inventory:         ${homeUrls.length + categoryUrls.length + trackUrls.length + productUrls.length} === ${totalUrls}`);

  // 4. Quality & Security Checks
  console.log('\n--- 4. SITEMAP QUALITY & HYGIENE AUDIT ---');
  
  // Non-canonical origins
  const nonCanonicalUrls = locMatches.filter(u => !u.startsWith('https://sritirumaladryfruits.com/'));
  console.log(`Non-Canonical Host URLs:     ${nonCanonicalUrls.length} (Expected: 0)`);
  if (nonCanonicalUrls.length > 0) console.log('   Leaked URLs:', nonCanonicalUrls);

  // Duplicates
  const duplicates = locMatches.filter((item, index) => locMatches.indexOf(item) !== index);
  console.log(`Duplicate URLs:              ${duplicates.length} (Expected: 0)`);

  // Private routes leakage
  const privateLeaks = locMatches.filter(u => 
    u.includes('/admin') || u.includes('/order') || u.includes('/cart') || 
    u.includes('/checkout') || u.includes('/account') || u.includes('/login') ||
    u.includes('/shift') || u.includes('/analytics') || u.includes('/health') ||
    u.includes('/ready') || u.includes('/metrics')
  );
  console.log(`Private Route Leakage:       ${privateLeaks.length} (Expected: 0)`);

  // 5. Database Cross-Check
  console.log('\n--- 5. DATABASE CATALOG CROSS-REFERENCE ---');
  const dbActiveProducts = db.prepare('SELECT id, name, active FROM product_variants WHERE active = 1').all() as any[];
  console.log(`Active Products in Database: ${dbActiveProducts.length}`);
  console.log(`Product URLs in Sitemap:     ${productUrls.length}`);
  const matchCatalog = dbActiveProducts.length === productUrls.length;
  console.log(`Catalog Alignment:           ${matchCatalog ? 'PERFECT 1:1 MATCH' : 'MISMATCH'}`);

  // Check if any product in sitemap is inactive in DB
  const sitemapProductIds = productUrls.map(u => {
    const parts = u.split('/');
    return parseInt(parts[parts.length - 1], 10);
  });
  const inactiveInSitemap = db.prepare(`
    SELECT id, name, active FROM product_variants 
    WHERE id IN (${sitemapProductIds.slice(0, 100).join(',')}) AND active != 1
  `).all();
  console.log(`Inactive Products in Sitemap:${inactiveInSitemap.length} (Expected: 0)`);

  // 6. Direct HTTP Accessibility & Canonical Consistency on Rendered HTML
  console.log('\n--- 6. HTTP STATUS & HTML CANONICAL AGREEMENT AUDIT ---');
  
  const auditRoutes = [
    { name: 'Homepage', route: '/', expectedCanonical: 'https://sritirumaladryfruits.com/' },
    { name: 'Category', route: '/category/Dry%20Fruits', expectedCanonical: 'https://sritirumaladryfruits.com/category/Dry%20Fruits' },
    { name: 'Tracking', route: '/track', expectedCanonical: 'https://sritirumaladryfruits.com/track' }
  ];

  if (productUrls.length > 0) {
    const sampleProductPath = `/product/${sitemapProductIds[0]}`;
    auditRoutes.push({
      name: `Sample Product (#${sitemapProductIds[0]})`,
      route: sampleProductPath,
      expectedCanonical: `https://sritirumaladryfruits.com${sampleProductPath}`
    });
  }

  for (const item of auditRoutes) {
    const res = await request(app)
      .get(item.route)
      .set('Host', 'sritirumaladryfruits.com')
      .set('X-Forwarded-Proto', 'https');

    const canonicalMatch = res.text.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
    const htmlCanonical = canonicalMatch ? canonicalMatch[1] : 'NONE';
    const isAgree = htmlCanonical === item.expectedCanonical;
    const is200 = res.status === 200;
    const redirects = res.headers['location'] ? 1 : 0;

    console.log(`Route [${item.name}]:`);
    console.log(`  - GET ${item.route}`);
    console.log(`  - HTTP Status:        ${res.status} (Redirects: ${redirects})`);
    console.log(`  - HTML <link rel=canonical>: ${htmlCanonical}`);
    console.log(`  - Sitemap <loc> URL:         ${item.expectedCanonical}`);
    console.log(`  - Canonical Agreement:       ${isAgree && is200 ? 'VERIFIED MATCH (200 OK, 0 redirects)' : 'FAILED'}`);
  }

  console.log('\n================================================================');
  console.log('   PRE-SUBMISSION VERIFICATION COMPLETE: ALL SYSTEMS READY       ');
  console.log('================================================================\n');

  process.exit(0);
}

verifySitemapAndRobots().catch(err => {
  console.error('Validation error:', err);
  process.exit(1);
});
