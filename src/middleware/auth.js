import crypto from 'crypto';
import * as repo from '../repository.js';
// ─── Auth Middleware ─────────────────────────────────────────────────────────
export const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
};
export const requireAdmin = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    if (req.session.role !== 'admin') {
        req.flash('info', '⛔ Access Denied: Admin Only!');
        return res.redirect('/sell');
    }
    next();
};
export const requireShift = (req, res, next) => {
    if (!req.session.user || !req.session.user_id) {
        return res.redirect('/login');
    }
    const shift = repo.getOpenShiftByUserId(req.session.user_id);
    if (!shift) {
        return res.redirect('/shift/open');
    }
    // Make shift available in locals for easy access in views (e.g. sidebar)
    res.locals.currentShift = shift;
    next();
};
// ─── CSRF Middleware (Double-Submit Cookie Pattern) ──────────────────────────
export function generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}
export const csrfProtection = (req, res, next) => {
    // Skip for GET, HEAD, OPTIONS
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        // Generate a CSRF token and set it in session if not there
        if (!req.session.csrfToken) {
            req.session.csrfToken = generateCsrfToken();
        }
        res.locals.csrfToken = req.session.csrfToken;
        return next();
    }
    // For POST/PUT/DELETE — validate token
    const tokenFromBody = req.body._csrf;
    const tokenFromSession = req.session.csrfToken;
    if (!tokenFromBody || !tokenFromSession || tokenFromBody !== tokenFromSession) {
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
    next();
};
