import db from '../src/database.js';

async function auditProductData() {
  console.log('=== PRODUCT DATA & SCHEMA AUDIT ===\n');

  const pvCols = db.prepare('PRAGMA table_info(product_variants)').all() as any[];
  const pCols = db.prepare('PRAGMA table_info(products)').all() as any[];
  console.log('product_variants columns:', pvCols.map(c => `${c.name} (${c.type})`));
  console.log('products columns:', pCols.map(c => `${c.name} (${c.type})`));

  const totalVariants = (db.prepare('SELECT count(*) as count FROM product_variants').get() as any).count;
  const activeVariants = (db.prepare('SELECT count(*) as count FROM product_variants WHERE active = 1').get() as any).count;
  const totalBaseProducts = (db.prepare('SELECT count(*) as count FROM products').get() as any).count;

  console.log(`\nTotal Variants: ${totalVariants} (Active: ${activeVariants})`);
  console.log(`Total Base Products: ${totalBaseProducts}`);

  // Inspect variant attributes
  const stats = db.prepare(`
    SELECT
      count(*) as total,
      sum(case when sku is not null and trim(sku) != '' then 1 else 0 end) as with_sku,
      sum(case when barcode is not null and trim(barcode) != '' then 1 else 0 end) as with_barcode,
      sum(case when image_url is not null and trim(image_url) != '' then 1 else 0 end) as with_image,
      sum(case when size_weight is not null and size_weight != 1 then 1 else 0 end) as with_custom_weight,
      sum(case when unit is not null and unit != 'unit' then 1 else 0 end) as with_custom_unit,
      sum(case when product_id is not null then 1 else 0 end) as with_product_id
    FROM product_variants WHERE active = 1
  `).get() as any;

  console.log('\nVariant Fields Completeness:');
  console.log(`- Barcodes:     ${stats.with_barcode} / ${activeVariants} (${Math.round((stats.with_barcode / activeVariants) * 100)}%)`);
  console.log(`- Custom SKUs:  ${stats.with_sku} / ${activeVariants} (${Math.round((stats.with_sku / activeVariants) * 100)}%)`);
  console.log(`- Images:       ${stats.with_image} / ${activeVariants} (${Math.round((stats.with_image / activeVariants) * 100)}%)`);
  console.log(`- Pack Sizes:   ${stats.with_custom_weight} / ${activeVariants} (${Math.round((stats.with_custom_weight / activeVariants) * 100)}%)`);
  console.log(`- Unit Types:   ${stats.with_custom_unit} / ${activeVariants} (${Math.round((stats.with_custom_unit / activeVariants) * 100)}%)`);
  console.log(`- Linked to Products table: ${stats.with_product_id} / ${activeVariants} (${Math.round((stats.with_product_id / activeVariants) * 100)}%)`);

  // Sample real catalog names to see how grades, origins, or types are stored in names
  const sampleNames = db.prepare('SELECT id, name, category, barcode, selling_price, mrp FROM product_variants WHERE active = 1 LIMIT 25').all() as any[];
  console.log('\nSample Real Product Names:');
  sampleNames.forEach(p => console.log(`[#${p.id}] "${p.name}" (Cat: ${p.category}, Barcode: ${p.barcode}, ₹${p.selling_price})`));

  // Check how many products have grades, types, or pack sizes embedded in name
  const allNames = db.prepare('SELECT id, name, category FROM product_variants WHERE active = 1').all() as any[];
  
  const gradeMatches = allNames.filter(p => /\b(W\d+|Mamra|Jumbo|Standard|Grade|Premium|Kashmiri|Afghan|California|Iranian)\b/i.test(p.name));
  const packSizeMatches = allNames.filter(p => /\b(\d+\s*(?:g|gm|kg|ml|l|pack|piece|pcs))\b/i.test(p.name));
  
  console.log(`\nProducts with specific Grade/Provenance in name: ${gradeMatches.length} / ${activeVariants}`);
  console.log(`Products with specific Pack Size in name: ${packSizeMatches.length} / ${activeVariants}`);

  const categories = db.prepare(`
    SELECT category, COUNT(*) as count 
    FROM product_variants 
    WHERE active = 1 
    GROUP BY category 
    ORDER BY count DESC
  `).all() as any[];

  console.log('\nDistinct Categories in Active Catalog:');
  categories.forEach(c => console.log(`  • "${c.category}": ${c.count} active products`));

  const tableCats = db.prepare('SELECT * FROM categories').all() as any[];
  console.log('\nRows in `categories` table:');
  tableCats.forEach(c => console.log(`  • ID: ${c.id}, Name: "${c.name}", Description: "${c.description}"`));

  console.log('\nCommodity Keywords in Product Catalog:');
  const keywords = ['millet', 'ragi', 'saffron', 'cardamom', 'clove', 'chia', 'flax', 'date', 'fig', 'sweet', 'hamper', 'seed', 'nut'];
  for (const kw of keywords) {
    const matches = db.prepare(`SELECT count(*) as cnt FROM product_variants WHERE active = 1 AND LOWER(name) LIKE ?`).get(`%${kw}%`) as any;
    console.log(`  • "${kw}": ${matches.cnt} products`);
  }
}

auditProductData().catch(console.error);
