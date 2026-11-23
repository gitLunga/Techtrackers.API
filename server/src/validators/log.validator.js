/**
 * src/validators/log.validator.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old LogDto let a caller set fields they had no business setting —
 *   `LogStatus` and `Staff_ID` were both on the create DTO, so a request could
 *   claim to be someone else and open a ticket already marked RESOLVED. (The
 *   service overwrote LogStatus, but nothing stopped Staff_ID.)
 *
 * WHAT IT ACHIEVES
 *   The create schema accepts ONLY what a reporter legitimately supplies. The
 *   reporter's identity comes from the JWT and the status is always PENDING.
 *   Fields the client must not control simply do not exist in the contract.
 */
import { z } from 'zod';
import { id, pagination, priority, logStatus, booleanish } from './common.validator.js';

export const createLogSchema = {
  body: z.object({
    title: z.string().trim().min(5, 'Title must be at least 5 characters').max(200),
    description: z.string().trim().min(10, 'Description must be at least 10 characters').max(5000),
    categoryId: id,
    priority: priority.default('MEDIUM'),
    // Free-text note ("HR office, 2nd floor"). Coordinates below are captured
    // automatically when the browser allows it.
    location: z.string().trim().max(200).optional(),
    /**
     * OPTIONAL, deliberately.
     *
     * These were briefly required, which made logging a ticket impossible
     * whenever location capture failed — and it fails often:
     *   - `navigator.geolocation` only works on a secure context, so over
     *     plain http:// on a LAN it fails for EVERY user;
     *   - a denied permission, a locked-down lab machine, or a desktop with
     *     no GPS all produce nothing;
     *   - the person whose machine is broken is the least likely to get a
     *     clean fix.
     *
     * Blocking fault reporting on a best-effort signal is the wrong trade for
     * a service desk. Capture it when it is there; never depend on it.
     */
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    /** Metres of uncertainty the browser reported, so a bad fix is visible. */
    locationAccuracy: z.coerce.number().min(0).max(100000).optional(),
    // Which piece of hardware this is about, if known (e.g. via QR scan).
    assetId: id.optional(),
  }),
};

export const listLogsSchema = {
  query: pagination.extend({
    status: logStatus.optional(),
    priority: priority.optional(),
    categoryId: id.optional(),
    departmentId: id.optional(),
    technicianId: id.optional(),
    open: booleanish.optional(),
    overdue: booleanish.optional(),
    search: z.string().trim().min(1).max(100).optional(),
    sort: z.enum(['newest', 'oldest']).optional(),
  }),
};

export const changeStatusSchema = {
  params: z.object({ id }),
  body: z.object({
    status: logStatus,
    // Required for ON_HOLD; the rule is enforced in the service so it holds no
    // matter which path reaches it.
    note: z.string().trim().max(1000).optional(),
  }),
};

export const assignSchema = {
  params: z.object({ id }),
  body: z.object({
    technicianId: id,
    reassign: booleanish.optional().default(false),
  }),
};

export const reopenSchema = {
  params: z.object({ id }),
  body: z.object({ note: z.string().trim().max(1000).optional() }),
};

export const escalateSchema = {
  params: z.object({ id }),
  body: z.object({
    level: z.coerce.number().int().min(1).max(3),
    reason: z.string().trim().min(5, 'Please give a reason for the escalation').max(500),
  }),
};

export const attachmentParamsSchema = {
  params: z.object({ id, attachmentId: id }),
};

export default {
  createLogSchema,
  listLogsSchema,
  changeStatusSchema,
  assignSchema,
  reopenSchema,
  escalateSchema,
  attachmentParamsSchema,
};
