/**
 * src/validators/misc.validator.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The remaining contracts — reference data (departments, categories, SLAs),
 *   collaboration, feedback, chat, notifications and reports. They are small
 *   enough that one file keeps them findable rather than scattering seven
 *   near-empty modules across the folder.
 */
import { z } from 'zod';
import {
  id, pagination, priority, logStatus, collaborationStatus, booleanish,
} from './common.validator.js';

/* ----------------------------- departments ------------------------------ */
export const createDepartmentSchema = {
  body: z.object({
    name: z.string().trim().min(2).max(100),
    // Optional: derived from the name when omitted. Drives ticket references.
    code: z.string().trim().min(2).max(5).regex(/^[A-Za-z]+$/, 'Code must be letters only').optional(),
  }),
};

export const updateDepartmentSchema = {
  params: z.object({ id }),
  body: z
    .object({
      name: z.string().trim().min(2).max(100).optional(),
      code: z.string().trim().min(2).max(5).regex(/^[A-Za-z]+$/).optional(),
    })
    .refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update' }),
};

/* ------------------------------ categories ------------------------------ */
export const categoryBodySchema = {
  body: z.object({ name: z.string().trim().min(2).max(100) }),
};

export const categoryUpdateSchema = {
  params: z.object({ id }),
  body: z.object({ name: z.string().trim().min(2).max(100) }),
};

/* --------------------------------- SLAs --------------------------------- */
export const upsertSlaSchema = {
  body: z.object({
    priority,
    description: z.string().trim().max(300).optional().default(''),
    responseMinutes: z.coerce.number().int().positive().max(60 * 24 * 30),
    resolutionMinutes: z.coerce.number().int().positive().max(60 * 24 * 90),
  }),
};

/* ----------------------------- collaboration ---------------------------- */
export const createCollaborationSchema = {
  body: z.object({
    logId: id,
    inviteeId: id,
    message: z.string().trim().max(500).optional(),
  }),
};

export const respondCollaborationSchema = {
  params: z.object({ id }),
  body: z.object({
    // Only these two are a valid *response*; CANCELLED goes through its own route.
    status: z.enum(['ACCEPTED', 'DECLINED']),
  }),
};

export const listCollaborationsSchema = {
  query: pagination.extend({
    status: collaborationStatus.optional(),
    direction: z.enum(['incoming', 'outgoing', 'all']).optional().default('all'),
  }),
};

/* -------------------------------- feedback ------------------------------ */
export const createFeedbackSchema = {
  body: z.object({
    logId: id,
    rating: z.coerce.number().int().min(1, 'Rating must be 1-5').max(5, 'Rating must be 1-5'),
    comments: z.string().trim().max(1000).optional(),
  }),
};

/* ---------------------------------- chat -------------------------------- */
export const sendChatSchema = {
  params: z.object({ id }),
  body: z.object({ message: z.string().trim().min(1, 'Message cannot be empty').max(2000) }),
};

/* ----------------------------- notifications ---------------------------- */
export const listNotificationsSchema = {
  query: pagination.extend({ unreadOnly: booleanish.optional() }),
};

/* -------------------------------- reports ------------------------------- */
export const reportRangeSchema = {
  query: z.object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    status: logStatus.optional(),
    priority: priority.optional(),
    months: z.coerce.number().int().min(1).max(36).optional(),
    limit: z.coerce.number().int().min(1).max(5000).optional(),
  }),
};

export default {
  createDepartmentSchema,
  updateDepartmentSchema,
  categoryBodySchema,
  categoryUpdateSchema,
  upsertSlaSchema,
  createCollaborationSchema,
  respondCollaborationSchema,
  listCollaborationsSchema,
  createFeedbackSchema,
  sendChatSchema,
  listNotificationsSchema,
  reportRangeSchema,
};
