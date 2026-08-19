/**
 * src/config/logger.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old services were full of `Console.WriteLine(...)` — including inside
 *   catch blocks, where the real exception was printed and then swallowed.
 *   There was no severity, no timestamp, and no way to silence it in tests.
 *
 * WHAT IT ACHIEVES
 *   One tiny logger with levels and timestamps, used everywhere instead of bare
 *   console.log. Because every call site goes through here, swapping in a real
 *   logger later (pino, winston, a hosted log sink) is a one-file change.
 */
import env from './env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const threshold = LEVELS[env.NODE_ENV === 'test' ? 'silent' : env.isProduction ? 'info' : 'debug'];

function emit(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  meta === undefined ? sink(line) : sink(line, meta);
}

export const logger = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
};

export default logger;
