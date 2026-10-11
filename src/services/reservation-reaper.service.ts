import db from '../database.js';
import logger from '../logger.js';
import { metricsAggregator } from '../observability/index.js';

export interface ReaperRunResult {
  released: number;
  skipped: number;
  failed: number;
  durationMs: number;
  lockedOut?: boolean;
}

export class ReservationReaperService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;

  get intervalMs(): number {
    const raw = process.env.RESERVATION_REAPER_INTERVAL_MS;
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 1000) {
        return parsed;
      }
    }
    // Default: 5 minutes (300,000 ms)
    return 5 * 60 * 1000;
  }

  get batchSize(): number {
    const raw = process.env.RESERVATION_REAPER_BATCH_SIZE;
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return Math.min(parsed, 1000);
      }
    }
    return 100;
  }

  get isEnabled(): boolean {
    return process.env.ENABLE_RESERVATION_REAPER !== 'false';
  }

  /**
   * Identifies whether this process is the designated cluster leader for cron/background scheduling.
   * In PM2 cluster mode, instance '0' is the leader. In non-clustered / single-container Docker, it is true.
   */
  isLeader(): boolean {
    const instance = process.env.NODE_APP_INSTANCE;
    return instance === undefined || instance === '0';
  }

  /**
   * Attempts to acquire an atomic database-level lock for the reaper job.
   * Prevents concurrent execution across multiple worker processes or containers.
   */
  acquireLock(lockedBy: string, ttlSeconds = 60): boolean {
    try {
      const now = new Date().toISOString();
      const lockUntil = new Date(Date.now() + ttlSeconds * 1000).toISOString();

      const result = db.prepare(`
        INSERT INTO scheduler_locks (job_name, locked_by, locked_until)
        VALUES ('reservation_reaper', ?, ?)
        ON CONFLICT(job_name) DO UPDATE 
        SET locked_by = excluded.locked_by,
            locked_until = excluded.locked_until,
            last_run_at = CURRENT_TIMESTAMP
        WHERE locked_until <= ?
      `).run(lockedBy, lockUntil, now);

      return result.changes > 0;
    } catch (err: any) {
      logger.warn(`[ReservationReaper] Failed to evaluate scheduler lock: ${err.message}`);
      return false;
    }
  }

  /**
   * Releases the database-level lock for the reaper job.
   */
  releaseLock(lockedBy: string): void {
    try {
      db.prepare(`
        UPDATE scheduler_locks 
        SET locked_until = datetime('now') 
        WHERE job_name = 'reservation_reaper' AND locked_by = ?
      `).run(lockedBy);
    } catch (err: any) {
      logger.warn(`[ReservationReaper] Error releasing lock: ${err.message}`);
    }
  }

  /**
   * Executes a single sweep to identify and release expired reservations.
   * Completely idempotent and transactional.
   */
  executeReap(options?: { now?: Date; batchSize?: number; bypassLock?: boolean }): ReaperRunResult {
    const startHr = process.hrtime();
    const lockedBy = `pid_${process.pid}_${Date.now()}`;
    const bypassLock = options?.bypassLock ?? false;
    let lockAcquired = false;

    let releasedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    try {
      if (!bypassLock) {
        lockAcquired = this.acquireLock(lockedBy, 60);
        if (!lockAcquired) {
          logger.debug('[ReservationReaper] Another runner currently holds the reaper lock. Skipping cycle.');
          return {
            released: 0,
            skipped: 0,
            failed: 0,
            durationMs: 0,
            lockedOut: true
          };
        }
      }

      const currentTime = (options?.now || new Date()).toISOString();
      const limit = options?.batchSize || this.batchSize;

      // Identify candidate reservations that have genuinely expired
      const candidates = db.prepare(`
        SELECT sr.id, sr.order_id, sr.cart_id, sr.product_variant_id, sr.quantity, sr.status, sr.expires_at,
               oo.status AS order_status
        FROM stock_reservations sr
        LEFT JOIN online_orders oo ON sr.order_id = oo.id
        WHERE sr.status = 'ACTIVE' 
          AND sr.expires_at < ?
        ORDER BY sr.id ASC
        LIMIT ?
      `).all(currentTime, limit) as any[];

      for (const res of candidates) {
        // Protect orders that have already been confirmed or completed
        if (res.order_id && ['CONFIRMED', 'PACKING', 'READY', 'DISPATCHED', 'COMPLETED'].includes(res.order_status)) {
          skippedCount++;
          continue;
        }

        try {
          // Transactionally release reservation, adjust inventory, and log stock movement
          const releaseTransaction = db.transaction(() => {
            // 1. Conditionally transition reservation status (atomic concurrency shield)
            const updateResult = db.prepare(`
              UPDATE stock_reservations 
              SET status = 'RELEASED' 
              WHERE id = ? AND status = 'ACTIVE'
            `).run(res.id);

            // If another process or order confirmation transitioned this row, abort immediately
            if (updateResult.changes === 0) {
              return false;
            }

            // 2. Decrement reserved_qty on product_variants safely
            db.prepare(`
              UPDATE product_variants 
              SET reserved_qty = MAX(0, reserved_qty - ?) 
              WHERE id = ?
            `).run(res.quantity, res.product_variant_id);

            // 3. Record stock movement
            const refType = res.order_id ? 'OnlineOrder' : (res.cart_id ? 'CustomerCart' : 'System');
            const refId = res.order_id ? String(res.order_id) : (res.cart_id ? String(res.cart_id) : null);

            db.prepare(`
              INSERT INTO stock_movements 
                (product_variant_id, quantity_delta, movement_type, reference_type, reference_id, actor, notes)
              VALUES (?, ?, 'RESERVATION_RELEASE', ?, ?, 'System (Reservation Expired)', 'Expired reservation automatically released')
            `).run(res.product_variant_id, res.quantity, refType, refId);

            // 4. Cancel unconfirmed online order if attached
            if (res.order_id && res.order_status === 'NEW') {
              const orderUpdate = db.prepare(`
                UPDATE online_orders 
                SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP 
                WHERE id = ? AND status = 'NEW'
              `).run(res.order_id);

              if (orderUpdate.changes > 0) {
                db.prepare(`
                  INSERT INTO order_status_logs 
                    (order_id, previous_status, new_status, changed_by) 
                  VALUES (?, 'NEW', 'CANCELLED', 'System (Reservation Expired)')
                `).run(res.order_id);

                metricsAggregator.recordOrderCancellation('online', 'System (Reservation Expired)');
              }
            }

            return true;
          });

          const succeeded = releaseTransaction();
          if (succeeded) {
            releasedCount++;
            logger.info('Inventory reservation released (expired)', {
              event: 'inventory.reservation_expired',
              reservationId: res.id,
              variantId: res.product_variant_id,
              quantity: res.quantity,
              orderId: res.order_id
            });
          } else {
            skippedCount++;
          }
        } catch (itemErr: any) {
          failedCount++;
          logger.error(`[ReservationReaper] Error releasing reservation #${res.id}: ${itemErr.message}`, {
            reservationId: res.id,
            error: itemErr
          });
        }
      }

      const diff = process.hrtime(startHr);
      const durationSeconds = diff[0] + diff[1] / 1e9;
      metricsAggregator.recordBackgroundJobRun('reservation_cleanup', durationSeconds, true);

      if (releasedCount > 0 || failedCount > 0) {
        logger.info(`[ReservationReaper] Completed sweep: ${releasedCount} released, ${skippedCount} skipped, ${failedCount} failed in ${(durationSeconds * 1000).toFixed(1)}ms`);
      }

      return {
        released: releasedCount,
        skipped: skippedCount,
        failed: failedCount,
        durationMs: Math.round(durationSeconds * 1000)
      };
    } catch (err: any) {
      const diff = process.hrtime(startHr);
      const durationSeconds = diff[0] + diff[1] / 1e9;
      metricsAggregator.recordBackgroundJobRun('reservation_cleanup', durationSeconds, false, err.message);
      logger.error(`[ReservationReaper] Sweep execution failed: ${err.message}`, { error: err });

      return {
        released: releasedCount,
        skipped: skippedCount,
        failed: failedCount + 1,
        durationMs: Math.round(durationSeconds * 1000)
      };
    } finally {
      if (lockAcquired) {
        this.releaseLock(lockedBy);
      }
    }
  }

  /**
   * Starts the background scheduler for inventory reservation expiry.
   */
  start(): void {
    if (this.isRunning) return;

    if (!this.isEnabled) {
      logger.info('[ReservationReaper] Reservation reaper is disabled by configuration (ENABLE_RESERVATION_REAPER=false).');
      return;
    }

    if (!this.isLeader()) {
      logger.info(`[ReservationReaper] Secondary process instance (${process.env.NODE_APP_INSTANCE}) skipping reaper scheduler.`);
      return;
    }

    this.isRunning = true;
    const interval = this.intervalMs;
    logger.info(`[ReservationReaper] Started reservation reaper scheduler (interval: ${interval}ms / ${(interval / 60000).toFixed(1)} mins).`);

    const runCycle = async () => {
      if (!this.isRunning || this.isProcessing) return;
      this.isProcessing = true;

      try {
        this.executeReap();
      } catch (err: any) {
        logger.error(`[ReservationReaper] Unexpected error during scheduled tick: ${err.message}`);
      } finally {
        this.isProcessing = false;
        if (this.isRunning) {
          this.timer = setTimeout(runCycle, this.intervalMs);
        }
      }
    };

    // First cycle runs after the configured interval
    this.timer = setTimeout(runCycle, interval);
  }

  /**
   * Stops the background scheduler cleanly.
   */
  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('[ReservationReaper] Reservation reaper scheduler stopped.');
  }

  isSchedulerRunning(): boolean {
    return this.isRunning;
  }
}

export const reservationReaperService = new ReservationReaperService();
