/**
 * src/jobs/slaMonitor.job.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   This is the Node replacement for `builder.Services.AddHostedService<SLAMonitoringService>()`.
 *   Node has no built-in hosted-service concept, so the scheduling has to be
 *   explicit — and keeping it in its own file means the SCHEDULE is separate
 *   from the RULES (escalation.service.js). You can run the rules in a test or
 *   from an admin endpoint without a timer, and change the interval without
 *   touching business logic.
 *
 * WHAT IT ACHIEVES
 *   - Runs the escalation sweep every SLA_JOB_INTERVAL_MS (default 60s).
 *   - `isRunning` prevents overlapping passes: if a sweep takes longer than the
 *     interval, the next tick is skipped rather than piling up concurrent
 *     sweeps that fight over the same rows.
 *   - `unref()` keeps the timer from holding the process open during shutdown.
 *   - The whole job can be disabled with SLA_JOB_ENABLED=false, which is what
 *     you want in tests and when running several API instances (only one should
 *     own the sweep).
 */
import env from '../config/env.js';
import logger from '../config/logger.js';
import { runEscalationSweep } from '../services/escalation.service.js';

let timer = null;
let isRunning = false;

async function tick() {
  if (isRunning) {
    logger.warn('SLA sweep still running from the previous tick; skipping this one');
    return;
  }
  isRunning = true;
  try {
    await runEscalationSweep(new Date());
  } catch (error) {
    // Never let a failed sweep kill the timer — the old BackgroundService loop
    // would exit permanently on an unhandled exception.
    logger.error(`SLA monitor sweep failed: ${error.message}`, { stack: error.stack });
  } finally {
    isRunning = false;
  }
}

export function startSlaMonitor() {
  if (!env.SLA_JOB_ENABLED) {
    logger.info('SLA monitor disabled (SLA_JOB_ENABLED=false)');
    return null;
  }
  if (timer) return timer;

  logger.info(`SLA monitor started; sweeping every ${env.SLA_JOB_INTERVAL_MS / 1000}s`);
  timer = setInterval(tick, env.SLA_JOB_INTERVAL_MS);
  timer.unref();

  // One sweep shortly after boot so a restart does not leave breaches unnoticed
  // until the first full interval has elapsed.
  setTimeout(tick, 5_000).unref();

  return timer;
}

export function stopSlaMonitor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('SLA monitor stopped');
  }
}

export default { startSlaMonitor, stopSlaMonitor };
