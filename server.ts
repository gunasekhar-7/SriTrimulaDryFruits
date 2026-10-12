import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import flash from 'connect-flash';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// ─── Routes ──────────────────────────────────────────────────────────────────
import authRoutes from './src/routes/auth.js';
import billingRoutes from './src/routes/billing.js';
import stockRoutes from './src/routes/stock.js';
import adminRoutes from './src/routes/admin.js';
import pdfRoutes from './src/routes/pdf.js';
import storeRoutes from './src/routes/store.js';
import customerRoutes from './src/routes/customer.js';
import cartRoutes from './src/routes/cart.js';
import rateLimit from 'express-rate-limit';

// ─── Middleware & Database ───────────────────────────────────────────────────
import { requireAuth, csrfProtection } from './src/middleware/auth.js';
import { getProducts } from './src/repository.js';
import { closeDatabase } from './src/database.js';
import logger from './src/logger.js';
import { seoService } from './src/services/seo.service.js';
import { productService } from './src/services/product.service.js';
import { validateProductionSiteConfig } from './src/config/site.js';
import { canonicalRedirectMiddleware } from './src/middleware/canonical-redirect.js';

// ─── Session Store (SQLite) ───────────────────────────────────────────────────
import connectSqlite3 from 'connect-sqlite3';
const SQLiteStore = connectSqlite3(session);

declare module 'express-session' {
  interface SessionData {
    user?: string;
    user_id?: number;
    customer_id?: number;
    role?: string;
    cart?: any[];
    held_bills?: any[];
    csrfToken?: string;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Ensure data/logs directories exist ──────────────────────────────────────
const dataDir = path.join(process.cwd(), 'data');
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

export const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Secure Secret Injection (Docker Secrets / Secret Files / Env) ───────────
import { resolveSecret } from './src/utils/secrets.js';

const SESSION_SECRET = resolveSecret('SESSION_SECRET', 'SESSION_SECRET_FILE', 'dev_fallback_secret_change_this');
const COOKIE_SECRET = resolveSecret('COOKIE_SECRET', 'COOKIE_SECRET_FILE', 'dev_cookie_secret_change_this');

// ─── Security Headers (Helmet) ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'fonts.googleapis.com', 'cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:', '*'],
      connectSrc: ["'self'"],
    },
  },
}));

// ─── Health Probes & Observability ───────────────────────────────────────────
import { observabilityMiddleware } from './src/observability/middleware.js';
import { observabilityController } from './src/controllers/observability.controller.js';
import { observabilityRouter } from './src/routes/observability.js';

app.use(observabilityMiddleware);
app.get('/health', (req, res) => res.status(200).json({ status: 'UP' }));
app.get('/ready', (req, res) => res.status(200).json({ status: 'READY' }));
app.get('/metrics', observabilityController.getMetricsPrometheus.bind(observabilityController));
app.use('/api/v1/observability', observabilityRouter);

// ─── Single-Hop Canonical Origin & HTTPS / WWW Normalization ─────────────────
app.use(canonicalRedirectMiddleware);

// ─── HTTP Access Logging & Tracing ──────────────────────────────────────────
app.use((req, res, next) => {
  if (req.url === '/health' || req.url === '/ready' || req.url === '/metrics') return next();
  const requestId = (res.locals.requestId as string) || (req.headers['x-request-id'] as string) || crypto.randomUUID();
  res.locals.requestId = requestId;
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      event: 'http.request',
      operation: `${req.method} ${req.path}`,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
      requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
  });
  next();
});

// ─── View Engine ──────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

// ─── Core Middleware ──────────────────────────────────────────────────────────
app.use(express.static(path.join(process.cwd(), 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true,
  setHeaders: (res) => {
    if (process.env.NODE_ENV !== 'production') {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({
  verify: (req, res, buf) => {
    (req as any).rawBody = buf;
  }
}));
app.use(cookieParser(COOKIE_SECRET));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dataDir }) as any,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));
app.use(flash());

// ─── Patch res.redirect for SQLite Session Race Condition ─────────────────────
app.use((req, res, next) => {
  const originalRedirect = res.redirect.bind(res);
  res.redirect = function (...args: any[]) {
    if (req.session) {
      // @ts-ignore
      req.session.save(() => originalRedirect(...args));
    } else {
      // @ts-ignore
      originalRedirect(...args);
    }
  } as any;
  next();
});

