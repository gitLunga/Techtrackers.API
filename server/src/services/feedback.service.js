/**
 * src/services/feedback.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   FeedbackController.cs wrote straight to the DbContext with no rules at all:
 *   any user id could rate any ticket, any number of times, with any integer
 *   rating. Because technician performance scores are averaged from this table,
 *   a single user could post 1000 five-star rows and invent a perfect record.
 *
 * WHAT IT ACHIEVES
 *   Feedback with the constraints that make the performance report trustworthy:
 *     - only the person who REPORTED the ticket may rate it;
 *     - only once (enforced by a unique index, not just a check);
 *     - only after the work is RESOLVED or CLOSED;
 *     - rating constrained to 1..5.
 *   The assigned technician is notified so good work is visible.
 */
import prisma from '../config/prisma.js';
import ApiError from '../utils/ApiError.js';
import { LOG_STATUS, NOTIFICATION_TYPE, ROLES } from '../constants/index.js';
import * as notificationService from './notification.service.js';

export async function submitFeedback({ logId, rating, comments, user }) {
  const log = await prisma.log.findUnique({ where: { id: logId } });
  if (!log) throw ApiError.notFound(`Ticket ${logId} not found`);

  if (log.reportedById !== user.id) {
    throw ApiError.forbidden('Only the person who reported this ticket can leave feedback on it');
  }
  if (log.status !== LOG_STATUS.RESOLVED && log.status !== LOG_STATUS.CLOSED) {
    throw ApiError.conflict(
      `Feedback can only be given once the ticket is RESOLVED or CLOSED (this one is ${log.status})`,
    );
  }

  const existing = await prisma.feedback.findFirst({ where: { logId, userId: user.id } });
  if (existing) throw ApiError.conflict('You have already given feedback on this ticket');

  const feedback = await prisma.feedback.create({
    data: { logId, userId: user.id, rating, comments: comments ?? null },
    include: { user: { select: { id: true, surname: true, initials: true } } },
  });

  if (log.technicianId) {
    await notificationService.notifyUser({
      userId: log.technicianId,
      logId,
      message: `You received ${rating}/5 feedback on ticket ${log.reference}${comments ? `: "${comments}"` : '.'}`,
      type: rating >= 4 ? NOTIFICATION_TYPE.INFORMATION : NOTIFICATION_TYPE.WARNING,
    });
  }

  return feedback;
}

export async function getFeedbackForLog(logId, user) {
  const log = await prisma.log.findUnique({ where: { id: logId } });
  if (!log) throw ApiError.notFound(`Ticket ${logId} not found`);

  const mayView =
    log.reportedById === user.id ||
    log.technicianId === user.id ||
    user.roles.some((r) => [ROLES.ADMIN, ROLES.HOD].includes(r));
  if (!mayView) throw ApiError.forbidden('You cannot view feedback on this ticket');

  return prisma.feedback.findMany({
    where: { logId },
    include: { user: { select: { id: true, surname: true, initials: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

/** Aggregate rating for one technician, including the star distribution. */
export async function getTechnicianRating(technicianId) {
  const rows = await prisma.feedback.findMany({
    where: { log: { technicianId } },
    select: { rating: true },
  });

  if (rows.length === 0) {
    return { technicianId, averageRating: null, totalRatings: 0, distribution: {} };
  }

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const row of rows) {
    distribution[row.rating] = (distribution[row.rating] ?? 0) + 1;
    sum += row.rating;
  }

  return {
    technicianId,
    averageRating: Math.round((sum / rows.length) * 10) / 10,
    totalRatings: rows.length,
    distribution,
  };
}

export default { submitFeedback, getFeedbackForLog, getTechnicianRating };
