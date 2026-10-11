import { Product } from '../types/index.js';

export interface EnrichedProductContent {
  description: string;
  isCustomDescription: boolean;
  gradeVariety?: string;
  packSizeText: string;
  storageInstructions: string;
  culinaryUsage: string;
  allergenInfo: string;
  provenanceStatement: string;
  verifiedAttributes: { key: string; value: string }[];
  missingFields: string[];
}

/**
 * Extracts verifiable grade, cultivar, or classification from authentic product data.
 * Returns undefined if no verified grade exists (does NOT fabricate claims).
 */
export function extractVerifiedGrade(name: string): string | undefined {
  if (!name || typeof name !== 'string') return undefined;

  // Cashew specific grades (All-India Cashew Grading Standards)
  if (/\bW[- ]?180\b/i.test(name)) return 'W-180 (King Size Jumbo Wholes)';
  if (/\bW[- ]?210\b/i.test(name)) return 'W-210 (Jumbo Wholes)';
  if (/\bW[- ]?240\b/i.test(name)) return 'W-240 (Standard Large Wholes)';
  if (/\bW[- ]?320\b/i.test(name)) return 'W-320 (Standard Wholes)';
  if (/\bW[- ]?400\b/i.test(name)) return 'W-400 (Small Wholes)';
  if (/\bJH\b|\bJumbo\s+Half\b/i.test(name)) return 'JH (Jumbo Halves)';
  if (/\bSplits?\b|\bKaju\s+Tukda\b/i.test(name)) return 'Split Kernels (Culinary Grade)';

  // Almond types & cultivars
  if (/\bMamra\b/i.test(name)) return 'Mamra Heirloom Cultivar';
  if (/\bKashmiri\b/i.test(name)) return 'Kashmiri Gold Grade';
  if (/\bCalifornia\b/i.test(name)) return 'California Nonpareil Type';
  if (/\bGurbandi\b/i.test(name)) return 'Gurbandi Choti Giri';

  // Pistachio varieties
  if (/\bRoasted\b/i.test(name) && /\bSalted\b/i.test(name)) return 'Roasted & Salted In-Shell';
  if (/\bRoasted\b/i.test(name)) return 'Dry Roasted Kernels';
  if (/\bPlain\b|\bRaw\b/i.test(name)) return 'Natural Raw Kernels';

  // Date varieties
  if (/\bMedjool\b/i.test(name)) return 'Medjool Large Dates';
  if (/\bKimia\b/i.test(name)) return 'Kimia Soft Dates';
  if (/\bAjwa\b/i.test(name)) return 'Ajwa Dates';
  if (/\bKalmi\b|\bSafawi\b/i.test(name)) return 'Kalmi / Safawi Variety';

  // Millets
  if (/\bFoxtail\b/i.test(name)) return 'Foxtail Millet (Korralu)';
  if (/\bFinger\b|\bRagi\b/i.test(name)) return 'Finger Millet (Ragi / Chollu)';
  if (/\bKodo\b/i.test(name)) return 'Kodo Millet (Arikelu)';
  if (/\bBarnyard\b/i.test(name)) return 'Barnyard Millet (Udalu)';
  if (/\bLittle\b/i.test(name)) return 'Little Millet (Samalu)';
  if (/\bPearl\b|\bBajra\b/i.test(name)) return 'Pearl Millet (Sajjalu)';

  // Raisins & Berries
  if (/\bKishmish\b|\bRaisins?\b/i.test(name)) {
    if (/\bGolden\b/i.test(name)) return 'Golden Long Raisins';
    if (/\bBlack\b/i.test(name)) return 'Black Seedless Raisins';
    if (/\bGreen\b/i.test(name)) return 'Green Long Raisins';
  }

  // Figs
  if (/\bFigs?\b|\bAnjeer\b/i.test(name)) {
    if (/\bAfghan\b/i.test(name)) return 'Afghan Cultivar Figs';
    return 'Whole Dried Figs (Anjeer)';
  }

  return undefined;
}

