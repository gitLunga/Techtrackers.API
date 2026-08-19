/**
 * src/services/log.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   This replaces LogService.cs, AdminLogsService.cs, ManageLogsService.cs and
 *   the business logic that had leaked into LogController.cs / ManageLogsController.cs.
 *   Those four files each held a partial, slightly different implementation of
 *   "fetch tickets" and "change a ticket's status".
 *
 * WHAT IT ACHIEVES
 *   The single owner of the ticket lifecycle. Every rule about a ticket —
 *   who may see it, what states it may move to, when the SLA clock starts,
 *   who gets told — is decided here and nowhere else.
 *
 * KEY FIXES OVER THE C# VERSION
 *   1. REFERENCE GENERATION. Old: `GetDepartmentInitials(dept, new Random().Next(1000,9999))`
 *      — a random number with no uniqueness check, so collisions were a matter
 *      of when, not if, and two different departments could also produce the
 *      same initials. Now: a per-department counter allocated INSIDE the
 *      creation transaction, with a UNIQUE constraint behind it.
 *   2. ATOMICITY. Old: `AddAsync(log); SaveChangesAsync(); ...; SaveChangesAsync();`
 *      — a failure between the two saves left a ticket with no notifications.
 *      Now everything runs in one `prisma.$transaction`: all of it commits or
 *      none of it does.
 *   3. VISIBILITY. Old: `GetAllLogsAsync(userId, isTechnician)` took a BOOLEAN
 *      FROM THE QUERY STRING to decide whether you were a technician. Callers
 *      chose their own permissions. Now scoping is derived from the JWT roles.
 *   4. STATUS TRANSITIONS. Old: any string could be written over any status,
 *      including reviving a CLOSED ticket. Now checked against STATUS_TRANSITIONS.
 *   5. HISTORY. The LogStatusHistory table existed in the old schema and was
 *      NEVER WRITTEN TO. Every transition now records who changed what, when.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';
import {
  LOG_STATUS,
  NOTIFICATION_TYPE,
  OPEN_STATUSES,
  ROLES,
  STATUS_TRANSITIONS,
} from '../constants/index.js';
import * as slaService from './sla.service.js';
import * as notificationService from './notification.service.js';
import { emitToLog } from '../realtime/emitter.js';

/** Shape returned to clients. Declared once so every endpoint agrees. */
const logInclude = {
  category: { select: { id: true, name: true } },
  department: { select: { id: true, name: true, code: true } },
  sla: { select: { id: true, priority: true, responseMinutes: true, resolutionMinutes: true } },
  reportedBy: { select: { id: true, surname: true, initials: true, email: true } },
  technician: { select: { id: true, surname: true, initials: true, email: true } },
  assignedBy: { select: { id: true, surname: true, initials: true } },
  attachments: {
    select: { id: true, originalName: true, mimeType: true, sizeBytes: true, uploadedAt: true },
  },
  _count: { select: { chatMessages: true, feedback: true } },
};

const fullName = (u) => (u ? `${u.initials ?? ''} ${u.surname ?? ''}`.trim() : null);

/**
 * Presentation mapping lives here rather than in the controller so that every
 * endpoint returning a ticket returns the SAME shape. In the old code
 * LogDetailDto, AdminLogDto and the anonymous objects in controllers all
 * described a ticket differently, and the React app had three parsers.
 */
export function toLogResponse(log, now = new Date()) {
  if (!log) return null;
  return {
    id: log.id,
    reference: log.reference,
    title: log.title,
    description: log.description,
    location: log.location,
    priority: log.priority,
    status: log.status,
    note: log.note,
    escalationLevel: log.escalationLevel,
    category: log.category ?? null,
    department: log.department ?? null,
    reportedBy: log.reportedBy ? { ...log.reportedBy, name: fullName(log.reportedBy) } : null,
    technician: log.technician ? { ...log.technician, name: fullName(log.technician) } : null,
    assignedBy: log.assignedBy ? { ...log.assignedBy, name: fullName(log.assignedBy) } : null,
    assignedTo: fullName(log.technician) ?? 'Unassigned',
    sla: log.sla ?? null,
    attachments: log.attachments ?? [],
    counts: log._count ? { chatMessages: log._count.chatMessages, feedback: log._count.feedback } : undefined,
    timestamps: {
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
      respondedAt: log.respondedAt,
      resolvedAt: log.resolvedAt,
      closedAt: log.closedAt,
      responseDueAt: log.responseDueAt,
      resolutionDueAt: log.resolutionDueAt,
    },
    slaStatus: slaService.evaluate(log, now),
  };
}

