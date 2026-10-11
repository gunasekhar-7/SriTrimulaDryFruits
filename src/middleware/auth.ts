import express from 'express';
import crypto from 'crypto';
import * as repo from '../repository.js';
import { metricsAggregator } from '../observability/index.js';
import { resolveSecret } from '../utils/secrets.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const isApiRequest = (req: express.Request): boolean => {
  return Boolean(
    (req.baseUrl && req.baseUrl.startsWith('/api')) ||
    (req.path && req.path.startsWith('/api')) ||
    (req.originalUrl && req.originalUrl.startsWith('/api')) ||
    req.xhr ||
    (req.headers.accept && req.headers.accept.includes('application/json'))
  );
};

export function isValidInternalServiceToken(req: express.Request): boolean {
  const authHeader = req.headers.authorization;
  const customHeader = req.headers['x-service-key'] as string | undefined;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (customHeader) {
    token = customHeader.trim();
  }

  if (!token) return false;

  const expectedKey = resolveSecret('INTERNAL_SERVICE_KEY', 'INTERNAL_SERVICE_KEY_FILE', '') ||
                      resolveSecret('JOB_SERVICE_TOKEN', 'JOB_SERVICE_TOKEN_FILE', '');

  if (!expectedKey || expectedKey.length < 16) {
    return false;
  }

  try {
    const tokenBuffer = Buffer.from(token);
    const expectedBuffer = Buffer.from(expectedKey);
    if (tokenBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

// ─── Auth Middleware ─────────────────────────────────────────────────────────

export const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (isValidInternalServiceToken(req)) {
    return next();
  }
  if (!req.session?.user || !req.session?.user_id) {
    metricsAggregator.recordAuthFailure('staff', 'unauthorized_session');
    if (isApiRequest(req)) {
      return res.status(401).json({
        success: false,
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
      });
    }
    return res.redirect('/login');
  }
  next();
};

export const requireCustomerAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.session?.customer_id) {
    metricsAggregator.recordAuthFailure('customer', 'unauthorized_session');
    if (isApiRequest(req)) {
      return res.status(401).json({
        success: false,
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Customer authentication required' }
      });
    }
    return res.redirect('/customer/login');
  }
  next();
};

export const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (isValidInternalServiceToken(req)) {
    return next();
  }
  if (!req.session?.user) {
    metricsAggregator.recordAuthFailure('admin', 'unauthorized_session');
    if (isApiRequest(req)) {
      return res.status(401).json({
        success: false,
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
      });
    }
    return res.redirect('/login');
  }
  if (req.session.role !== 'admin') {
    metricsAggregator.recordAuthFailure('admin', 'forbidden_role');
    if (isApiRequest(req)) {
      return res.status(403).json({
        success: false,
        data: null,
        error: { code: 'FORBIDDEN', message: 'Administrator privileges required' }
      });
    }
    req.flash('info', '⛔ Access Denied: Admin Only!');
    return res.redirect('/sell');
  }
  next();
};

export const requireShift = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.session?.user || !req.session?.user_id) {
    if (isApiRequest(req)) {
      return res.status(401).json({
        success: false,
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
      });
    }
    return res.redirect('/login');
  }
  const shift = repo.getOpenShiftByUserId(req.session.user_id);
  if (!shift) {
    if (isApiRequest(req)) {
      return res.status(403).json({
        success: false,
        data: null,
        error: { code: 'SHIFT_REQUIRED', message: 'Active cashier shift required' }
      });
    }
    return res.redirect('/shift/open');
  }
  // Make shift available in locals for easy access in views (e.g. sidebar)
  res.locals.currentShift = shift;
  next();
};

// ─── CSRF Middleware (Double-Submit Cookie Pattern) ──────────────────────────

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export const csrfProtection = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // If internal service token is valid, skip browser CSRF checks
  if (isValidInternalServiceToken(req)) {
    return next();
  }

  // Skip for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    // Generate a CSRF token and set it in session if not there
    if (!req.session?.csrfToken) {
      req.session.csrfToken = generateCsrfToken();
    }
    res.locals.csrfToken = req.session.csrfToken;
    res.setHeader('X-CSRF-Token', req.session.csrfToken);
    return next();
  }

  // For POST/PUT/DELETE — validate token
  const tokenFromBody = (req.body?._csrf || req.headers['csrf-token'] || req.headers['x-csrf-token']) as string | undefined;
  const tokenFromSession = req.session?.csrfToken;

  if (!tokenFromBody || !tokenFromSession || tokenFromBody !== tokenFromSession) {
    metricsAggregator.recordAuthFailure('unknown', 'csrf_validation_failed');
    if (isApiRequest(req)) {
      return res.status(403).json({
        success: false,
        data: null,
        error: { code: 'INVALID_CSRF', message: 'Invalid or missing CSRF token' }
      });
    }
    res.status(403).render('error', {
      statusCode: 403,
      title: 'Forbidden',
      message: 'Invalid or missing security token. Please go back and try again.'
    });
    return;
  }

  // Rotate token after successful use
  req.session.csrfToken = generateCsrfToken();
  res.locals.csrfToken = req.session.csrfToken;
  res.setHeader('X-CSRF-Token', req.session.csrfToken);
  next();
};
