/**
 * src/services/notification.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   In the old code, notification creation was COPY-PASTED into every service
 *   that needed it: LogService built one for the staff member and looped over
 *   admins; ManageLogsService had a near-identical private NotifyUsersOnStatusChange;
 *   AssignTechnicianService had its own; SLAMonitoringService had another.
 *   Four separate implementations of "insert a row into Notifications", each
 *   with its own bugs (some forgot ReadStatus, some saved per-row in a loop).
 *
 * WHAT IT ACHIEVES
 *   ONE module owns notifications. Everything else calls `notifyUser` /
 *   `notifyRole`. Consequences:
 *     - Adding real-time push (Socket.IO) or email digests is a change HERE,
 *       and every existing notification gains it for free.
 *     - `notifyMany` inserts in a single `createMany` instead of N round-trips
 *       inside a loop (the old admin-notification loop did one INSERT + one
 *       SaveChangesAsync per admin).
 */
import prisma from '../config/prisma.js';
import logger from '../config/logger.js';
import { NOTIFICATION_TYPE } from '../constants/index.js';
import { emitToUser } from '../realtime/emitter.js';
import * as pushService from './push.service.js';

/** Browser push only reaches someone who isn't looking at an open tab. */
function pushInBackground(userId, logId, message) {
  pushService
    .sendPushToUser(userId, { title: 'Techtrackers', body: message, url: logId ? `/tickets/${logId}` : '/' })
    .catch((error) => logger.error(`Push notification failed for user ${userId}: ${error.message}`));
}

/** Create one notification and push it live to the recipient if connected. */
export async function notifyUser({ userId, logId = null, message, type = NOTIFICATION_TYPE.INFORMATION }) {
  if (!userId) return null;

  const notification = await prisma.notification.create({
    data: { userId, logId, message, type },
  });

  emitToUser(userId, 'notification:new', notification);
  pushInBackground(userId, logId, message);
  return notification;
}

/** Bulk insert — one statement, regardless of how many recipients. */
export async function notifyMany(recipients) {
  const rows = recipients.filter((r) => r.userId);
  if (rows.length === 0) return { count: 0 };

  const result = await prisma.notification.createMany({
    data: rows.map((r) => ({
      userId: r.userId,
      logId: r.logId ?? null,
      message: r.message,
      type: r.type ?? NOTIFICATION_TYPE.INFORMATION,
    })),
  });

  for (const r of rows) {
    emitToUser(r.userId, 'notification:new', r);
    pushInBackground(r.userId, r.logId, r.message);
  }
  return result;
}

/** Notify everyone holding a role — e.g. "tell all admins a ticket was logged". */
export async function notifyRole(roleName, { logId = null, message, type = NOTIFICATION_TYPE.INFORMATION }) {
  const users = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { name: roleName } } } },
    select: { id: true },
  });

  if (users.length === 0) {
    logger.warn(`notifyRole: no active users hold the role ${roleName}`);
    return { count: 0 };
  }

  return notifyMany(users.map((u) => ({ userId: u.id, logId, message, type })));
}

/** Notify the head(s) of a department — used by SLA escalation at level 3. */
export async function notifyDepartmentHeads(departmentId, payload) {
  const heads = await prisma.user.findMany({
    where: { departmentId, isActive: true, roles: { some: { role: { name: 'HOD' } } } },
    select: { id: true },
  });
  return notifyMany(heads.map((h) => ({ userId: h.id, ...payload })));
}

export async function listForUser(userId, { skip, take, unreadOnly = false }) {
  const where = { userId, ...(unreadOnly ? { isRead: false } : {}) };

  const [items, total, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { log: { select: { id: true, reference: true, title: true, status: true } } },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return { items, total, unreadCount };
}

export async function getUnreadCount(userId) {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

/**
 * Marking as read is scoped by userId as well as id — otherwise anyone could
 * mark anyone else's notifications read by guessing an id. `updateMany`
 * returns count 0 rather than throwing when the row is not theirs.
 */
export async function markAsRead(notificationId, userId) {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
  return result.count > 0;
}

export async function markAllAsRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
  return result.count;
}

export default {
  notifyUser,
  notifyMany,
  notifyRole,
  notifyDepartmentHeads,
  listForUser,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
};