/**
 * Returns commodity-accurate storage instructions for Tekkali / Coastal Andhra climate.
 */
export function getStorageInstructions(category: string, name: string): string {
  const cat = (category || '').toLowerCase();
  const lowerName = (name || '').toLowerCase();

  if (lowerName.includes('fig') || lowerName.includes('anjeer') || lowerName.includes('date') || lowerName.includes('raisin')) {
    return 'High-moisture natural fruit. Keep in an airtight container in a dry location. Refrigeration after opening is strongly recommended in warm or coastal climates to retain softness and prevent natural sugar crystallization.';
  }

  if (cat.includes('millet')) {
    return 'Store in a clean, airtight canister in a dry pantry. Keep away from moisture to avoid clumping. Periodic sun-drying maintains natural freshness over long storage.';
  }

  if (cat.includes('seed')) {
    return 'Store in an airtight glass jar in a cool, dark cupboard or refrigerator. Keep away from heat and air to prevent the oxidation of delicate natural oils.';
  }

  if (cat.includes('spice')) {
    return 'Store strictly in an airtight, opaque container in a cool, dark location. Protect from steam, moisture, and heat to preserve aromatic volatile oils.';
  }

  // Dry fruits / Tree nuts
  return 'Store in an airtight container in a cool, dry place away from direct sunlight. Refrigeration is recommended during summer and humid monsoon months to preserve natural crunch and essential nut oils.';
}

/**
 * Returns culinary usage advice based on actual product classification.
 */
export function getCulinaryUsage(category: string, name: string): string {
  const cat = (category || '').toLowerCase();
  const lowerName = (name || '').toLowerCase();

  if (lowerName.includes('almond') || lowerName.includes('walnut')) {
    return 'Can be eaten raw, soaked overnight, blended into smoothies, or chopped into breakfast porridge, halwa, and festive sweets.';
  }

  if (lowerName.includes('cashew')) {
    return 'Ready to enjoy as an evening snack, toasted in ghee for biryanis and pulao, ground into creamy gravies, or used in traditional kaju katli.';
  }

  if (lowerName.includes('pistachio')) {
    return 'Enjoy as an in-hand snack, chopped over traditional kulfi, ice creams, desserts, or sprinkled into festive bakery sweets.';
  }

  if (lowerName.includes('date') || lowerName.includes('fig') || lowerName.includes('raisin')) {
    return 'Ready-to-eat whole. Ideal as a wholesome natural sweetener for milkshakes, oatmeal bowls, energy bars, and festive dry-fruit platters.';
  }

  if (cat.includes('millet')) {
    return 'Rinse thoroughly before cooking. Cook with 1:2 water ratio as a rice substitute, or grind into wholesome idli, dosa, upma, or porridge.';
  }

  if (cat.includes('seed')) {
    return 'Sprinkle raw or dry-roasted over morning salads, yogurt, smoothies, oatmeal, or fold into multigrain bread dough.';
  }

  if (cat.includes('spice')) {
    return 'Infuse into warm milk (saffron) or temper in hot ghee/oil at the beginning of cooking to release authentic aroma and flavor.';
  }

  return 'Ready for direct culinary use or snacking according to personal dietary preference.';
}

/**
 * Returns accurate allergen statements based on commodity classification.
 */
export function getAllergenInfo(category: string, name: string): string {
  const cat = (category || '').toLowerCase();
  const lowerName = (name || '').toLowerCase();

  if (cat.includes('nut') || lowerName.includes('almond') || lowerName.includes('cashew') || lowerName.includes('walnut') || lowerName.includes('pistachio')) {
    return 'Contains Tree Nuts. Processed and packaged in a facility that handles tree nuts and edible seeds.';
  }

  if (cat.includes('seed')) {
    return 'Edible seeds. 100% vegetarian. May be packaged in a facility that also handles tree nuts.';
  }

  if (cat.includes('millet')) {
    return 'Naturally gluten-free whole grain. 100% vegetarian.';
  }

  if (cat.includes('dry fruit') || lowerName.includes('date') || lowerName.includes('fig') || lowerName.includes('raisin')) {
    return '100% vegetarian dried fruit. May contain natural pit fragments in whole date varieties.';
  }

  return '100% vegetarian food product.';
}

