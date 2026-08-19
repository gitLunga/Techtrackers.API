/**
 * src/middleware/notFound.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   When no route matches, Express's default is an HTML error page. A caller
 *   who typo'd a URL gets back `<!DOCTYPE html>...` where they expected JSON,
 *   and their `response.json()` throws a confusing parse error instead of
 *   telling them the path was wrong.
 *
 * WHAT IT ACHIEVES
 *   Catches unmatched requests and forwards a proper 404 ApiError, so even
 *   "wrong URL" comes back in the same JSON envelope as everything else.
 *   Registered after all routes, before errorHandler.
 */
import ApiError from '../utils/ApiError.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

export default notFound;
