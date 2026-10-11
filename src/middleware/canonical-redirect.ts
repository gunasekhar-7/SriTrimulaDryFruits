import { Request, Response, NextFunction } from 'express';
import { CANONICAL_PRODUCTION_ORIGIN } from '../config/site.js';

const ALLOWED_PUBLIC_HOSTS = new Set([
  'sritirumaladryfruits.com',
  'www.sritirumaladryfruits.com'
]);

/**
 * Single-Hop Canonical HTTP/HTTPS and WWW Normalization Middleware
 *
 * Enforces:
 * 1. http://sritirumaladryfruits.com/*      -> 301 to https://sritirumaladryfruits.com/*
 * 2. http://www.sritirumaladryfruits.com/*  -> 301 to https://sritirumaladryfruits.com/*
 * 3. https://www.sritirumaladryfruits.com/* -> 301 to https://sritirumaladryfruits.com/*
 * 4. https://sritirumaladryfruits.com/*     -> 200 OK (no redirect)
 *
 * Guarantees:
 * - Single-hop resolution (never chains HTTP -> HTTPS -> WWW).
 * - Permanent 301 redirects for SEO origin normalization.
 * - Full path and query string preservation.
 * - Protocol-relative open redirect prevention.
 * - Untrusted arbitrary host rejection (400 Bad Request) to prevent open-redirect exploits.
 * - Exempts internal health probes (/health, /ready, /metrics) and localhost requests.
 */
export function canonicalRedirectMiddleware(req: Request, res: Response, next: NextFunction) {
  // Only enforce in production, or when explicitly enabled for verification testing
  const isEnforced = process.env.NODE_ENV === 'production' || process.env.ENFORCE_CANONICAL_REDIRECT === 'true';
  if (!isEnforced) {
    return next();
  }

  // Exempt internal health probes, monitoring endpoints, and crawl directives
  const path = req.path || '';
  if (
    path === '/health' ||
    path === '/ready' ||
    path === '/metrics' ||
    path === '/robots.txt' ||
    path === '/sitemap.xml'
  ) {
    return next();
  }

  // Extract hostname (lowercase, stripped of port)
  const rawHost = req.get('host') || req.hostname || '';
  const hostname = rawHost.split(':')[0].toLowerCase();

  // Allow internal container/local requests (localhost, 127.0.0.1)
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return next();
  }

  // Reject untrusted arbitrary hostnames to prevent open-redirect attacks (CWE-601)
  if (!ALLOWED_PUBLIC_HOSTS.has(hostname)) {
    return res.status(400).send('Bad Request: Invalid Host header');
  }

  // Determine protocol (taking into account X-Forwarded-Proto from trusted edge proxy)
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || req.protocol || 'http';
  const isHttps = protocol === 'https';

  // Check if normalization is required:
  // Requires redirect if protocol is not https, OR if hostname is www
  const isWww = hostname === 'www.sritirumaladryfruits.com';

  if (!isHttps || isWww) {
    // Sanitize path to prevent protocol-relative URL exploits (e.g. //evil.com)
    const rawUrl = req.originalUrl || req.url || '/';
    const cleanPath = '/' + rawUrl.replace(/^\/+/, '');
    const canonicalTarget = `${CANONICAL_PRODUCTION_ORIGIN}${cleanPath}`;

    // Issue permanent 301 redirect in a single hop
    return res.redirect(301, canonicalTarget);
  }

  // Already on canonical HTTPS non-WWW origin
  return next();
}
