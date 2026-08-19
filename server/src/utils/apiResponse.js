/**
 * src/utils/apiResponse.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old API returned a different shape from almost every endpoint: a bare
 *   array, `{ message }`, `{ message, user }`, `Ok("OTP sent to your email.")`
 *   (a raw string). The React client therefore needed bespoke unwrapping per
 *   call, and error handling could not be written once.
 *
 * WHAT IT ACHIEVES
 *   ONE envelope for every response in the system:
 *
 *     success -> { "success": true,  "message": "...", "data": ... }
 *     failure -> { "success": false, "message": "...", "errors": [...] }
 *
 *   The frontend can now write a single `apiClient` that checks `success` once.
 *   `paginated` adds a `meta` block so list endpoints all page identically.
 */
export function ok(res, data = null, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}

export function created(res, data = null, message = 'Created successfully') {
  return ok(res, data, message, 201);
}

export function noContent(res) {
  return res.status(204).send();
}

export function paginated(res, items, { page, limit, total }, message = 'Success') {
  return res.status(200).json({
    success: true,
    message,
    data: items,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
    },
  });
}

export default { ok, created, noContent, paginated };