// ─── Global Rate Limiter ──────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000,
  message: 'Too many requests from this IP, please try again after an hour',
  skip: (req) => {
    return !!(req.session && req.session.user);
  }
});
app.use(globalLimiter);

// ─── Global Locals ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.messages = req.flash('info');
  res.locals.siteUrl = seoService.getSiteUrl(req);
  res.locals.currentPath = req.path;
  try {
    const products = getProducts();
    res.locals.lowStockCount = products.filter(p => (p.total_qty - (p.sold_qty || 0)) < 5).length;
    res.locals.storefrontCategories = productService.getStorefrontCategories();
  } catch {
    res.locals.lowStockCount = 0;
    res.locals.storefrontCategories = [];
  }
  next();
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ─── Public Home ──────────────────────────────────────────────────────────────
app.get('/', csrfProtection, (req, res) => {
  const allProducts = getProducts();
  const shuffled = [...allProducts].sort(() => 0.5 - Math.random());
  const selectedProducts = shuffled.slice(0, 12);
  const siteUrl = seoService.getSiteUrl(req);
  const seo = seoService.buildHomeSeo(siteUrl);
  res.render('home', { products: selectedProducts, ...seo, siteUrl, activeCategory: 'All' });
});

import accountRoutes from './src/routes/account.js';

import { apiV1Router } from './src/routes/api.js';

// ─── Route Modules ────────────────────────────────────────────────────────────
app.use('/', authRoutes);
app.use('/', billingRoutes);
app.use('/', stockRoutes);
app.use('/', adminRoutes);
app.use('/', pdfRoutes);
app.use('/', storeRoutes);
app.use('/customer', customerRoutes);
app.use('/account', accountRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/v1', apiV1Router);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', {
    statusCode: 404,
    title: 'Page Not Found',
    message: `The page "${req.path}" does not exist.`
  });
});

// ─── 500 / Global Error Handler ──────────────────────────────────────────────
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack, path: req.path });
  res.status(500).render('error', {
    statusCode: 500,
    title: 'Server Error',
    message: process.env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again later.'
      : err.message
  });
});

import { initBackupCron } from './src/backup.js';
import { queueService } from './src/queue/index.js';
import { reservationReaperService } from './src/services/reservation-reaper.service.js';

if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
  if (process.env.NODE_ENV === 'production') {
    try {
      validateProductionSiteConfig();
    } catch (err: any) {
      console.error(`🚨 FATAL: Invalid production canonical configuration: ${err.message}`);
      process.exit(1);
    }

    const insecureSecrets = [
      'change_this_to_a_long_random_secret_string_in_production',
      'dev_fallback_secret_change_this',
      'change_this_to_another_long_random_secret_string'
    ];
    if (insecureSecrets.includes(SESSION_SECRET) || insecureSecrets.includes(COOKIE_SECRET)) {
      console.error('🚨 FATAL: Insecure default SESSION_SECRET or COOKIE_SECRET detected in production!');
      process.exit(1);
    }
  }

  // Initialize automated database backup schedules
  initBackupCron();

  // Start durable background job worker
  queueService.startWorker();

  // Start inventory reservation reaper scheduler
  reservationReaperService.start();

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`, { event: 'server.started', port: PORT });
    console.log(`✅ Server running: http://localhost:${PORT}`);
  });
  
  // ─── Graceful Shutdown ────────────────────────────────────────────────────────
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`, { event: 'server.shutdown_initiated', signal });
    reservationReaperService.stop();
    queueService.stopWorker();
    server.close(() => {
      try {
        closeDatabase();
        logger.info('Database closed and WAL checkpointed cleanly.', { event: 'db.shutdown_complete' });
      } catch (dbErr) {
        logger.error('Error during database shutdown checkpoint', { error: dbErr });
      }
      logger.info('HTTP server closed.', { event: 'server.shutdown_complete' });
      process.exit(0);
    });
    
    // Force close after 10 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down', { event: 'server.shutdown_forceful' });
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
