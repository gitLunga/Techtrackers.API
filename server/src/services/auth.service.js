/**
 * src/services/auth.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Replaces UserLogService.Login, OTPService, UserOtpService and AccountController's
 *   inline reset flow. Those had three serious problems:
 *     1. Login compared PLAIN-TEXT passwords in SQL.
 *     2. Login returned a JSON blob and no credential — there was nothing to
 *        send on subsequent requests, so the rest of the API was unprotected.
 *     3. request-otp replied "User not found" for unknown emails, which turns
 *        the endpoint into a free tool for discovering who has an account.
 *
 * WHAT IT ACHIEVES
 *   The complete authentication story in one module: login, refresh, logout,
 *   OTP-based password reset, and self-service password change — each of them
 *   hashing what should be hashed and revealing nothing it should not.
 */
import crypto from 'node:crypto';
import prisma from '../config/prisma.js';
import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';
import env from '../config/env.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signAccessToken, generateRefreshToken, hashToken, ttlToMs } from '../utils/tokens.js';
import * as mailService from './mail.service.js';

function publicUser(user) {
  return {
    id: user.id,
    surname: user.surname,
    initials: user.initials,
    name: `${user.initials} ${user.surname}`.trim(),
    email: user.email,
    phone: user.phone ?? null,
    isActive: user.isActive,
    department: user.department ? { id: user.department.id, name: user.department.name, code: user.department.code } : null,
    roles: user.roles?.map((r) => r.role.name) ?? [],
  };
}

async function issueTokens(user) {
  const roles = user.roles.map((r) => r.role.name);

  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    roles,
    departmentId: user.departmentId,
  });

  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + ttlToMs(env.JWT_REFRESH_TTL)),
    },
  });

  return { accessToken, refreshToken, expiresIn: env.JWT_ACCESS_TTL };
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { department: true, roles: { include: { role: true } } },
  });

  // Deliberately identical response whether the email is unknown or the
  // password is wrong: anything else tells an attacker which emails exist.
  // The dummy hash keeps the timing the same in both branches too.
  const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuvCwWJq7ZFvJ2Nl8y8lnCUL9dOZ9lNPHy';
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordMatches) {
    logger.warn(`Failed login attempt for ${email}`);
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

  const tokens = await issueTokens(user);
  logger.info(`User ${user.email} signed in`);

  return { user: publicUser(user), ...tokens };
}

export async function refresh({ refreshToken }) {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { include: { department: true, roles: { include: { role: true } } } } },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized('Refresh token is invalid or has expired. Please sign in again.');
  }
  if (!stored.user.isActive) throw ApiError.forbidden('This account has been deactivated');

  // Rotation: the used token is revoked and a new one issued. If an old token
  // is ever replayed it will already be revoked, which is how theft is detected.
  const tokens = await issueTokens(stored.user);
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return { user: publicUser(stored.user), ...tokens };
}

export async function logout({ refreshToken, userId }) {
  if (refreshToken) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } else if (userId) {
    // No token supplied: sign out of every device.
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { department: true, roles: { include: { role: true } }, technician: true },
  });
  if (!user) throw ApiError.notFound('User not found');
  return { ...publicUser(user), technicianProfile: user.technician ?? null };
}

/**
 * Step 1 of password reset. ALWAYS reports success, even for an unknown email,
 * so the endpoint cannot be used to enumerate accounts.
 */
export async function requestPasswordOtp({ email }) {
  const normalised = email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalised } });

  if (user && user.isActive) {
    // Six digits, from a cryptographic RNG rather than Random().
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

    // Invalidate any codes still outstanding for this address.
    await prisma.passwordResetOtp.updateMany({
      where: { email: normalised, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await prisma.passwordResetOtp.create({
      data: {
        email: normalised,
        codeHash: hashToken(code),
        expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000),
      },
    });

    await mailService.sendOtpEmail({ to: normalised, code, ttlMinutes: env.OTP_TTL_MINUTES });
    logger.info(`Password reset OTP issued for ${normalised}`);
  } else {
    logger.warn(`Password reset requested for unknown or inactive address ${normalised}`);
  }

  return {
    message: 'If an account exists for that email address, a one-time code has been sent to it.',
  };
}

/** Shared by verify-otp and reset-password so the rules cannot drift apart. */
async function consumeOtp({ email, code, markConsumed }) {
  const normalised = email.toLowerCase();

  const otp = await prisma.passwordResetOtp.findFirst({
    where: { email: normalised, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp) throw ApiError.badRequest('No active one-time code for this email. Request a new one.');
  if (otp.expiresAt < new Date()) throw ApiError.badRequest('That one-time code has expired. Request a new one.');
  if (otp.attempts >= env.OTP_MAX_ATTEMPTS) {
    throw ApiError.tooManyRequests('Too many incorrect attempts. Request a new code.');
  }

  if (otp.codeHash !== hashToken(code)) {
    // Count the failure so a 6-digit code cannot be brute-forced.
    await prisma.passwordResetOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    throw ApiError.badRequest('Incorrect one-time code');
  }

  if (markConsumed) {
    await prisma.passwordResetOtp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
  }

  return otp;
}

/** Step 2 (optional): confirm the code before showing the new-password form. */
export async function verifyOtp({ email, code }) {
  await consumeOtp({ email, code, markConsumed: false });
  return { verified: true, message: 'One-time code accepted. You may now set a new password.' };
}

/** Step 3: set the new password and burn the code. */
export async function resetPassword({ email, code, newPassword }) {
  await consumeOtp({ email, code, markConsumed: true });

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw ApiError.notFound('User not found');

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    }),
    // Changing a password must sign out every existing session.
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  logger.info(`Password reset completed for ${user.email}`);
  return { message: 'Password reset successfully. Please sign in with your new password.' };
}

export async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound('User not found');

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw ApiError.unauthorized('Your current password is incorrect');
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw ApiError.badRequest('The new password must differ from the current one');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return { message: 'Password changed successfully. Please sign in again.' };
}

export { publicUser };
export default {
  login,
  refresh,
  logout,
  getProfile,
  requestPasswordOtp,
  verifyOtp,
  resetPassword,
  changePassword,
};
