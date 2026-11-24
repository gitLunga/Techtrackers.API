/**
 * src/validators/auth.validator.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The C# DTOs (RequestOtpDto, VerifyOtpDto, ResetPasswordDto, LoginDto) were
 *   plain classes with nullable string properties and no attributes, so
 *   `{"email": null}` reached the service and failed as a NullReferenceException
 *   -> 500. Here the same request is rejected at the door with a clear 422.
 *
 * WHAT IT ACHIEVES
 *   The auth contract, written down: what each endpoint accepts, and what
 *   "valid" means for it.
 */
import { z } from 'zod';
import { email, password } from './common.validator.js';

export const loginSchema = {
  body: z.object({
    email,
    // Deliberately NOT the full policy: an existing password must be accepted
    // as typed, whatever it is, or nobody could sign in after a policy change.
    password: z.string().min(1, 'Password is required'),
  }),
};

export const refreshSchema = {
  body: z.object({ refreshToken: z.string().min(1, 'refreshToken is required') }),
};

export const logoutSchema = {
  body: z.object({ refreshToken: z.string().optional() }),
};

export const requestOtpSchema = {
  body: z.object({ email }),
};

export const verifyOtpSchema = {
  body: z.object({
    email,
    code: z.string().regex(/^\d{6}$/, 'The one-time code is 6 digits'),
  }),
};

export const resetPasswordSchema = {
  body: z.object({
    email,
    code: z.string().regex(/^\d{6}$/, 'The one-time code is 6 digits'),
    newPassword: password,
  }),
};

export const changePasswordSchema = {
  body: z.object({
    currentPassword: z.string().min(1, 'Your current password is required'),
    newPassword: password,
  }),
};

export default {
  loginSchema,
  refreshSchema,
  logoutSchema,
  requestOtpSchema,
  verifyOtpSchema,
  resetPasswordSchema,
  changePasswordSchema,
};
