import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import * as repo from '../repository.js';
import { csrfProtection } from '../middleware/auth.js';
import logger from '../logger.js';
const router = express.Router();
// Rate limit login attempts: max 10 per 15 minutes per IP
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many login attempts. Please try again in 15 minutes.',
    standardHeaders: true,
    legacyHeaders: false,
});
const loginSchema = z.object({
    username: z.string().min(1, 'Username is required').max(50),
    password: z.string().min(1, 'Password is required').max(100),
});
// GET /login
router.get('/login', csrfProtection, (req, res) => {
    if (req.session.user)
        return res.redirect('/sell');
    res.render('login', { error: null, csrfToken: res.locals.csrfToken });
});
// POST /login
router.post('/login', loginLimiter, csrfProtection, (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.render('login', { error: 'Invalid credentials.', csrfToken: res.locals.csrfToken });
    }
    const { username, password } = parsed.data;
    const user = repo.getUserByUsername(username);
    if (user && repo.verifyPassword(password, user.password_hash)) {
        req.session.user = user.username;
        req.session.user_id = user.id;
        req.session.role = user.role;
        req.session.cart = [];
        req.session.held_bills = [];
        logger.info(`Login: ${username} (${user.role})`);
        req.flash('info', `Welcome back, ${user.username}!`);
        return res.redirect('/sell');
    }
    logger.warn(`Failed login attempt for username: ${username}`);
    return res.render('login', { error: 'Invalid Username or Password', csrfToken: res.locals.csrfToken });
});
// GET /logout  &  POST /logout
const handleLogout = (req, res) => {
    const username = req.session.user;
    req.session.destroy(() => {
        if (username)
            logger.info(`Logout: ${username}`);
        res.redirect('/');
    });
};
router.get('/logout', handleLogout);
router.post('/logout', handleLogout);
// ─── Shift Management ─────────────────────────────────────────────────────────
router.get('/shift/open', csrfProtection, (req, res) => {
    if (!req.session.user || !req.session.user_id)
        return res.redirect('/login');
    const shift = repo.getOpenShiftByUserId(req.session.user_id);
    if (shift)
        return res.redirect('/sell'); // Already open
    res.render('shift_open', { error: null, csrfToken: res.locals.csrfToken });
});
router.post('/shift/open', csrfProtection, (req, res) => {
    if (!req.session.user || !req.session.user_id)
        return res.redirect('/login');
    try {
        const openingCash = parseFloat(req.body.opening_cash || '0');
        repo.openShift(req.session.user_id, openingCash);
        req.flash('info', 'Shift started successfully.');
        res.redirect('/sell');
    }
    catch (error) {
        res.render('shift_open', { error: error.message, csrfToken: res.locals.csrfToken });
    }
});
router.get('/shift/close', csrfProtection, (req, res) => {
    if (!req.session.user || !req.session.user_id)
        return res.redirect('/login');
    const shift = repo.getOpenShiftByUserId(req.session.user_id);
    if (!shift)
        return res.redirect('/sell'); // No open shift
    const expectedCash = repo.getExpectedClosingCash(shift.id);
    res.render('shift_close', { shift, expectedCash, error: null, csrfToken: res.locals.csrfToken });
});
router.post('/shift/close', csrfProtection, (req, res) => {
    if (!req.session.user || !req.session.user_id)
        return res.redirect('/login');
    const shift = repo.getOpenShiftByUserId(req.session.user_id);
    if (!shift)
        return res.redirect('/sell');
    try {
        const actualCash = parseFloat(req.body.actual_closing_cash || '0');
        repo.closeShift(shift.id, actualCash);
        // Automatically log the user out after closing the shift, or just redirect to login
        req.session.destroy(() => {
            res.redirect('/');
        });
    }
    catch (error) {
        const expectedCash = repo.getExpectedClosingCash(shift.id);
        res.render('shift_close', { shift, expectedCash, error: error.message, csrfToken: res.locals.csrfToken });
    }
});
export default router;
