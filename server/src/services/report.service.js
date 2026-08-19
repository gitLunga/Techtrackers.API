/**
 * src/services/report.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Replaces GenerateReport.cs, MonthlySummaryReport.cs and TechPerformanceReport.cs.
 *   Each had a correctness bug that made its numbers wrong:
 *     - GetIssueStatusCount counted the literal "On Hold" while the writer used
 *       "ONHOLD", so the on-hold tile was permanently 0.
 *     - MonthlySummaryReport averaged `DateDiffDay(CreatedAt, ResolutionDue)` —
 *       the difference between creation and the DEADLINE. That is the SLA
 *       window, not how long anything took. It reported the same figure whether
 *       a ticket was fixed in an hour or never fixed at all.
 *     - TechPerformanceReport computed `ResolutionDue - AssignedAt` for the same
 *       reason, and pulled every ticket for every technician into memory (an
 *       N+1 across four subqueries per technician).
 *
 * WHAT IT ACHIEVES
 *   Reports measured against what ACTUALLY happened (`resolvedAt - createdAt`),
 *   plus real SLA-compliance percentages — the number this system exists to
 *   produce and which the old code could not report at all.
 */
import prisma from '../config/prisma.js';
import { LOG_STATUS, OPEN_STATUSES, ROLES } from '../constants/index.js';

/** Reports respect the same visibility rules as ticket lists. */
function scopeFor(user) {
  if (user.roles.includes(ROLES.ADMIN)) return {};
  if (user.roles.includes(ROLES.HOD)) return { departmentId: user.departmentId };
  return { technicianId: user.id };
}

const MS_PER_HOUR = 3_600_000;

function dateRangeFilter({ from, to }) {
  if (!from && !to) return {};
  return {
    createdAt: {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    },
  };
}

/** Tickets grouped by status, plus open/overdue totals. Dashboard tiles. */
export async function getStatusCountReport(user, range = {}) {
  const where = { ...scopeFor(user), ...dateRangeFilter(range) };

  const grouped = await prisma.log.groupBy({ by: ['status'], where, _count: { _all: true } });

  const byStatus = Object.fromEntries(Object.values(LOG_STATUS).map((s) => [s, 0]));
  for (const row of grouped) byStatus[row.status] = row._count._all;

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const overdue = await prisma.log.count({
    where: { ...where, status: { in: OPEN_STATUSES }, resolutionDueAt: { lt: new Date() } },
  });

  return {
    total,
    open: OPEN_STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
    overdue,
    byStatus,
  };
}

/** Flat ticket listing for export — the old GetIssueByStatusReport, corrected. */
export async function getIssueReport(user, { status, priority, from, to } = {}) {
  const where = {
    ...scopeFor(user),
    ...dateRangeFilter({ from, to }),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
  };

  const logs = await prisma.log.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      technician: { select: { surname: true, initials: true } },
      reportedBy: { select: { surname: true, initials: true } },
      category: { select: { name: true } },
      department: { select: { name: true } },
    },
  });

  const now = new Date();
  return logs.map((log) => {
    const resolutionHours = log.resolvedAt
      ? (log.resolvedAt.getTime() - log.createdAt.getTime()) / MS_PER_HOUR
      : null;

    return {
      id: log.id,
      reference: log.reference,
      title: log.title,
      category: log.category?.name ?? null,
      department: log.department?.name ?? null,
      priority: log.priority,
      status: log.status,
      reportedBy: `${log.reportedBy.initials} ${log.reportedBy.surname}`.trim(),
      technician: log.technician
        ? `${log.technician.initials} ${log.technician.surname}`.trim()
        : 'Unassigned',
      createdAt: log.createdAt,
      resolutionDueAt: log.resolutionDueAt,
      resolvedAt: log.resolvedAt,
      closedAt: log.closedAt,
      // Real elapsed time, not the SLA window.
      resolutionHours: resolutionHours === null ? null : Math.round(resolutionHours * 10) / 10,
      metSla: log.resolvedAt && log.resolutionDueAt ? log.resolvedAt <= log.resolutionDueAt : null,
      isOverdue:
        OPEN_STATUSES.includes(log.status) && log.resolutionDueAt ? log.resolutionDueAt < now : false,
      escalationLevel: log.escalationLevel,
    };
  });
}

/**
 * Month-by-month trend. Computed in SQL with date_trunc so Postgres does the
 * grouping rather than pulling every ticket into Node.
 */
