/**
 * src/services/assignment.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Assignment was the clearest example of logic in the wrong place: the whole
 *   rule set lived in LogController.AssignTechnician — 80 lines of DbContext
 *   queries, SLA arithmetic and notification building inside an HTTP handler.
 *   Meanwhile AssignTechnicianService.cs, the file NAMED for this job, only
 *   listed technicians and sent one notification.
 *
 * WHAT IT ACHIEVES
 *   Assignment as a first-class operation with the rules the old code lacked:
 *     - the target must actually hold a technician role (the old code assigned
 *       any user id you passed, including a staff member or a made-up number
 *       — it only checked `TechnicianId <= 0`);
 *     - reassignment is explicit. The old code returned 400 "already assigned"
 *       and offered no way to ever change it, so a mis-assignment was permanent;
 *     - the ticket advances PENDING -> ASSIGNED and stamps `respondedAt`, which
 *       is what stops the response-SLA clock;
 *     - the technician's active-task counter is kept accurate for load balancing.
 *   All of it in one transaction, so a ticket can never end up pointing at a
 *   technician whose counter was not updated.
 */
import prisma from '../config/prisma.js';
import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';
import { LOG_STATUS, NOTIFICATION_TYPE, OPEN_STATUSES, ROLES } from '../constants/index.js';
import * as notificationService from './notification.service.js';
import { logInclude, toLogResponse } from './log.service.js';

const TECHNICIAN_ROLES = [ROLES.TECHNICIAN, ROLES.EXTERNAL_TECHNICIAN];

/**
 * Technicians with their current workload, so an admin can assign on evidence
 * rather than guesswork. The old GetAllTechniciansAsync returned name + email
 * only, and hard-coded `RoleId == 3` to find them.
 */
export async function listAssignableTechnicians({ departmentId, type } = {}) {
  const technicians = await prisma.user.findMany({
    where: {
      isActive: true,
      roles: { some: { role: { name: { in: TECHNICIAN_ROLES } } } },
      ...(departmentId ? { departmentId } : {}),
      ...(type ? { technician: { type } } : {}),
    },
    select: {
      id: true,
      surname: true,
      initials: true,
      email: true,
      department: { select: { id: true, name: true } },
      technician: true,
      roles: { select: { role: { select: { name: true } } } },
      _count: { select: { logsAssigned: { where: { status: { in: OPEN_STATUSES } } } } },
    },
    orderBy: { surname: 'asc' },
  });

  return technicians.map((t) => ({
    id: t.id,
    name: `${t.initials} ${t.surname}`.trim(),
    email: t.email,
    department: t.department,
    roles: t.roles.map((r) => r.role.name),
    specialization: t.technician?.specialization ?? null,
    type: t.technician?.type ?? null,
    location: t.technician?.location ?? null,
    availability: t.technician
      ? { from: minutesToTime(t.technician.availableFrom), to: minutesToTime(t.technician.availableTo) }
      : null,
    openTaskCount: t._count.logsAssigned,
  }));
}

