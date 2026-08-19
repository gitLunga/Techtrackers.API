/**
 * src/controllers/chat.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Replaces LiveChatController.cs. It is deliberately nested under a ticket
 *   (/logs/:id/chat) because a chat message has no meaning without one — the
 *   old flat /api/LiveChat/SendMessage took the logId in the body and never
 *   checked the sender was involved in that ticket.
 *
 * WHAT IT ACHIEVES
 *   REST access to the same chat the Socket.IO connection serves. Both call
 *   chat.service.sendMessage, so a message posted here is broadcast live, and a
 *   message sent over the socket is persisted. In the old stack those two paths
 *   did not meet.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { created, paginated } from '../utils/apiResponse.js';
import getPagination from '../utils/pagination.js';
import * as chatService from '../services/chat.service.js';

export const sendMessage = asyncHandler(async (req, res) => {
  const message = await chatService.sendMessage({
    logId: req.params.id,
    message: req.body.message,
    sender: req.user,
  });
  return created(res, message, 'Message sent');
});

export const getMessages = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query);
  const { items, total } = await chatService.getMessages({
    logId: req.params.id,
    user: req.user,
    skip,
    take,
  });
  return paginated(res, items, { page, limit, total }, `${total} message(s)`);
});

export default { sendMessage, getMessages };
