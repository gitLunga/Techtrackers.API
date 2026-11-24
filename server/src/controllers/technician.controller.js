/**
 * src/controllers/technician.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Answers the questions an admin asks when dispatching work — "who is
 *   available, and how loaded are they?" — and the question a technician asks
 *   about themselves: "how am I doing?".
 *
 *   The old TechController.cs answered the second with FIVE separate endpoints
 *   (countResolved, countInProgress, countOnHold, countPending, logStats), so a
 *   technician dashboard made five HTTP round-trips to draw four tiles.
 *
 * WHAT IT ACHIEVES
 *   One /technicians/:id/stats call returns the whole picture, including the
 *   SLA compliance and average rating the old endpoints could not produce.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import ApiError from '../utils/ApiError.js';
import prisma from '../config/prisma.js';
import * as assignmentService from '../services/assignment.service.js';
import * as feedbackService from '../services/feedback.service.js';
import { LOG_STATUS, OPEN_STATUSES, ROLES } from '../constants/index.js';

export const listTechnicians = asyncHandler(async (req, res) => {
  const technicians = await assignmentService.listAssignableTechnicians({
    departmentId: req.query.departmentId ? Number(req.query.departmentId) : undefined,
    type: req.query.type,
  });
  return ok(res, technicians, `${technicians.length} technician(s) available`);
});

export const getTechnicianStats = asyncHandler(async (req, res) => {
  const technicianId = req.params.id;

  // A technician may read their own stats; admins and HODs may read anyone's.
  const isSelf = technicianId === req.user.id;
  const isPrivileged = req.user.roles.some((r) => [ROLES.ADMIN, ROLES.HOD].includes(r));
  if (!isSelf && !isPrivileged) {
    throw ApiError.forbidden('You may only view your own statistics');
  }

  const technician = await prisma.user.findUnique({
    where: { id: technicianId },
    select: { id: true, surname: true, initials: true, department: { select: { name: true } } },
  });
  if (!technician) throw ApiError.notFound(`Technician ${technicianId} not found`);

  // One grouped query replaces the old five count endpoints.
  const grouped = await prisma.log.groupBy({
    by: ['status'],
    where: { technicianId },
    _count: { _all: true },
  });

  const byStatus = Object.fromEntries(Object.values(LOG_STATUS).map((s) => [s, 0]));
  for (const row of grouped) byStatus[row.status] = row._count._all;

  const resolvedLogs = await prisma.log.findMany({
    where: { technicianId, resolvedAt: { not: null } },
    select: { createdAt: true, resolvedAt: true, resolutionDueAt: true },
  });

  const hours = resolvedLogs.map((l) => (l.resolvedAt - l.createdAt) / 3_600_000);
  const metSla = resolvedLogs.filter((l) => l.resolutionDueAt && l.resolvedAt <= l.resolutionDueAt).length;

  const overdue = await prisma.log.count({
    where: { technicianId, status: { in: OPEN_STATUSES }, resolutionDueAt: { lt: new Date() } },
  });

  const rating = await feedbackService.getTechnicianRating(technicianId);

  return ok(
    res,
    {
      technician: {
        id: technician.id,
        name: `${technician.initials} ${technician.surname}`.trim(),
        department: technician.department?.name ?? null,
      },
      byStatus,
      totals: {
        assigned: Object.values(byStatus).reduce((a, b) => a + b, 0),
        open: OPEN_STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        overdue,
      },
      performance: {
        averageResolutionHours:
          hours.length > 0 ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
        slaCompliancePercent:
          resolvedLogs.length > 0 ? Math.round((metSla / resolvedLogs.length) * 100) : null,
        averageRating: rating.averageRating,
        totalRatings: rating.totalRatings,
      },
    },
    'Technician statistics retrieved',
  );
});

export default { listTechnicians, getTechnicianStats };
