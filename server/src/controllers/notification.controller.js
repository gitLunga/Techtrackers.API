/**
 * src/controllers/notification.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old system had THREE notification controllers — NotificationController
 *   (whose only live method returned a hard-coded string), NewNotificationController,
 *   and a GetNotifications action bolted onto LogController — because nobody
 *   could tell which one was current.
 *
 * WHAT IT ACHIEVES
 *   One controller. Every route is implicitly scoped to `req.user.id`: there is
 *   no way to ask for someone else's notifications, because no endpoint takes a
 *   user id. The old `GET /{userId}/staged` took one from the URL.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { ok, paginated } from '../utils/apiResponse.js';
import ApiError from '../utils/ApiError.js';
import getPagination from '../utils/pagination.js';
import * as notificationService from '../services/notification.service.js';

export const list = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query);
  const { items, total, unreadCount } = await notificationService.listForUser(req.user.id, {
    skip,
    take,
    unreadOnly: req.query.unreadOnly === true,
  });
  return res.status(200).json({
    success: true,
    message: `${total} notification(s)`,
    data: items,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), unreadCount },
  });
});

export const unreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.getUnreadCount(req.user.id);
  return ok(res, { unreadCount: count }, 'Unread count retrieved');
});

export const markAsRead = asyncHandler(async (req, res) => {
  const updated = await notificationService.markAsRead(req.params.id, req.user.id);
  // updateMany matched nothing => the notification is not this user's (or does
  // not exist). Reporting 404 either way avoids confirming that it exists.
  if (!updated) throw ApiError.notFound('Notification not found');
  return ok(res, null, 'Notification marked as read');
});

export const markAllAsRead = asyncHandler(async (req, res) => {
  const count = await notificationService.markAllAsRead(req.user.id);
  return ok(res, { updated: count }, `${count} notification(s) marked as read`);
});

export default { list, unreadCount, markAsRead, markAllAsRead };
