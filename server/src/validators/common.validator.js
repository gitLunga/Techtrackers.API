/**
 * src/validators/common.validator.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Shared Zod pieces so that "an id", "a page", "a password" mean exactly the
 *   same thing on every endpoint. Without this, one route accepts `?page=0`
 *   and another rejects it, and the rules drift as the API grows.
 */
import { z } from 'zod';
import { LOG_STATUS, PRIORITIES, ROLES, TECHNICIAN_TYPE, COLLABORATION_STATUS } from '../constants/index.js';

export const id = z.coerce.number().int().positive();

export const idParams = z.object({ id });

export const pagination = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const email = z.string().trim().toLowerCase().email('Must be a valid email address');

/**
 * Password policy in ONE place. The old system had none at all — the reset
 * endpoint accepted an empty string.
 */
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be 128 characters or fewer')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const priority = z.enum(Object.values(PRIORITIES));
export const logStatus = z.enum(Object.values(LOG_STATUS));
export const roleName = z.enum(Object.values(ROLES));
export const technicianType = z.enum(Object.values(TECHNICIAN_TYPE));
export const collaborationStatus = z.enum(Object.values(COLLABORATION_STATUS));

/** Checkbox/query booleans arrive as the STRINGS "true"/"false". */
export const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:MM 24-hour format');

export default { id, idParams, pagination, email, password, priority, logStatus, roleName };
