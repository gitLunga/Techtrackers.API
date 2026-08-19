/**
 * src/validators/user.validator.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   TechnicianDto in the old code was one flat class carrying user fields,
 *   credentials, availability AND two unexplained counters (ActiveTasks,
 *   NoOfTask) that nothing ever read. It was reused for create and update, so
 *   neither operation could state what it actually required.
 *
 * WHAT IT ACHIEVES
 *   Separate create and update contracts, with the technician profile nested
 *   where it belongs rather than flattened into the user.
 */
import { z } from 'zod';
import {
  id, pagination, email, password, roleName, technicianType, timeOfDay, booleanish,
} from './common.validator.js';

const technicianProfile = z.object({
  specialization: z.string().trim().max(120).optional(),
  contacts: z.string().trim().max(60).optional(),
  availableFrom: timeOfDay.optional(),
  availableTo: timeOfDay.optional(),
  type: technicianType.optional(),
  location: z.string().trim().max(200).optional(),
});

export const createUserSchema = {
  body: z.object({
    surname: z.string().trim().min(2).max(80),
    initials: z.string().trim().max(10).optional(),
    email,
    password,
    phone: z.string().trim().max(30).optional(),
    departmentId: id,
    roles: z.array(roleName).min(1, 'At least one role is required'),
    technicianProfile: technicianProfile.optional(),
  }),
};

export const listUsersSchema = {
  query: pagination.extend({
    role: roleName.optional(),
    departmentId: id.optional(),
    isActive: booleanish.optional(),
    search: z.string().trim().min(1).max(100).optional(),
  }),
};

export const updateUserSchema = {
  params: z.object({ id }),
  body: z
    .object({
      surname: z.string().trim().min(2).max(80).optional(),
      initials: z.string().trim().max(10).optional(),
      email: email.optional(),
      phone: z.string().trim().max(30).optional(),
      departmentId: id.optional(),
      isActive: z.boolean().optional(),
      roles: z.array(roleName).min(1).optional(),
      technicianProfile: technicianProfile.optional(),
    })
    // Guards against an empty PATCH silently "succeeding" while doing nothing.
    .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update' }),
};

export default { createUserSchema, listUsersSchema, updateUserSchema };
