import express from 'express';
import { jobController } from '../controllers/job.controller.js';
import { requireAuth, requireAdmin, csrfProtection } from '../middleware/auth.js';

const router = express.Router();

// ─── Defense in Depth: Deny-by-default for all Job Management routes ─────────
// Every route requires authenticated administrator or authorized internal service identity,
// and enforces CSRF protection across session clients.
router.use(requireAuth, requireAdmin, csrfProtection);

// ─── Query / Read Operations ─────────────────────────────────────────────────
router.get('/stats', jobController.getStats.bind(jobController));
router.get('/', jobController.getJobs.bind(jobController));
router.get('/:id', jobController.getJobById.bind(jobController));

// ─── State-Changing Operations ───────────────────────────────────────────────
router.post('/:id/retry', jobController.retryJob.bind(jobController));
router.post('/:id/cancel', jobController.cancelJob.bind(jobController));

export default router;
