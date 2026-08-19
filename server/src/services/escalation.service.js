/**
 * src/services/escalation.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old SLAMonitoringService was a BackgroundService with the escalation
 *   rules welded into its loop. That had four consequences:
 *     - the rules could not be called on demand or unit-tested;
 *     - it re-notified on EVERY pass, because nothing recorded that level 2 had
 *       already been announced — with its `Task.Delay(TimeSpan.FromMinutes(0.1))`
 *       that was a notification storm every six seconds;
 *     - it read `log.SLA?.ResolutionTimeframe` on entities loaded without
 *       `.Include(l => l.SLA)`, so the navigation was always null and the `?? 2`
 *       fallback gave every ticket a two-minute SLA;
 *     - a crash inside the loop killed escalation silently for the whole process.
 *
 * WHAT IT ACHIEVES
 *   The escalation RULES as an ordinary, callable service. jobs/slaMonitor.job.js
 *   is now just a timer that calls `runEscalationSweep()`.
 *
 *   Escalations are recorded in the `escalations` table with a UNIQUE(logId,
 *   level) constraint, so each level is announced exactly once no matter how
 *   often the sweep runs. Level 3 additionally notifies the Head of Department —
 *   which is what the Escalation model's `HODId` column was always for, though
 *   nothing in the old code ever wrote to that table.
 */
import prisma from '../config/prisma.js';
import logger from '../config/logger.js';
import ApiError from '../utils/ApiError.js';
import {
  ESCALATION_THRESHOLDS,
  LOG_STATUS,
  NOTIFICATION_TYPE,
  OPEN_STATUSES,
  ROLES,
} from '../constants/index.js';
import * as slaService from './sla.service.js';
import * as notificationService from './notification.service.js';
import { emitToLog } from '../realtime/emitter.js';

/** Escalate one ticket to `level`, if it is not already there. Idempotent. */
async function escalateTo(log, level, now) {
  const threshold = ESCALATION_THRESHOLDS.find((t) => t.level === level);
  const reason = `SLA escalation level ${level}: ${threshold.label} for ticket ${log.reference}.`;

  // The unique index on (logId, level) is what makes repeat sweeps harmless.
  const alreadyRecorded = await prisma.escalation.findUnique({
    where: { logId_level: { logId: log.id, level } },
  });
  if (alreadyRecorded) return false;

  const heads = await prisma.user.findMany({
    where: {
      departmentId: log.departmentId,
      isActive: true,
      roles: { some: { role: { name: ROLES.HOD } } },
    },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.escalation.create({
      data: { logId: log.id, level, reason, notifiedUserId: heads[0]?.id ?? null },
    });

    await tx.log.update({
      where: { id: log.id },
      data: {
        escalationLevel: level,
        // Only a full breach changes the ticket's own status; levels 1 and 2 are
        // warnings and must not disturb a technician's IN_PROGRESS state.
        ...(level === 3 && log.status !== LOG_STATUS.ESCALATED
          ? { status: LOG_STATUS.ESCALATED }
          : {}),
      },
    });

    if (level === 3 && log.status !== LOG_STATUS.ESCALATED) {
      await tx.logStatusHistory.create({
        data: {
          logId: log.id,
          fromStatus: log.status,
          toStatus: LOG_STATUS.ESCALATED,
          note: reason,
          changedById: log.reportedById, // system action, attributed to the reporter's record
        },
      });
    }
  });

  // Who hears about it widens as severity rises.
  const recipients = new Set();
  if (log.technicianId) recipients.add(log.technicianId);
  if (level >= 2 && log.assignedById) recipients.add(log.assignedById);
  if (level >= 3) {
    for (const head of heads) recipients.add(head.id);
    recipients.add(log.reportedById);
  }

  await notificationService.notifyMany(
    [...recipients].map((userId) => ({ userId, logId: log.id, message: reason, type: threshold.type })),
  );

  if (level >= 3) {
    await notificationService.notifyRole(ROLES.ADMIN, {
      logId: log.id,
      message: `SLA BREACH: ticket ${log.reference} ("${log.title}") has passed its resolution deadline.`,
      type: NOTIFICATION_TYPE.ALERT,
    });
  }

  emitToLog(log.id, 'log:escalated', { logId: log.id, level, reason });
  logger.warn(`Ticket ${log.reference} escalated to level ${level}`);
  return true;
}

/**
 * One pass over every open ticket. Safe to call as often as you like — already
 * announced levels are skipped, so it does no work when nothing has changed.
 */
export async function runEscalationSweep(now = new Date()) {
  const openLogs = await prisma.log.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      resolutionDueAt: { not: null },
    },
    // The `include` the old job forgot — this is why its SLA lookups were null.
    include: { sla: true },
  });

  let escalated = 0;
  for (const log of openLogs) {
    try {
      const evaluation = slaService.evaluate(log, now);
      if (evaluation.dueEscalationLevel > (log.escalationLevel ?? 0)) {
        // Step through each missed level so no notification is skipped when a
        // ticket jumps two levels between sweeps.
        for (let level = (log.escalationLevel ?? 0) + 1; level <= evaluation.dueEscalationLevel; level += 1) {
          if (await escalateTo(log, level, now)) escalated += 1;
        }
      }
    } catch (error) {
      // One bad ticket must not abort the sweep for all the others — exactly
      // the failure mode the old single-loop BackgroundService had.
      logger.error(`Escalation failed for ticket ${log.reference}: ${error.message}`);
    }
  }

  if (escalated > 0) logger.info(`Escalation sweep: ${escalated} escalation(s) raised across ${openLogs.length} open ticket(s)`);
  return { scanned: openLogs.length, escalated, at: now };
}

/** Manual escalation by an admin/HOD, independent of the SLA clock. */
export async function escalateManually({ logId, level, reason, actor }) {
  const log = await prisma.log.findUnique({ where: { id: logId } });
  // A bare Error would fall through to the generic 500 handler; callers need a 404.
  if (!log) throw ApiError.notFound(`Ticket ${logId} not found`);

  await prisma.$transaction([
    prisma.escalation.upsert({
      where: { logId_level: { logId, level } },
      update: { reason },
      create: { logId, level, reason, notifiedUserId: actor.id },
    }),
    prisma.log.update({
      where: { id: logId },
      data: { escalationLevel: level, status: LOG_STATUS.ESCALATED },
    }),
    prisma.logStatusHistory.create({
      data: {
        logId,
        fromStatus: log.status,
        toStatus: LOG_STATUS.ESCALATED,
        note: `Manually escalated to level ${level}: ${reason}`,
        changedById: actor.id,
      },
    }),
  ]);

  if (log.technicianId) {
    await notificationService.notifyUser({
      userId: log.technicianId,
      logId,
      message: `Ticket ${log.reference} has been manually escalated to level ${level} by ${actor.name}: ${reason}`,
      type: NOTIFICATION_TYPE.ALERT,
    });
  }

  return prisma.log.findUnique({ where: { id: logId }, include: { escalations: true } });
}

export async function getEscalationsForLog(logId) {
  return prisma.escalation.findMany({
    where: { logId },
    orderBy: { level: 'asc' },
    include: { notifiedUser: { select: { id: true, surname: true, initials: true } } },
  });
}

export default { runEscalationSweep, escalateManually, getEscalationsForLog };