const minutesToTime = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export async function assignTechnician({ logId, technicianId, actor, reassign = false }) {
  const [log, technician] = await Promise.all([
    prisma.log.findUnique({ where: { id: logId }, include: { sla: true } }),
    prisma.user.findUnique({
      where: { id: technicianId },
      include: { roles: { include: { role: true } }, technician: true },
    }),
  ]);

  if (!log) throw ApiError.notFound(`Ticket ${logId} not found`);
  if (!technician) throw ApiError.notFound(`User ${technicianId} not found`);
  if (!technician.isActive) throw ApiError.badRequest('That user account is deactivated');

  // The check the old code never made.
  const roles = technician.roles.map((r) => r.role.name);
  if (!roles.some((r) => TECHNICIAN_ROLES.includes(r))) {
    throw ApiError.badRequest(
      `${technician.initials} ${technician.surname} is not a technician (roles: ${roles.join(', ') || 'none'})`,
    );
  }

  if (log.status === LOG_STATUS.CLOSED) {
    throw ApiError.conflict('A closed ticket cannot be assigned. Reopen it first.');
  }

  const previousTechnicianId = log.technicianId;
  if (previousTechnicianId === technicianId) {
    throw ApiError.conflict('That technician is already assigned to this ticket');
  }
  if (previousTechnicianId && !reassign) {
    throw ApiError.conflict(
      'This ticket already has a technician. Send reassign=true to override the current assignment.',
    );
  }

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.log.update({
      where: { id: logId },
      data: {
        technicianId,
        assignedById: actor.id,
        // Assignment IS the response — this stops the response clock.
        respondedAt: log.respondedAt ?? now,
        status: log.status === LOG_STATUS.PENDING ? LOG_STATUS.ASSIGNED : log.status,
      },
      include: logInclude,
    });

    await tx.logStatusHistory.create({
      data: {
        logId,
        fromStatus: log.status,
        toStatus: row.status,
        changedById: actor.id,
        note: previousTechnicianId
          ? `Reassigned from user ${previousTechnicianId} to ${technicianId}`
          : `Assigned to ${technician.initials} ${technician.surname}`,
      },
    });

    // Keep the denormalised workload counters honest.
    await tx.technician.updateMany({
      where: { userId: technicianId },
      data: { activeTaskCount: { increment: 1 } },
    });
    if (previousTechnicianId) {
      await tx.technician.updateMany({
        where: { userId: previousTechnicianId, activeTaskCount: { gt: 0 } },
        data: { activeTaskCount: { decrement: 1 } },
      });
    }

    return row;
  });

  await notificationService.notifyUser({
    userId: technicianId,
    logId,
    message:
      `You have been assigned ticket ${log.reference}: "${log.title}".\n` +
      `Priority: ${log.priority}\nLocation: ${log.location ?? 'Not specified'}\n` +
      `Resolution due: ${log.resolutionDueAt?.toISOString() ?? 'not set'}`,
    type: NOTIFICATION_TYPE.ALERT,
  });

  await notificationService.notifyUser({
    userId: log.reportedById,
    logId,
    message: `Your ticket ${log.reference} has been assigned to ${technician.initials} ${technician.surname}.`,
    type: NOTIFICATION_TYPE.INFORMATION,
  });

  if (previousTechnicianId) {
    await notificationService.notifyUser({
      userId: previousTechnicianId,
      logId,
      message: `Ticket ${log.reference} has been reassigned to another technician.`,
      type: NOTIFICATION_TYPE.INFORMATION,
    });
  }

  logger.info(`Ticket ${log.reference} assigned to technician ${technicianId} by ${actor.id}`);
  return toLogResponse(updated);
}

export async function unassignTechnician({ logId, actor }) {
  const log = await prisma.log.findUnique({ where: { id: logId } });
  if (!log) throw ApiError.notFound(`Ticket ${logId} not found`);
  if (!log.technicianId) throw ApiError.conflict('This ticket has no technician assigned');

  const previousTechnicianId = log.technicianId;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.log.update({
      where: { id: logId },
      data: { technicianId: null, status: LOG_STATUS.PENDING },
      include: logInclude,
    });
    await tx.logStatusHistory.create({
      data: {
        logId,
        fromStatus: log.status,
        toStatus: LOG_STATUS.PENDING,
        changedById: actor.id,
        note: 'Technician unassigned; ticket returned to the queue',
      },
    });
    await tx.technician.updateMany({
      where: { userId: previousTechnicianId, activeTaskCount: { gt: 0 } },
      data: { activeTaskCount: { decrement: 1 } },
    });
    return row;
  });

  await notificationService.notifyUser({
    userId: previousTechnicianId,
    logId,
    message: `You have been unassigned from ticket ${log.reference}.`,
    type: NOTIFICATION_TYPE.INFORMATION,
  });

  return toLogResponse(updated);
}

/**
 * Suggests the least-loaded technician for a ticket, preferring the reporter's
 * own department. This is the groundwork for true auto-assignment; it only
 * RECOMMENDS, so a human still confirms.
 */
export async function suggestTechnician(logId) {
  const log = await prisma.log.findUnique({ where: { id: logId } });
  if (!log) throw ApiError.notFound(`Ticket ${logId} not found`);

  const candidates = await listAssignableTechnicians({});
  if (candidates.length === 0) throw ApiError.notFound('No active technicians are available');

  const sorted = [...candidates].sort((a, b) => {
    const sameDept = (t) => (t.department?.id === log.departmentId ? 0 : 1);
    return sameDept(a) - sameDept(b) || a.openTaskCount - b.openTaskCount;
  });

  return { recommended: sorted[0], alternatives: sorted.slice(1, 4) };
}

export default {
  listAssignableTechnicians,
  assignTechnician,
  unassignTechnician,
  suggestTechnician,
};
