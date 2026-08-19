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
    location: z.string().trim().max(200).optional(),
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
