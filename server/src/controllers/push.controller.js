/**
 * src/controllers/push.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Thin HTTP adapter over push.service.js. `publicKey` lets the frontend fetch
 *   the VAPID public key at runtime rather than hardcoding it into the bundle.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import env from '../config/env.js';
import * as pushService from '../services/push.service.js';

export const publicKey = asyncHandler(async (_req, res) =>
  ok(res, { publicKey: env.VAPID_PUBLIC_KEY ?? null, enabled: env.pushEnabled }, 'Push public key'));

export const subscribe = asyncHandler(async (req, res) => {
  await pushService.subscribe(req.user.id, req.body);
  return ok(res, null, 'Subscribed to push notifications');
});

export const unsubscribe = asyncHandler(async (req, res) => {
  await pushService.unsubscribe(req.user.id, req.body.endpoint);
  return ok(res, null, 'Unsubscribed from push notifications');
});

export default { publicKey, subscribe, unsubscribe };
