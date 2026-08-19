/**
 * src/services/chat.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   LiveChatController.cs persisted messages and Hubs/ChatHub.cs broadcast them,
 *   but the two were unconnected: a message sent through the hub was never
 *   saved, and one saved through the controller was never broadcast. Refresh the
 *   page and half your conversation was gone. Nothing checked that the sender
 *   was involved in the ticket at all.
 *
 * WHAT IT ACHIEVES
 *   One path for a message: authorise -> persist -> broadcast. Whether it
 *   arrives over REST or over the socket, it takes this same path, so the
 *   database and the live feed can never disagree.
 */
import prisma from '../config/prisma.js';
import ApiError from '../utils/ApiError.js';
import { NOTIFICATION_TYPE, ROLES } from '../constants/index.js';
import { emitToLog } from '../realtime/emitter.js';
import * as notificationService from './notification.service.js';

/** Participants: reporter, assigned technician, accepted collaborators, admins. */
async function assertParticipant(logId, user) {
  const log = await prisma.log.findUnique({
    where: { id: logId },
    include: { collaborations: { where: { status: 'ACCEPTED' }, select: { inviteeId: true } } },
  });
  if (!log) throw ApiError.notFound(`Ticket ${logId} not found`);

  const allowed =
    log.reportedById === user.id ||
    log.technicianId === user.id ||
    log.collaborations.some((c) => c.inviteeId === user.id) ||
    user.roles.some((r) => [ROLES.ADMIN, ROLES.HOD].includes(r));

  if (!allowed) throw ApiError.forbidden('You are not a participant on this ticket');
  return log;
}

export async function sendMessage({ logId, message, sender }) {
  const log = await assertParticipant(logId, sender);

  const saved = await prisma.logChat.create({
    data: { logId, senderId: sender.id, message },
    include: { sender: { select: { id: true, surname: true, initials: true } } },
  });

  const payload = {
    ...saved,
    sender: { ...saved.sender, name: `${saved.sender.initials} ${saved.sender.surname}`.trim() },
  };

  // Live to anyone with the ticket open...
  emitToLog(logId, 'chat:message', payload);

  // ...and a notification for the other party, who may not have it open.
  const otherParty = sender.id === log.reportedById ? log.technicianId : log.reportedById;
  if (otherParty) {
    await notificationService.notifyUser({
      userId: otherParty,
      logId,
      message: `New message on ticket ${log.reference} from ${payload.sender.name}`,
      type: NOTIFICATION_TYPE.INFORMATION,
    });
  }

  return payload;
}

export async function getMessages({ logId, user, skip, take }) {
  await assertParticipant(logId, user);

  const [rows, total] = await prisma.$transaction([
    prisma.logChat.findMany({
      where: { logId },
      include: { sender: { select: { id: true, surname: true, initials: true } } },
      orderBy: { createdAt: 'asc' },
      skip,
      take,
    }),
    prisma.logChat.count({ where: { logId } }),
  ]);

  return {
    items: rows.map((m) => ({
      ...m,
      sender: { ...m.sender, name: `${m.sender.initials} ${m.sender.surname}`.trim() },
    })),
    total,
  };
}

export { assertParticipant };
export default { sendMessage, getMessages, assertParticipant };
