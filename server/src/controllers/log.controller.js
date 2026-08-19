/**
 * src/controllers/log.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Replaces LogController.cs, AdminLogController.cs, ManageLogsController.cs
 *   and TechController.cs — four controllers that all listed and mutated
 *   tickets, differing mainly in which hard-coded filter they applied.
 *
 * WHAT IT ACHIEVES
 *   ONE ticket controller. There is no separate "admin list" endpoint because
 *   there is no need for one: GET /logs already returns what the caller is
 *   entitled to see, decided by log.service's visibilityFilter from their JWT.
 *   An admin calling it gets everything; a staff member gets their own tickets.
 *   Same URL, same code path, no duplicated controller per role.
 */
import path from 'node:path';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created, paginated } from '../utils/apiResponse.js';
import getPagination from '../utils/pagination.js';
import * as logService from '../services/log.service.js';
import * as assignmentService from '../services/assignment.service.js';
import * as escalationService from '../services/escalation.service.js';
import { uploadRoot } from '../middleware/upload.js';

export const createLog = asyncHandler(async (req, res) => {
  const log = await logService.createLog({
    payload: req.body,
    reporterId: req.user.id, // from the token, not the body
    files: req.files ?? [],
  });
  return created(res, log, `Ticket ${log.reference} logged successfully`);
});

export const listLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query);
  const { items, total } = await logService.listLogs({
    user: req.user,
    filters: req.query,
    skip,
    take,
  });
  return paginated(res, items, { page, limit, total }, `${total} ticket(s) found`);
});

export const getLog = asyncHandler(async (req, res) => {
  const log = await logService.getLogById(req.params.id, req.user);
  return ok(res, log, 'Ticket retrieved');
});

export const changeStatus = asyncHandler(async (req, res) => {
  const log = await logService.changeStatus({
    logId: req.params.id,
    toStatus: req.body.status,
    note: req.body.note,
    actor: req.user,
  });
  return ok(res, log, `Ticket ${log.reference} is now ${log.status}`);
});

export const assign = asyncHandler(async (req, res) => {
  const log = await assignmentService.assignTechnician({
    logId: req.params.id,
    technicianId: req.body.technicianId,
    actor: req.user,
    reassign: req.body.reassign,
  });
  return ok(res, log, `Technician assigned to ${log.reference}`);
});

export const unassign = asyncHandler(async (req, res) => {
  const log = await assignmentService.unassignTechnician({ logId: req.params.id, actor: req.user });
  return ok(res, log, `Technician removed from ${log.reference}`);
});

export const suggestTechnician = asyncHandler(async (req, res) => {
  const suggestion = await assignmentService.suggestTechnician(req.params.id);
  return ok(res, suggestion, 'Technician suggestion generated');
});

export const reopen = asyncHandler(async (req, res) => {
  const log = await logService.reopenLog({
    logId: req.params.id,
    note: req.body.note,
    actor: req.user,
  });
  return ok(res, log, `Ticket ${log.reference} reopened`);
});

export const getSlaStatus = asyncHandler(async (req, res) => {
  const status = await logService.getSlaStatus(req.params.id, req.user);
  return ok(res, status, 'SLA status retrieved');
});

export const getHistory = asyncHandler(async (req, res) => {
  const history = await logService.getStatusHistory(req.params.id, req.user);
  return ok(res, history, `${history.length} status change(s)`);
});

export const getCounts = asyncHandler(async (req, res) => {
  const counts = await logService.getStatusCounts(req.user);
  return ok(res, counts, 'Ticket counts retrieved');
});

export const escalate = asyncHandler(async (req, res) => {
  const log = await escalationService.escalateManually({
    logId: req.params.id,
    level: req.body.level,
    reason: req.body.reason,
    actor: req.user,
  });
  return ok(res, log, `Ticket escalated to level ${req.body.level}`);
});

/**
 * Streams the file from disk rather than embedding it in JSON. `res.sendFile`
 * is given an absolute path built from our own stored name — never from
 * anything the client sent — so there is no path-traversal surface.
 */
export const downloadAttachment = asyncHandler(async (req, res) => {
  const attachment = await logService.getAttachment(req.params.id, req.params.attachmentId, req.user);
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.originalName)}"`);
  return res.sendFile(path.join(uploadRoot, attachment.storedName));
});

export default {
  createLog,
  listLogs,
  getLog,
  changeStatus,
  assign,
  unassign,
  suggestTechnician,
  reopen,
  getSlaStatus,
  getHistory,
  getCounts,
  escalate,
  downloadAttachment,
};
