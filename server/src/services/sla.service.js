/**
 * src/services/sla.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   SLA logic was the flagship feature of this project and it was scattered
 *   across three places that disagreed with each other:
 *     - LogService.LogIssue      : looked up the SLA but set NO due dates.
 *     - LogController.AssignTechnician : set ResponseDue at assignment time and
 *                                  explicitly set ResolutionDue = null.
 *     - SLAMonitoringService     : only then computed ResolutionDue, and read
 *                                  `log.SLA?.ResolutionTimeframe` on entities
 *                                  loaded WITHOUT `.Include(l => l.SLA)`, so the
 *                                  navigation property was always null and the
 *                                  fallback `?? 2` (two minutes) was used for
 *                                  every single ticket.
 *   Net effect: an unassigned ticket had no deadline at all, and escalation used
 *   a hard-coded 2-minute window rather than the configured SLA.
 *
 * WHAT IT ACHIEVES
 *   One module that owns the SLA clock:
 *     - resolveSlaForPriority : priority -> SLA row (this IS the "automated SLA
 *       assignment" the project is known for).
 *     - computeDeadlines      : both deadlines calculated ONCE at creation from
 *       a single reference time, so every ticket is measurable from the moment
 *       it is logged.
 *     - evaluate              : pure function turning a ticket + "now" into
 *       progress percentages and the escalation level it has earned. Being pure
 *       (no DB, no clock of its own) it is trivially testable and is reused by
 *       BOTH the live status endpoint and the background job — so the number the
 *       user sees and the number the job acts on can never diverge.
 */
import prisma from '../config/prisma.js';
import ApiError from '../utils/ApiError.js';
import { ESCALATION_THRESHOLDS, LOG_STATUS } from '../constants/index.js';
import * as auditService from './audit.service.js';

const MINUTE_MS = 60_000;

export async function listSlas() {
  return prisma.sla.findMany({ orderBy: { id: 'asc' } });
}

export async function getSlaById(id) {
  const sla = await prisma.sla.findUnique({ where: { id } });
  if (!sla) throw ApiError.notFound(`SLA ${id} not found`);
  return sla;
}

/**
 * The automatic part of "automated SLA assignment": the ticket's priority
 * selects its service-level agreement. No caller passes an SLA id by hand.
 */
export async function resolveSlaForPriority(priority, client = prisma) {
  const sla = await client.sla.findUnique({ where: { priority } });
  if (!sla) {
    throw ApiError.badRequest(
      `No SLA is configured for priority "${priority}". Seed the SLA table or create one via POST /slas.`,
    );
  }
  return sla;
}

/** Both deadlines, from one reference instant. */
export function computeDeadlines(sla, from = new Date()) {
  return {
    responseDueAt: new Date(from.getTime() + sla.responseMinutes * MINUTE_MS),
    resolutionDueAt: new Date(from.getTime() + sla.resolutionMinutes * MINUTE_MS),
  };
}

export async function upsertSla({ priority, description, responseMinutes, resolutionMinutes }, actorId) {
  if (responseMinutes >= resolutionMinutes) {
    throw ApiError.badRequest('responseMinutes must be smaller than resolutionMinutes');
  }
  const sla = await prisma.sla.upsert({
    where: { priority },
    update: { description, responseMinutes, resolutionMinutes },
    create: { priority, description, responseMinutes, resolutionMinutes },
  });
  await auditService.recordAction({
    actorId, action: 'sla.upsert', targetType: 'Sla', targetId: sla.id,
    metadata: { priority, responseMinutes, resolutionMinutes },
  });
  return sla;
}

export async function deleteSla(id, actorId) {
  const inUse = await prisma.log.count({ where: { slaId: id } });
  if (inUse > 0) {
    throw ApiError.conflict(`This SLA is attached to ${inUse} ticket(s) and cannot be deleted`);
  }
  const sla = await getSlaById(id);
  await prisma.sla.delete({ where: { id } });
  await auditService.recordAction({
    actorId, action: 'sla.delete', targetType: 'Sla', targetId: id,
    metadata: { priority: sla.priority },
  });
}

/**
 * PURE. Given a ticket and a moment in time, describe its SLA position.
 * No database access and no `new Date()` inside — the caller supplies `now`,
 * which is what makes this unit-testable and consistent between the API
 * response and the background job.
 */
export function evaluate(log, now = new Date()) {
  const terminal = log.status === LOG_STATUS.RESOLVED || log.status === LOG_STATUS.CLOSED;

  const msUntil = (date) => (date ? new Date(date).getTime() - now.getTime() : null);

  const responseRemainingMs = msUntil(log.responseDueAt);
  const resolutionRemainingMs = msUntil(log.resolutionDueAt);

  const totalWindowMs =
    log.resolutionDueAt && log.createdAt
      ? new Date(log.resolutionDueAt).getTime() - new Date(log.createdAt).getTime()
      : null;
  const elapsedMs = log.createdAt ? now.getTime() - new Date(log.createdAt).getTime() : 0;

  const consumedFraction =
    totalWindowMs && totalWindowMs > 0 ? Math.max(0, elapsedMs / totalWindowMs) : 0;

  // A ticket that is already resolved or closed can never escalate further.
  let dueLevel = 0;
  if (!terminal) {
    for (const threshold of ESCALATION_THRESHOLDS) {
      if (consumedFraction >= threshold.atFraction) dueLevel = threshold.level;
    }
  }

  const respondedInTime =
    log.respondedAt && log.responseDueAt
      ? new Date(log.respondedAt) <= new Date(log.responseDueAt)
      : null;

  const resolvedInTime =
    log.resolvedAt && log.resolutionDueAt
      ? new Date(log.resolvedAt) <= new Date(log.resolutionDueAt)
      : null;

  return {
    now,
    terminal,
    responseDueAt: log.responseDueAt ?? null,
    resolutionDueAt: log.resolutionDueAt ?? null,
    responseRemainingMs,
    resolutionRemainingMs,
    responseRemainingMinutes: responseRemainingMs === null ? null : Math.round(responseRemainingMs / MINUTE_MS),
    resolutionRemainingMinutes: resolutionRemainingMs === null ? null : Math.round(resolutionRemainingMs / MINUTE_MS),
    // Clamped for display: a progress bar should stop at 100%, but `dueLevel`
    // above uses the unclamped value so a badly overdue ticket still reads 3.
    percentConsumed: Math.min(100, Math.round(consumedFraction * 100)),
    responseBreached: !terminal && responseRemainingMs !== null && responseRemainingMs < 0 && !log.respondedAt,
    resolutionBreached: !terminal && resolutionRemainingMs !== null && resolutionRemainingMs < 0,
    currentEscalationLevel: log.escalationLevel ?? 0,
    dueEscalationLevel: dueLevel,
    respondedInTime,
    resolvedInTime,
  };
}

export default {
  listSlas,
  getSlaById,
  resolveSlaForPriority,
  computeDeadlines,
  upsertSla,
  deleteSla,
  evaluate,
};
