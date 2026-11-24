/**
 * src/utils/tokens.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old API had NO authentication. Program.cs called `app.UseAuthorization()`
 *   without ever registering an authentication scheme, and no controller carried
 *   an [Authorize] attribute. Login returned a plain JSON object and the client
 *   simply "remembered" the role — meaning ANY caller could hit
 *   /api/AdminLog/GetLogs or assign technicians by guessing the URL.
 *
 * WHAT IT ACHIEVES
 *   Issues and verifies signed JWTs, and hashes refresh tokens before storage.
 *
 *   Two-token design:
 *     - ACCESS token  (15 min, sent on every request) keeps the blast radius of
 *       a leaked token small.
 *     - REFRESH token (7 days, stored hashed in the DB) lets a user stay signed
 *       in, and can be REVOKED — impossible with a stateless access token alone.
 *   Refresh tokens are hashed with SHA-256 for the same reason passwords are
 *   hashed: the tokens table must not be a set of working credentials.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import ApiError from './ApiError.js';

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      roles: user.roles,
      departmentId: user.departmentId,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_TTL, issuer: 'techtrackers' },
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'techtrackers' });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Access token has expired');
    }
    throw ApiError.unauthorized('Invalid access token');
  }
}

/** Opaque random string — refresh tokens carry no claims, they are just a key. */
export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

/** One-way hash so a leaked refresh_tokens table cannot be replayed. */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** "7d" / "15m" / "30s" -> milliseconds, for computing DB expiry timestamps. */
export function ttlToMs(ttl) {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(match[1]) * multipliers[match[2]];
}

export default { signAccessToken, verifyAccessToken, generateRefreshToken, hashToken, ttlToMs };
