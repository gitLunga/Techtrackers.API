/**
 * src/controllers/audit.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Read side of the admin action log — a thin adapter over audit.service.js,
 *   same shape as every other list endpoint in this API.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { paginated } from '../utils/apiResponse.js';
import getPagination from '../utils/pagination.js';
import * as auditService from '../services/audit.service.js';

export const list = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query);
  const { items, total } = await auditService.listAuditLogs({ filters: req.query, skip, take });
  return paginated(res, items, { page, limit, total }, `${total} audit log entr${total === 1 ? 'y' : 'ies'} found`);
});

export default { list };
