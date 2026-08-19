/**
 * src/middleware/validate.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   ASP.NET gave you [Required]/[EmailAddress] attributes plus automatic
 *   ModelState validation from [ApiController]. Express gives you nothing:
 *   `req.body` is whatever JSON the caller posted, including nothing at all.
 *
 *   The old code half-noticed this and hand-rolled checks in controllers:
 *       if (assignDto.LogId <= 0 || assignDto.TechnicianId <= 0) return BadRequest(...)
 *   — repeated per endpoint, easy to forget, and mixing validation with logic.
 *
 * WHAT IT ACHIEVES
 *   Validates body/params/query against a Zod schema BEFORE the controller runs
 *   and REPLACES the raw input with the parsed result. Two consequences:
 *     1. A controller can trust its input absolutely — no defensive checks.
 *     2. Types are already coerced: `req.params.id` is a real number, not "12".
 *   Failures return one consistent 422 listing every bad field at once, instead
 *   of failing on the first.
 */
import { z } from 'zod';
import ApiError from '../utils/ApiError.js';

export const validate = (schemas) => (req, _res, next) => {
  const errors = [];

  for (const source of ['body', 'params', 'query']) {
    const schema = schemas[source];
    if (!schema) continue;

    const result = schema.safeParse(req[source]);
    if (result.success) {
      // `req.query` is a getter-only property in Express 5 and read-only in
      // some setups, so assign defensively rather than reassigning wholesale.
      if (source === 'query') {
        Object.defineProperty(req, 'validatedQuery', { value: result.data, writable: true, configurable: true });
        req.query = result.data;
      } else {
        req[source] = result.data;
      }
    } else {
      for (const issue of result.error.issues) {
        errors.push({
          source,
          field: issue.path.join('.') || source,
          message: issue.message,
        });
      }
    }
  }

  if (errors.length > 0) {
    return next(ApiError.unprocessable('The submitted data failed validation', errors));
  }
  next();
};

/** Reusable building blocks so every route spells ids and paging the same way. */
export const idParam = (name = 'id') =>
  z.object({ [name]: z.coerce.number().int().positive(`${name} must be a positive integer`) });

export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export default validate;