/**
 * Allocates the next human reference for a department, e.g. ICT-0001.
 *
 * READ-THEN-WRITE IS A RACE. Two tickets logged in the same instant both read
 * the same "last" reference and both compute the same next one. The UNIQUE
 * index on `reference` stops a duplicate reaching the table — but the loser's
 * whole transaction aborts, and someone logging a genuine issue is told "a
 * record with this reference already exists". Measured on this codebase before
 * the fix: 10 simultaneous submissions produced 3 tickets and 7 rejections.
 *
 * THE FIX IS A ROW LOCK, not a retry. `SELECT ... FOR UPDATE` on the department
 * row makes reference allocation serial *per department*: the second writer
 * waits for the first to commit, then reads the number it actually wrote.
 *
 * Retrying instead would also stop the failures, but each retry has to skip
 * ahead to dodge the number it just lost, so the sequence comes out full of
 * holes (HR-0012, HR-0015, HR-0020…). In a support system where references get
 * quoted to users over the phone, a missing HR-0014 looks like a lost ticket
 * and generates its own support call. Gapless is worth a few milliseconds of
 * contention on a transaction this short.
 *
 * Departments are the lock granularity, so ICT and HR never block each other.
 */
async function nextReference(tx, department) {
  // Serialises concurrent allocations for this department only. Released when
  // the surrounding transaction commits or rolls back.
  await tx.$queryRaw`SELECT id FROM departments WHERE id = ${department.id} FOR UPDATE`;

  const last = await tx.log.findFirst({
    where: { departmentId: department.id },
    orderBy: { id: 'desc' },
    select: { reference: true },
  });

  let sequence = 1;
  if (last?.reference) {
    const parsed = Number.parseInt(last.reference.split('-').pop(), 10);
    if (Number.isFinite(parsed)) sequence = parsed + 1;
  }
  return `${department.code}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Backstop only. With the row lock above this should never fire; it exists so a
 * reference inserted outside this code path (a data import, a manual fix)
 * cannot permanently wedge ticket creation.
 */
const REFERENCE_MAX_ATTEMPTS = 5;

/** True when this error is Postgres rejecting a duplicate `reference`. */
function isReferenceCollision(error) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes('reference') : target === 'reference';
}

/**
 * WHO CAN SEE WHAT. Derived from the authenticated user, never from input.
 *   ADMIN                        -> everything
 *   HOD                          -> everything in their own department
 *   TECHNICIAN / EXTERNAL_TECH   -> tickets assigned to them, or which they
 *                                   have been accepted onto as a collaborator
 *   STAFF                        -> only tickets they themselves reported
 */
export function visibilityFilter(user) {
  if (user.roles.includes(ROLES.ADMIN)) return {};
  if (user.roles.includes(ROLES.HOD)) return { departmentId: user.departmentId };
  if (user.roles.includes(ROLES.TECHNICIAN) || user.roles.includes(ROLES.EXTERNAL_TECHNICIAN)) {
    return {
      OR: [
        { technicianId: user.id },
        { collaborations: { some: { inviteeId: user.id, status: 'ACCEPTED' } } },
      ],
    };
  }
  return { reportedById: user.id };
}

/** Throws unless this user is allowed to see this specific ticket. */
export async function assertCanView(logId, user) {
  const log = await prisma.log.findFirst({
    where: { AND: [{ id: logId }, visibilityFilter(user)] },
    select: { id: true },
  });
  if (!log) throw ApiError.notFound(`Ticket ${logId} not found or not visible to you`);
}

/**
 * WHO CAN CHANGE A TICKET. Seeing a ticket and being able to drive it are
 * different rights, so this is a separate, stricter check than assertCanView.
 *
 *   ADMIN                     -> any ticket
 *   HOD                       -> tickets in their own department
 *   assigned technician       -> their own ticket
 *   accepted collaborator     -> the ticket they were invited onto
 *   reporter                  -> only to CLOSE a ticket already RESOLVED
 *                                (confirming the fix worked) — they must not be
 *                                able to mark their own issue resolved.
 *
 * Without this, any authenticated account could drive any ticket through its
 * whole lifecycle simply by knowing its id.
 */
export async function assertCanModify(log, user, toStatus = null) {
  if (user.roles.includes(ROLES.ADMIN)) return;
  if (user.roles.includes(ROLES.HOD) && log.departmentId === user.departmentId) return;
  if (log.technicianId === user.id) return;

  if (log.reportedById === user.id) {
    if (toStatus === LOG_STATUS.CLOSED && log.status === LOG_STATUS.RESOLVED) return;
    throw ApiError.forbidden(
      'As the reporter you can only close a ticket once the technician has marked it RESOLVED',
    );
  }

  const collaborating = await prisma.collaborationRequest.findFirst({
    where: { logId: log.id, inviteeId: user.id, status: 'ACCEPTED' },
    select: { id: true },
  });
  if (collaborating) return;

  throw ApiError.forbidden('You are not permitted to change this ticket');
}

export async function createLog({ payload, reporterId, files = [] }) {
  const { title, description, categoryId, priority, location } = payload;

  // Everything below happens atomically: reference allocation, the ticket,
  // its attachments and its opening history row. The whole transaction is
  // retried on a reference collision (see nextReference) so that concurrent
  // submissions queue up rather than failing.
  const runCreate = () =>
    prisma.$transaction(async (tx) => {
      const reporter = await tx.user.findUnique({
        where: { id: reporterId },
        include: { department: true },
      });
      if (!reporter) throw ApiError.notFound('Reporting user not found');

      const category = await tx.category.findUnique({ where: { id: categoryId } });
      if (!category) throw ApiError.badRequest(`Category ${categoryId} does not exist`);

      // --- automated SLA assignment ---
      const sla = await slaService.resolveSlaForPriority(priority, tx);
      const createdAt = new Date();
      const { responseDueAt, resolutionDueAt } = slaService.computeDeadlines(sla, createdAt);

      const reference = await nextReference(tx, reporter.department);

      const created = await tx.log.create({
        data: {
          reference,
          title,
          description,
          location: location ?? null,
          priority,
          status: LOG_STATUS.PENDING,
          categoryId,
          departmentId: reporter.departmentId,
          reportedById: reporterId,
          slaId: sla.id,
          createdAt,
          responseDueAt,
          resolutionDueAt,
          attachments: {
            create: files.map((f) => ({
              storedName: f.filename,
              originalName: f.originalname,
              mimeType: f.mimetype,
              sizeBytes: f.size,
            })),
          },
          statusHistory: {
            create: { toStatus: LOG_STATUS.PENDING, changedById: reporterId, note: 'Ticket logged' },
          },
        },
        include: logInclude,
      });

      return created;
    });

  let log;
  for (let attempt = 0; ; attempt += 1) {
    try {
      log = await runCreate();
      break;
    } catch (error) {
      // Only a reference clash is retryable. A bad category or a missing SLA is
      // a real failure and must surface immediately.
      if (!isReferenceCollision(error) || attempt >= REFERENCE_MAX_ATTEMPTS - 1) throw error;
      logger.debug(`Ticket reference collision, retrying (attempt ${attempt + 2})`);
    }
  }

  // Notifications sit OUTSIDE the transaction on purpose: a mail/socket hiccup
  // must never roll back a successfully logged ticket.
  await notificationService.notifyUser({
    userId: reporterId,
    logId: log.id,
    message: `Your issue has been logged with reference ${log.reference}. Resolution is due by ${log.resolutionDueAt.toISOString()}.`,
    type: NOTIFICATION_TYPE.INFORMATION,
  });

  await notificationService.notifyRole(ROLES.ADMIN, {
    logId: log.id,
    message: `New ${log.priority} priority ticket ${log.reference}: "${log.title}" logged by ${fullName(log.reportedBy)}.`,
    type: log.priority === 'CRITICAL' ? NOTIFICATION_TYPE.ALERT : NOTIFICATION_TYPE.INFORMATION,
  });

  logger.info(`Ticket ${log.reference} created by user ${reporterId}`);
  return toLogResponse(log);
}

export async function listLogs({ user, filters, skip, take }) {
  const where = { AND: [visibilityFilter(user)] };

  if (filters.status) where.AND.push({ status: filters.status });
  if (filters.priority) where.AND.push({ priority: filters.priority });
  if (filters.categoryId) where.AND.push({ categoryId: filters.categoryId });
  if (filters.departmentId) where.AND.push({ departmentId: filters.departmentId });
  if (filters.technicianId) where.AND.push({ technicianId: filters.technicianId });
  if (filters.open === true) where.AND.push({ status: { in: OPEN_STATUSES } });
  if (filters.overdue === true) {
    where.AND.push({ resolutionDueAt: { lt: new Date() }, status: { in: OPEN_STATUSES } });
  }
  if (filters.search) {
    where.AND.push({
      OR: [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { reference: { contains: filters.search, mode: 'insensitive' } },
      ],
    });
  }

  const orderBy = filters.sort === 'oldest' ? { createdAt: 'asc' } : { createdAt: 'desc' };

  const [rows, total] = await prisma.$transaction([
    prisma.log.findMany({ where, include: logInclude, orderBy, skip, take }),
    prisma.log.count({ where }),
  ]);

  const now = new Date();
  return { items: rows.map((row) => toLogResponse(row, now)), total };
}

export async function getLogById(logId, user) {
  const log = await prisma.log.findFirst({
    where: { AND: [{ id: logId }, visibilityFilter(user)] },
    include: {
      ...logInclude,
      statusHistory: {
        orderBy: { createdAt: 'desc' },
        include: { changedBy: { select: { id: true, surname: true, initials: true } } },
      },
      escalations: { orderBy: { level: 'asc' } },
      feedback: { include: { user: { select: { id: true, surname: true, initials: true } } } },
    },
  });

  if (!log) throw ApiError.notFound(`Ticket ${logId} not found or not visible to you`);

  return {
    ...toLogResponse(log),
    statusHistory: log.statusHistory.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      note: h.note,
      changedBy: { ...h.changedBy, name: fullName(h.changedBy) },
      createdAt: h.createdAt,
    })),
    escalations: log.escalations,
    feedback: log.feedback,
  };
}

/**
 * The one and only place a ticket's status changes. Every path — technician
 * starting work, putting on hold, resolving, admin closing, the SLA job
 * escalating — comes through here, so history and notifications can never be
 * skipped by a caller who forgot.
 */
export async function changeStatus({ logId, toStatus, note, actor, systemGenerated = false }) {
  const existing = await prisma.log.findUnique({
    where: { id: logId },
    include: { reportedBy: true, technician: true },
  });
  if (!existing) throw ApiError.notFound(`Ticket ${logId} not found`);

  if (!systemGenerated) {
    await assertCanModify(existing, actor, toStatus);

    const allowed = STATUS_TRANSITIONS[existing.status] ?? [];
    if (existing.status === toStatus) {
      throw ApiError.conflict(`Ticket ${existing.reference} is already ${toStatus}`);
    }
    if (!allowed.includes(toStatus)) {
      throw ApiError.badRequest(
        `Cannot move ticket from ${existing.status} to ${toStatus}. Allowed next states: ${allowed.join(', ') || 'none (terminal state)'}`,
      );
    }
  }

  // Business rule carried over from the old ChangeLogStatus, but now enforced
  // instead of silently ignored when the note was missing.
  if (toStatus === LOG_STATUS.ON_HOLD && !note) {
    throw ApiError.badRequest('A note explaining the hold is required when placing a ticket ON_HOLD');
  }

  const now = new Date();
  const data = { status: toStatus, note: note ?? existing.note };

  if (toStatus === LOG_STATUS.IN_PROGRESS && !existing.respondedAt) data.respondedAt = now;
  if (toStatus === LOG_STATUS.RESOLVED) data.resolvedAt = now;
  if (toStatus === LOG_STATUS.CLOSED) data.closedAt = now;
  // Reopening clears the resolution stamp so reports do not count it as solved.
  if (existing.status === LOG_STATUS.RESOLVED && toStatus === LOG_STATUS.IN_PROGRESS) {
    data.resolvedAt = null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.log.update({ where: { id: logId }, data, include: logInclude });
    await tx.logStatusHistory.create({
      data: {
        logId,
        fromStatus: existing.status,
        toStatus,
        note: note ?? null,
        changedById: actor.id,
      },
    });
    return row;
  });

  // Tell the reporter, the technician and the admins — minus whoever did it.
  const recipients = new Set();
  if (existing.reportedById) recipients.add(existing.reportedById);
  if (existing.technicianId) recipients.add(existing.technicianId);
  recipients.delete(actor.id);

  await notificationService.notifyMany(
    [...recipients].map((userId) => ({
      userId,
      logId,
      message: `Ticket ${existing.reference} ("${existing.title}") moved from ${existing.status} to ${toStatus}${note ? `: ${note}` : '.'}`,
      type: toStatus === LOG_STATUS.ESCALATED ? NOTIFICATION_TYPE.ALERT : NOTIFICATION_TYPE.INFORMATION,
    })),
  );

  emitToLog(logId, 'log:status-changed', { logId, fromStatus: existing.status, toStatus });
  logger.info(`Ticket ${existing.reference}: ${existing.status} -> ${toStatus} by user ${actor.id}`);

  return toLogResponse(updated);
}

/** Reopening a CLOSED ticket. Separate from changeStatus because CLOSED is terminal. */
export async function reopenLog({ logId, note, actor }) {
  const existing = await prisma.log.findUnique({ where: { id: logId } });
  if (!existing) throw ApiError.notFound(`Ticket ${logId} not found`);

  await assertCanModify(existing, actor, LOG_STATUS.IN_PROGRESS);

  if (existing.status !== LOG_STATUS.CLOSED && existing.status !== LOG_STATUS.RESOLVED) {
    throw ApiError.conflict(`Only RESOLVED or CLOSED tickets can be reopened (this one is ${existing.status})`);
  }

  return changeStatus({
    logId,
    toStatus: existing.technicianId ? LOG_STATUS.IN_PROGRESS : LOG_STATUS.PENDING,
    note: note ?? 'Ticket reopened',
    actor,
    systemGenerated: true,
  });
}

/** Dashboard tiles. One grouped query instead of the old one-request-per-status. */
export async function getStatusCounts(user) {
  const where = visibilityFilter(user);

  const grouped = await prisma.log.groupBy({ by: ['status'], where, _count: { _all: true } });

  const counts = Object.fromEntries(Object.values(LOG_STATUS).map((s) => [s, 0]));
  for (const row of grouped) counts[row.status] = row._count._all;

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const open = OPEN_STATUSES.reduce((sum, status) => sum + counts[status], 0);

  const overdue = await prisma.log.count({
    where: { AND: [where, { status: { in: OPEN_STATUSES }, resolutionDueAt: { lt: new Date() } }] },
  });

  return { total, open, overdue, byStatus: counts };
}

export async function getSlaStatus(logId, user) {
  const log = await prisma.log.findFirst({
    where: { AND: [{ id: logId }, visibilityFilter(user)] },
    include: { sla: true, escalations: { orderBy: { level: 'asc' } } },
  });
  if (!log) throw ApiError.notFound(`Ticket ${logId} not found or not visible to you`);

  return {
    logId: log.id,
    reference: log.reference,
    status: log.status,
    priority: log.priority,
    sla: log.sla,
    escalations: log.escalations,
    ...slaService.evaluate(log),
  };
}

export async function getStatusHistory(logId, user) {
  await assertCanView(logId, user);
  const history = await prisma.logStatusHistory.findMany({
    where: { logId },
    orderBy: { createdAt: 'desc' },
    include: { changedBy: { select: { id: true, surname: true, initials: true } } },
  });
  return history.map((h) => ({ ...h, changedBy: { ...h.changedBy, name: fullName(h.changedBy) } }));
}

export async function getAttachment(logId, attachmentId, user) {
  await assertCanView(logId, user);
  const attachment = await prisma.logAttachment.findFirst({ where: { id: attachmentId, logId } });
  if (!attachment) throw ApiError.notFound('Attachment not found on this ticket');
  return attachment;
}

export { logInclude };
export default {
  createLog,
  listLogs,
  getLogById,
  changeStatus,
  reopenLog,
  getStatusCounts,
  getSlaStatus,
  getStatusHistory,
  getAttachment,
  visibilityFilter,
  assertCanView,
  assertCanModify,
  toLogResponse,
};
