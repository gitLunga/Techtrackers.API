/**
 * src/middleware/errorHandler.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Every C# controller carried its own try/catch that logged the exception and
 *   returned `StatusCode(500, new { message = "...", details = ex.Message })`.
 *   Same 12 lines, 20 times over — and `details = ex.Message` leaked internal
 *   detail (table names, connection strings in some EF errors) to the client.
 *
 * WHAT IT ACHIEVES
 *   ONE place that turns any thrown error into an HTTP response. Registered
 *   LAST in app.js, so anything `next(err)`-ed from any layer arrives here.
 *
 *   It also translates Prisma's driver-level error codes into the right HTTP
 *   semantics — P2002 (unique violation) is a 409, not a 500 — so services can
 *   simply attempt the write instead of pre-checking with a SELECT and racing.
 *
 *   Crucially: unknown (non-operational) errors log their full stack SERVER-SIDE
 *   but return a generic message to the client in production.
 */
import { Prisma } from '@prisma/client';
import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';
import env from '../config/env.js';

/**
 * body-parser raises a SyntaxError with `type: 'entity.parse.failed'` when the
 * request body is not valid JSON. Left untranslated that surfaces as a 500,
 * blaming the server for what is squarely a malformed client request.
 */
function translateBodyParserError(error) {
  if (error?.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON');
  }
  if (error?.type === 'entity.too.large') {
    return ApiError.badRequest('Request body is too large');
  }
  return null;
}

function translatePrismaError(error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const fields = error.meta?.target;
        const label = Array.isArray(fields) ? fields.join(', ') : 'field';
        return ApiError.conflict(`A record with this ${label} already exists`);
      }
      case 'P2003':
        return ApiError.badRequest('Referenced record does not exist (foreign key constraint)');
      case 'P2025':
        return ApiError.notFound(error.meta?.cause ?? 'Record not found');
      default:
        return null;
    }
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return ApiError.badRequest('Malformed database query');
  }
  return null;
}

// Express identifies error middleware by its FOUR arguments. `next` must stay
// in the signature even though it is unused, or Express treats this as a
// normal handler and errors sail past it.
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, _next) {
  let apiError =
    error instanceof ApiError
      ? error
      : translateBodyParserError(error) ?? translatePrismaError(error);

  if (!apiError) {
    // Genuinely unexpected: a bug. Log everything, reveal nothing.
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, {
      message: error.message,
      stack: error.stack,
    });
    apiError = ApiError.internal(
      env.isProduction ? 'Internal server error' : error.message,
    );
    apiError.isOperational = false;
  }

  if (apiError.statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${apiError.statusCode}`, {
      message: apiError.message,
    });
  } else {
    logger.warn(`${req.method} ${req.originalUrl} -> ${apiError.statusCode}: ${apiError.message}`);
  }

  const body = {
    success: false,
    message: apiError.message,
  };
  if (apiError.details) body.errors = apiError.details;
  if (!env.isProduction && !apiError.isOperational) body.stack = error.stack;

  res.status(apiError.statusCode).json(body);
}

export default errorHandler;
