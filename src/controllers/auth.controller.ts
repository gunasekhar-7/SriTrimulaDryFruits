import { Request, Response } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { shiftService } from '../services/shift.service.js';
import logger from '../logger.js';
import { metricsAggregator } from '../observability/index.js';

import { auditService } from '../services/audit.service.js';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required').max(50),
  password: z.string().min(1, 'Password is required').max(100),
});

export class AuthController {
  getLogin(req: Request, res: Response) {
    if (req.session.user) return res.redirect('/sell');
    res.render('login', { error: null, csrfToken: res.locals.csrfToken });
  }

  postLogin(req: Request, res: Response, next: import('express').NextFunction) {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      metricsAggregator.recordAuthFailure('staff', 'invalid_input_schema');
      auditService.recordFailedLogin({
        actor: req.body.username || 'unknown',
        source: auditService.extractSource(req, 'STAFF_PORTAL'),
        reason: 'Invalid input schema'
      });
      return res.render('login', { error: 'Invalid credentials.', csrfToken: res.locals.csrfToken });
    }

    const { username, password } = parsed.data;
    const user = authService.authenticate(username, password);

    if (user) {
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = user.username;
        req.session.user_id = user.id;
        req.session.role = user.role;
        req.session.cart = [];
        req.session.held_bills = [];
        logger.info(`Login: ${username} (${user.role})`);
        
        auditService.recordLogin({
          actor: `staff:${user.id} (${user.username}:${user.role})`,
          source: auditService.extractSource(req, 'STAFF_PORTAL'),
          entityId: user.id,
          metadata: { role: user.role }
        });

        req.flash('info', `Welcome back, ${user.username}!`);
        return res.redirect('/sell');
      });
      return;
    }

    logger.warn(`Failed login attempt for username: ${username}`);
    metricsAggregator.recordAuthFailure('staff', 'invalid_credentials');
    auditService.recordFailedLogin({
      actor: username,
      source: auditService.extractSource(req, 'STAFF_PORTAL'),
      reason: 'Invalid username or password'
    });
    return res.render('login', { error: 'Invalid Username or Password', csrfToken: res.locals.csrfToken });
  }

  logout(req: Request, res: Response) {
    const username = req.session.user;
    req.session.destroy(() => {
      if (username) logger.info(`Logout: ${username}`);
      res.redirect('/');
    });
  }

  getShiftOpen(req: Request, res: Response) {
    if (!req.session.user || !req.session.user_id) return res.redirect('/login');
    const shift = shiftService.getOpenShift(req.session.user_id);
    if (shift) return res.redirect('/sell');
    res.render('shift_open', { error: null, csrfToken: res.locals.csrfToken });
  }

  postShiftOpen(req: Request, res: Response) {
    if (!req.session.user || !req.session.user_id) return res.redirect('/login');
    try {
      const openingCash = parseFloat(req.body.opening_cash || '0');
      shiftService.openShift(req.session.user_id, openingCash);
      req.flash('info', 'Shift started successfully.');
      res.redirect('/sell');
    } catch (error: any) {
      res.render('shift_open', { error: error.message, csrfToken: res.locals.csrfToken });
    }
  }

  getShiftClose(req: Request, res: Response) {
    if (!req.session.user || !req.session.user_id) return res.redirect('/login');
    const shift = shiftService.getOpenShift(req.session.user_id);
    if (!shift) return res.redirect('/sell');

    const expectedCash = shiftService.getExpectedClosingCash(shift.id);
    res.render('shift_close', { shift, expectedCash, error: null, csrfToken: res.locals.csrfToken });
  }

  postShiftClose(req: Request, res: Response) {
    if (!req.session.user || !req.session.user_id) return res.redirect('/login');
    const shift = shiftService.getOpenShift(req.session.user_id);
    if (!shift) return res.redirect('/sell');
    
    try {
      const actualCash = parseFloat(req.body.actual_closing_cash || '0');
      shiftService.closeShift(shift.id, actualCash);
      req.session.destroy(() => {
        res.redirect('/');
      });
    } catch (error: any) {
      const expectedCash = shiftService.getExpectedClosingCash(shift.id);
      res.render('shift_close', { shift, expectedCash, error: error.message, csrfToken: res.locals.csrfToken });
    }
  }
}

export const authController = new AuthController();
