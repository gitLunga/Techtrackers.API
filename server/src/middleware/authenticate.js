/**
 * src/middleware/authenticate.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   This is the Node equivalent of ASP.NET's authentication middleware +
 *   [Authorize]. The old project had neither, so identity was whatever the
 *   client claimed: endpoints such as `GET /api/AdminLog/GetAdminLoggedIssues/
 *   admin/{adminId}` took the user id from the URL. Change the number in the
 *   URL and you read someone else's tickets.
 *
 * WHAT IT ACHIEVES
 *   Reads `Authorization: Bearer <token>`, verifies the signature, confirms the
 *   user still exists and is active, and attaches a trusted `req.user`.
 *
 *   From here on, controllers take the caller's identity from `req.user.id`,
 *   NEVER from the URL or body. That single rule closes the whole class of
 *   "pass someone else's id" vulnerabilities the old API had.
 */
import prisma from '../config/prisma.js';
import ApiError from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/tokens.js';
import asyncHandler from '../utils/asyncHandler.js';

function extractToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Missing Authorization: Bearer <token> header');

  const payload = verifyAccessToken(token);

  // Re-read the user on every request. A token stays valid for 15 minutes, but
  // an account deactivated one minute ago must lose access immediately.
  const user = await prisma.user.findUnique({
    where: { id: Number(payload.sub) },
    select: {
      id: true,
      email: true,
      surname: true,
      initials: true,
      isActive: true,
      departmentId: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  });

  if (!user) throw ApiError.unauthorized('The account for this token no longer exists');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

  req.user = {
    id: user.id,
    email: user.email,
    name: `${user.initials} ${user.surname}`.trim(),
    departmentId: user.departmentId,
    roles: user.roles.map((r) => r.role.name),
  };

  next();
});

/**
 * Same as authenticate, but does not fail when no token is present.
 * Used by endpoints that return richer data to signed-in callers.
 */
export const optionalAuthenticate = asyncHandler(async (req, res, next) => {
  if (!extractToken(req)) return next();
  return authenticate(req, res, next);
});

export default authenticate;