export async function getMonthlySummary(user, { months = 12 } = {}) {
  const scope = scopeFor(user);
  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1));
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const logs = await prisma.log.findMany({
    where: { ...scope, createdAt: { gte: since } },
    select: {
      createdAt: true,
      resolvedAt: true,
      closedAt: true,
      status: true,
      resolutionDueAt: true,
    },
  });

  const buckets = new Map();
  for (const log of logs) {
    const key = `${log.createdAt.getUTCFullYear()}-${String(log.createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!buckets.has(key)) {
      buckets.set(key, { month: key, total: 0, resolved: 0, open: 0, metSla: 0, resolutionHours: [] });
    }
    const bucket = buckets.get(key);
    bucket.total += 1;

    if (log.resolvedAt) {
      bucket.resolved += 1;
      bucket.resolutionHours.push((log.resolvedAt.getTime() - log.createdAt.getTime()) / MS_PER_HOUR);
      if (log.resolutionDueAt && log.resolvedAt <= log.resolutionDueAt) bucket.metSla += 1;
    } else if (OPEN_STATUSES.includes(log.status)) {
      bucket.open += 1;
    }
  }

  return [...buckets.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(({ resolutionHours, ...bucket }) => ({
      ...bucket,
      averageResolutionHours:
        resolutionHours.length > 0
          ? Math.round((resolutionHours.reduce((a, b) => a + b, 0) / resolutionHours.length) * 10) / 10
          : null,
      slaCompliancePercent:
        bucket.resolved > 0 ? Math.round((bucket.metSla / bucket.resolved) * 100) : null,
    }));
}

/**
 * Per-technician scorecard. Two queries total (tickets + feedback) regardless of
 * how many technicians there are, instead of the old four-subqueries-per-person.
 */
export async function getTechnicianPerformance(user, { from, to } = {}) {
  const scope = scopeFor(user);
  const range = dateRangeFilter({ from, to });

  const technicians = await prisma.user.findMany({
    where: {
      roles: { some: { role: { name: { in: [ROLES.TECHNICIAN, ROLES.EXTERNAL_TECHNICIAN] } } } },
      ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
    },
    select: {
      id: true,
      surname: true,
      initials: true,
      department: { select: { name: true } },
    },
    orderBy: { surname: 'asc' },
  });

  if (technicians.length === 0) return [];
  const technicianIds = technicians.map((t) => t.id);

  const [logs, feedback] = await Promise.all([
    prisma.log.findMany({
      where: { technicianId: { in: technicianIds }, ...range },
      select: {
        technicianId: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        resolutionDueAt: true,
        escalationLevel: true,
      },
    }),
    prisma.feedback.findMany({
      where: { log: { technicianId: { in: technicianIds } } },
      select: { rating: true, log: { select: { technicianId: true } } },
    }),
  ]);

  const stats = new Map(
    technicianIds.map((id) => [
      id,
      { assigned: 0, resolved: 0, open: 0, escalated: 0, metSla: 0, hours: [], ratings: [] },
    ]),
  );

  for (const log of logs) {
    const s = stats.get(log.technicianId);
    if (!s) continue;
    s.assigned += 1;
    if (log.escalationLevel > 0) s.escalated += 1;

    if (log.resolvedAt) {
      s.resolved += 1;
      s.hours.push((log.resolvedAt.getTime() - log.createdAt.getTime()) / MS_PER_HOUR);
      if (log.resolutionDueAt && log.resolvedAt <= log.resolutionDueAt) s.metSla += 1;
    } else if (OPEN_STATUSES.includes(log.status)) {
      s.open += 1;
    }
  }

  for (const row of feedback) {
    const s = stats.get(row.log.technicianId);
    if (s) s.ratings.push(row.rating);
  }

  const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  return technicians.map((tech) => {
    const s = stats.get(tech.id);
    const avgHours = average(s.hours);
    const avgRating = average(s.ratings);

    return {
      technicianId: tech.id,
      technicianName: `${tech.initials} ${tech.surname}`.trim(),
      department: tech.department?.name ?? null,
      assignedIssues: s.assigned,
      resolvedIssues: s.resolved,
      openIssues: s.open,
      escalatedIssues: s.escalated,
      averageResolutionHours: avgHours === null ? null : Math.round(avgHours * 10) / 10,
      slaCompliancePercent: s.resolved > 0 ? Math.round((s.metSla / s.resolved) * 100) : null,
      resolutionRatePercent: s.assigned > 0 ? Math.round((s.resolved / s.assigned) * 100) : null,
      averageRating: avgRating === null ? null : Math.round(avgRating * 10) / 10,
      totalRatings: s.ratings.length,
    };
  });
}

/**
 * Overall SLA compliance — the headline metric. The old system stored SLA data
 * but never reported on it, so nobody could answer "are we meeting our SLAs?".
 */
export async function getSlaComplianceReport(user, { from, to } = {}) {
  const where = { ...scopeFor(user), ...dateRangeFilter({ from, to }) };

  const [resolved, breachedOpen] = await Promise.all([
    prisma.log.findMany({
      where: { ...where, resolvedAt: { not: null } },
      select: { priority: true, resolvedAt: true, resolutionDueAt: true, respondedAt: true, responseDueAt: true },
    }),
    prisma.log.count({
      where: { ...where, status: { in: OPEN_STATUSES }, resolutionDueAt: { lt: new Date() } },
    }),
  ]);

  const byPriority = {};
  let metResolution = 0;
  let metResponse = 0;
  let respondedCount = 0;

  for (const log of resolved) {
    byPriority[log.priority] ??= { total: 0, metResolution: 0 };
    byPriority[log.priority].total += 1;

    if (log.resolutionDueAt && log.resolvedAt <= log.resolutionDueAt) {
      metResolution += 1;
      byPriority[log.priority].metResolution += 1;
    }
    if (log.respondedAt && log.responseDueAt) {
      respondedCount += 1;
      if (log.respondedAt <= log.responseDueAt) metResponse += 1;
    }
  }

  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);

  return {
    resolvedTickets: resolved.length,
    resolutionCompliancePercent: pct(metResolution, resolved.length),
    responseCompliancePercent: pct(metResponse, respondedCount),
    currentlyBreachedOpenTickets: breachedOpen,
    byPriority: Object.fromEntries(
      Object.entries(byPriority).map(([priority, v]) => [
        priority,
        { ...v, compliancePercent: pct(v.metResolution, v.total) },
      ]),
    ),
  };
}

export default {
  getStatusCountReport,
  getIssueReport,
  getMonthlySummary,
  getTechnicianPerformance,
  getSlaComplianceReport,
};
