/**
 * src/utils/pagination.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Every list endpoint in the old API was an unbounded `ToListAsync()` —
 *   GetLogs returned every ticket ever logged, each with its attachment
 *   base64-inlined. That works with 30 rows of test data and falls over in
 *   production.
 *
 * WHAT IT ACHIEVES
 *   Turns `?page=&limit=` query strings into safe Prisma `skip`/`take` values,
 *   with a hard ceiling so a caller cannot request `?limit=1000000`.
 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function getPagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requested = Number.parseInt(query.limit, 10) || DEFAULT_LIMIT;
  const limit = Math.min(Math.max(1, requested), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export default getPagination;
