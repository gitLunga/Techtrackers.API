/**
 * src/validators/audit.validator.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Query contract for browsing the admin action log — filterable by actor,
 *   target type, action, and date range, same shape as the reports endpoints.
 */
import { z } from 'zod';
import { id, pagination } from './common.validator.js';

export const listAuditLogsSchema = {
  query: pagination.extend({
    actorId: id.optional(),
    targetType: z.string().trim().min(1).max(50).optional(),
    action: z.string().trim().min(1).max(100).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
};

export default { listAuditLogsSchema };
