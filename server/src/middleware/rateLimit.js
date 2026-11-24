/**
 * src/middleware/rateLimit.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old /api/Account/request-otp endpoint would generate and EMAIL an OTP
 *   on every call, with no throttle at all. That is both a free password-reset
 *   spam cannon aimed at your users and an uncapped bill on your mail provider.
 *   /login was likewise open to unlimited credential guessing.
 *
 * WHAT IT ACHIEVES
 *   Caps how often a single IP may hit the sensitive endpoints. A generous
 *   global limiter protects the API overall; a tight one guards auth routes.
 */
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';

const message = { success: false, message: 'Too many requests. Please try again later.' };

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.isProduction ? 120 : 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message,
});

/** Login / OTP / password reset: deliberately strict. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.isProduction ? 10 : 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed attempts count toward the limit
  message,
});

export default globalLimiter;
