/**
 * src/utils/ApiError.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   In the C# controllers, every method decided its own HTTP result:
 *   `return NotFound(new { message = ... })`, `return BadRequest(...)`,
 *   `return StatusCode(500, ...)`. That is why business rules ("a technician is
 *   already assigned") leaked into controllers — only a controller could return
 *   a 400, so the rule had to live there.
 *
 * WHAT IT ACHIEVES
 *   A service can `throw ApiError.conflict('Technician already assigned')` from
 *   deep inside business logic without importing Express or knowing what HTTP
 *   is. The error middleware turns it into the right status code and body.
 *
 *   `isOperational` separates EXPECTED failures (bad input, missing record —
 *   safe to show the client) from BUGS (undefined is not a function), which
 *   must never leak their message or stack to the client in production.
 */
export class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, message);
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }
  static conflict(message = 'Request conflicts with the current state') {
    return new ApiError(409, message);
  }
  static unprocessable(message = 'Validation failed', details) {
    return new ApiError(422, message, details);
  }
  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, message);
  }
  static internal(message = 'Internal server error') {
    return new ApiError(500, message);
  }
}

export default ApiError;