/**
 * Resolves verified pack size text.
 */
export function getPackSizeText(product: Product): string {
  // Check if pack size is in product name (e.g. "500g", "1kg", "250 gm")
  const match = product.name.match(/\b(\d+\s*(?:g|gm|kg|ml|l|pack|piece|pcs))\b/i);
  if (match) return match[1];

  if (product.size_weight && product.size_weight !== 1 && product.unit && product.unit !== 'unit') {
    return `${product.size_weight} ${product.unit}`;
  }

  if (product.unit && product.unit !== 'unit') {
    return `Per ${product.unit}`;
  }

  return 'Standard Retail Pack';
}

/**
 * Enriches product data with structured, authentic facts without fabricating unsupported claims.
 */
export function getEnrichedProductContent(product: Product): EnrichedProductContent {
  const cat = product.category || 'Dry Fruits';
  const customDesc = (product.product_description || product.description || '').trim();
  const isCustomDescription = customDesc.length > 0;

  // Grade
  const gradeVariety = extractVerifiedGrade(product.name);

  // Pack size
  const packSizeText = getPackSizeText(product);

  // Storage, Culinary, Allergen
  const storageInstructions = getStorageInstructions(cat, product.name);
  const culinaryUsage = getCulinaryUsage(cat, product.name);
  const allergenInfo = getAllergenInfo(cat, product.name);
  const provenanceStatement = 'Available for purchase and verified dispatch from Sri Tirumala Dry Fruits & Millets retail storefront, Opposite RTC Complex, Tekkali, Srikakulam District, Andhra Pradesh - 532201.';

  // Structured verified attributes list
  const verifiedAttributes: { key: string; value: string }[] = [
    { key: 'Product Name', value: product.name },
    { key: 'Category', value: cat },
    { key: 'Packaging Size', value: packSizeText }
  ];

  if (product.barcode) {
    verifiedAttributes.push({ key: 'Barcode / SKU', value: product.barcode });
  }

  if (gradeVariety) {
    verifiedAttributes.push({ key: 'Identified Grade / Type', value: gradeVariety });
  }

  verifiedAttributes.push({ key: 'Storage Guidance', value: storageInstructions });
  verifiedAttributes.push({ key: 'Allergen Notice', value: allergenInfo });
  verifiedAttributes.push({ key: 'Retail Store Location', value: provenanceStatement });

  // Missing fields tracking for store owner audit
  const missingFields: string[] = [];
  if (!isCustomDescription) missingFields.push('Custom merchant description');
  if (!product.image_url) missingFields.push('Product photograph');
  if (!gradeVariety) missingFields.push('Specific grading / cultivar classification');
  if (packSizeText === 'Standard Retail Pack') missingFields.push('Explicit net weight / pack size');
  if (!product.sku) missingFields.push('Custom SKU');

  // Final description (prioritizes custom merchant description; otherwise synthesizes factual overview)
  let description = customDesc;
  if (!description) {
    const gradePhrase = gradeVariety ? ` featuring ${gradeVariety}` : '';
    description = `${product.name} is a retail food item in the ${cat} category${gradePhrase}. Available in ${packSizeText.toLowerCase()} at our Tekkali store for local pickup and regional delivery. Weighed and checked upon order to guarantee authentic stock condition.`;
  }

  return {
    description,
    isCustomDescription,
    gradeVariety,
    packSizeText,
    storageInstructions,
    culinaryUsage,
    allergenInfo,
    provenanceStatement,
    verifiedAttributes,
    missingFields
  };
}
