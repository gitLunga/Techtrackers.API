/**
 * src/services/audit.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   LogStatusHistory answers "what happened to this ticket". Nothing answered
 *   "what did an admin do to the SYSTEM" — who created/deactivated a user, who
 *   edited an SLA target. Those actions were previously invisible outside the
 *   `logger.info` lines already scattered around, which aren't queryable and
 *   aren't attributed to an actor in a structured way.
 *
 * WHAT IT ACHIEVES
 *   One call site, `recordAction`, used by every admin-mutation service.
 *   Best-effort and non-blocking — same principle already used for
 *   notifications in log.service.js: a logging failure must never roll back
 *   or fail an admin action that otherwise succeeded.
 */
import prisma from '../config/prisma.js';
import logger from '../config/logger.js';

export async function recordAction({ actorId, action, targetType, targetId = null, metadata = null }) {
  try {
    await prisma.auditLog.create({
      data: { actorId, action, targetType, targetId, metadata: metadata ?? undefined },
    });
  } catch (error) {
    logger.error(`Failed to record audit log for action "${action}": ${error.message}`);
  }
}

export async function listAuditLogs({ filters = {}, skip, take }) {
  const where = {};
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.targetType) where.targetType = filters.targetType;
  if (filters.action) where.action = { contains: filters.action, mode: 'insensitive' };
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: new Date(filters.to) } : {}),
    };
  }

  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, surname: true, initials: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      ...row,
      actor: row.actor ? { ...row.actor, name: `${row.actor.initials} ${row.actor.surname}`.trim() } : null,
    })),
    total,
  };
}

export default { recordAction, listAuditLogs };
