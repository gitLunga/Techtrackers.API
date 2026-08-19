/**
 * src/controllers/auth.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   A controller is the HTTP ADAPTER, and nothing else. Its whole job is:
 *     read the request -> call one service function -> shape the response.
 *
 *   The old AccountController and UserController did far more: UserController's
 *   Login held a five-branch if/else on role names, and AccountController
 *   orchestrated three services and decided OTP policy inline. That logic could
 *   not be reused or tested without spinning up HTTP.
 *
 * WHAT IT ACHIEVES
 *   Every handler here is a few lines. If you ever find yourself writing an
 *   `if` about business rules in a controller, it belongs in a service — that
 *   is the line this layer draws.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import * as authService from '../services/auth.service.js';

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  return ok(res, result, 'Signed in successfully');
});

export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body);
  return ok(res, result, 'Token refreshed');
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout({ refreshToken: req.body.refreshToken, userId: req.user?.id });
  return ok(res, null, 'Signed out successfully');
});

// The caller's id comes from the verified token, never from the URL.
export const me = asyncHandler(async (req, res) => {
  const profile = await authService.getProfile(req.user.id);
  return ok(res, profile, 'Profile retrieved');
});

export const requestOtp = asyncHandler(async (req, res) => {
  const result = await authService.requestPasswordOtp(req.body);
  return ok(res, null, result.message);
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const result = await authService.verifyOtp(req.body);
  return ok(res, { verified: result.verified }, result.message);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(req.body);
  return ok(res, null, result.message);
});

export const changePassword = asyncHandler(async (req, res) => {
  const result = await authService.changePassword({ userId: req.user.id, ...req.body });
  return ok(res, null, result.message);
});

export default { login, refresh, logout, me, requestOtp, verifyOtp, resetPassword, changePassword };
