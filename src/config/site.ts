/**
 * Centralized Site and Canonical URL Configuration
 *
 * Enforces immutable, validated canonical domain locking for all SEO metadata,
 * sitemaps, OpenGraph tags, and JSON-LD structured data.
 *
 * Eliminates Host Header Poisoning vulnerabilities (CWE-644 / CWE-116)
 * and canonical domain drift in search engines.
 */

export const CANONICAL_PRODUCTION_ORIGIN = 'https://sritirumaladryfruits.com';

const ALLOWED_PRODUCTION_HOSTNAMES = new Set([
  'sritirumaladryfruits.com',
  'www.sritirumaladryfruits.com',
  'staging.sritirumaladryfruits.com'
]);

/**
 * Validates a site URL string.
 *
 * Rules:
 * - Must be a valid, parsable absolute URL.
 * - Must NOT contain query strings or hash fragments.
 * - In production:
 *   - Must use 'https:' protocol.
 *   - Must belong to allowed production hostnames.
 * - Returns normalized origin without trailing slash (e.g. "https://sritirumaladryfruits.com").
 */
export function validateSiteUrl(rawUrl: string, isProduction: boolean = false): string {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('SITE_URL cannot be empty');
  }

  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err: any) {
    throw new Error(`Invalid SITE_URL: "${trimmed}" is not a valid absolute URL (${err?.message || 'malformed'})`);
  }

  // Reject query params or fragments in base site URL
  if (parsed.search || parsed.hash) {
    throw new Error(`Invalid SITE_URL: "${trimmed}" must not contain query parameters or fragments`);
  }

  if (isProduction) {
    if (parsed.protocol !== 'https:') {
      throw new Error(`Invalid SITE_URL: "${trimmed}" must use "https:" in production`);
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!ALLOWED_PRODUCTION_HOSTNAMES.has(hostname)) {
      throw new Error(`Invalid SITE_URL: unexpected production domain "${hostname}". Expected canonical domain "sritirumaladryfruits.com"`);
    }
  } else {
    // In development or test, allow http: or https:
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid SITE_URL: "${trimmed}" must use http: or https: protocol`);
    }
  }

  // Return normalized origin without trailing slashes
  return `${parsed.protocol}//${parsed.host}`;
}

/**
 * Returns the locked canonical base URL.
 *
 * Priority:
 * 1. If process.env.SITE_URL is defined, validate and return normalized base URL.
 * 2. If SITE_URL is not defined, return the verified production default:
 *    https://sritirumaladryfruits.com
 *
 * NEVER uses request headers, Host header, or unvalidated forwarded hosts.
 */
export function getCanonicalBaseUrl(): string {
  const envUrl = process.env.SITE_URL;
  const isProd = process.env.NODE_ENV === 'production';

  if (envUrl && envUrl.trim()) {
    return validateSiteUrl(envUrl, isProd);
  }

  // Safely default to production canonical origin across all environments
  return CANONICAL_PRODUCTION_ORIGIN;
}

/**
 * Constructs a normalized, validated canonical URL for any route path.
 *
 * Guarantees:
 * - Uses locked canonical base domain.
 * - Strips any query parameters (?foo=bar) and hash fragments (#section).
 * - Ensures correct slash formatting:
 *   - Root route returns: `${origin}/`
 *   - Sub-routes return: `${origin}/path` (no trailing slash)
 * - Prevents tracking parameters, session tokens, or temporary checkout state
 *   from corrupting canonical search indexation.
 */
export function buildCanonicalUrl(rawPath: string = '/'): string {
  const origin = getCanonicalBaseUrl();
  if (!rawPath || rawPath === '/' || rawPath.trim() === '') {
    return `${origin}/`;
  }

  // Strip query string and fragment
  const pathOnly = rawPath.split('?')[0].split('#')[0].trim();

  if (!pathOnly || pathOnly === '/') {
    return `${origin}/`;
  }

  // Ensure leading slash and strip any trailing slash
  const cleanPath = '/' + pathOnly.replace(/^\/+/, '').replace(/\/+$/, '');
  return `${origin}${cleanPath}`;
}

/**
 * Startup validation for production deployment.
 * Fails fast if SITE_URL is misconfigured.
 */
export function validateProductionSiteConfig(): void {
  if (process.env.NODE_ENV === 'production') {
    const envUrl = process.env.SITE_URL;
    if (envUrl) {
      validateSiteUrl(envUrl, true);
    }
  }
}

export const siteConfig = {
  canonicalOrigin: CANONICAL_PRODUCTION_ORIGIN,
  getCanonicalBaseUrl,
  buildCanonicalUrl,
  validateSiteUrl,
  validateProductionSiteConfig
};
