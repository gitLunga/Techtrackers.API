/**
 * src/utils/asyncHandler.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Express 4 does not catch rejected promises. If an `async` route handler
 *   throws, Express never sees it: the request hangs until the client times
 *   out, and Node prints an unhandled rejection warning. That is precisely why
 *   the C# controllers were wrapped in giant try/catch blocks — and why every
 *   one of them repeated the same "log it, return 500" boilerplate.
 *
 * WHAT IT ACHIEVES
 *   Wraps a handler so any thrown/rejected error is forwarded to `next(err)`
 *   and lands in the central error middleware. Controllers become try/catch
 *   free and read as pure intent.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
