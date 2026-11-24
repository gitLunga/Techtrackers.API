/**
 * src/services/collaboration.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Collaboration lived entirely inside CollabController.cs — DbContext queries,
 *   email sending (via `new MailServices()` constructed inline), and validation
 *   all in the HTTP layer. There was also a dead CollaControllerB.cs stub.
 *
 * WHAT IT ACHIEVES
 *   Technician-to-technician collaboration as real business logic, with the
 *   rules the controller version was missing:
 *     - you cannot invite yourself (the old code happily allowed it);
 *     - the invitee must actually be a technician;
 *     - only the person INVITED may accept or decline. The old
 *       `PUT /Respond/{collaborationId}` took an id from the URL and no identity
 *       at all, so anyone could accept anyone else's invitation;
 *     - only the requester may cancel;
 *     - accepting grants the collaborator VIEW ACCESS to the ticket, which is
 *       honoured by log.service's visibilityFilter. In the old system accepting
 *       changed a status column and nothing else — collaborators still could not
 *       see the ticket they had agreed to help with.
 */
import prisma from '../config/prisma.js';
import ApiError from '../utils/ApiError.js';
import { COLLABORATION_STATUS, NOTIFICATION_TYPE, ROLES } from '../constants/index.js';
import * as notificationService from './notification.service.js';
import * as mailService from './mail.service.js';

const TECH_ROLES = [ROLES.TECHNICIAN, ROLES.EXTERNAL_TECHNICIAN];

const collaborationInclude = {
  log: { select: { id: true, reference: true, title: true, status: true, priority: true } },
  requester: { select: { id: true, surname: true, initials: true, email: true } },
  invitee: { select: { id: true, surname: true, initials: true, email: true } },
};

const withNames = (c) => ({
  ...c,
  requester: { ...c.requester, name: `${c.requester.initials} ${c.requester.surname}`.trim() },
  invitee: { ...c.invitee, name: `${c.invitee.initials} ${c.invitee.surname}`.trim() },
});

export async function requestCollaboration({ logId, inviteeId, message, requester }) {
  if (inviteeId === requester.id) {
    throw ApiError.badRequest('You cannot invite yourself to collaborate');
  }

  const [log, invitee] = await Promise.all([
    prisma.log.findUnique({ where: { id: logId } }),
    prisma.user.findUnique({
      where: { id: inviteeId },
      include: { roles: { include: { role: true } } },
    }),
  ]);

  if (!log) throw ApiError.notFound(`Ticket ${logId} not found`);
  if (!invitee) throw ApiError.notFound(`User ${inviteeId} not found`);
  if (!invitee.isActive) throw ApiError.badRequest('That user account is deactivated');

  const inviteeRoles = invitee.roles.map((r) => r.role.name);
  if (!inviteeRoles.some((r) => TECH_ROLES.includes(r))) {
    throw ApiError.badRequest('Collaborators must be technicians');
  }

  // Only someone actually working the ticket may pull others in.
  const isOwner = log.technicianId === requester.id;
  const isAdmin = requester.roles.includes(ROLES.ADMIN);
  if (!isOwner && !isAdmin) {
    throw ApiError.forbidden('Only the assigned technician (or an admin) can request collaboration');
  }

  const duplicate = await prisma.collaborationRequest.findFirst({
    where: { logId, inviteeId, status: COLLABORATION_STATUS.PENDING },
  });
  if (duplicate) {
    throw ApiError.conflict('A pending collaboration request for this technician already exists');
  }

  const collaboration = await prisma.collaborationRequest.create({
    data: { logId, requesterId: requester.id, inviteeId, message: message ?? null },
    include: collaborationInclude,
  });

  await notificationService.notifyUser({
    userId: inviteeId,
    logId,
    message: `${requester.name} has invited you to collaborate on ticket ${log.reference}: "${log.title}".`,
    type: NOTIFICATION_TYPE.ALERT,
  });

  await mailService.sendCollaborationInvite({
    to: invitee.email,
    inviteeName: `${invitee.initials} ${invitee.surname}`.trim(),
    requesterName: requester.name,
    logReference: log.reference,
    logTitle: log.title,
    message,
  });

  return withNames(collaboration);
}

export async function respondToCollaboration({ collaborationId, status, responder }) {
  const collaboration = await prisma.collaborationRequest.findUnique({
    where: { id: collaborationId },
    include: collaborationInclude,
  });
  if (!collaboration) throw ApiError.notFound(`Collaboration request ${collaborationId} not found`);

  // The check the old endpoint had no way to make: it never knew who was calling.
  if (collaboration.inviteeId !== responder.id) {
    throw ApiError.forbidden('Only the invited technician can respond to this request');
  }
  if (collaboration.status !== COLLABORATION_STATUS.PENDING) {
    throw ApiError.conflict(`This request has already been ${collaboration.status.toLowerCase()}`);
  }

  const updated = await prisma.collaborationRequest.update({
    where: { id: collaborationId },
    data: { status },
    include: collaborationInclude,
  });

  await notificationService.notifyUser({
    userId: collaboration.requesterId,
    logId: collaboration.logId,
    message: `${responder.name} ${status.toLowerCase()} your collaboration request on ticket ${collaboration.log.reference}.`,
    type: status === COLLABORATION_STATUS.ACCEPTED ? NOTIFICATION_TYPE.INFORMATION : NOTIFICATION_TYPE.WARNING,
  });

  return withNames(updated);
}

export async function cancelCollaboration({ collaborationId, actor }) {
  const collaboration = await prisma.collaborationRequest.findUnique({ where: { id: collaborationId } });
  if (!collaboration) throw ApiError.notFound(`Collaboration request ${collaborationId} not found`);
  if (collaboration.requesterId !== actor.id && !actor.roles.includes(ROLES.ADMIN)) {
    throw ApiError.forbidden('Only the requester can cancel this request');
  }
  if (collaboration.status !== COLLABORATION_STATUS.PENDING) {
    throw ApiError.conflict('Only pending requests can be cancelled');
  }

  return prisma.collaborationRequest.update({
    where: { id: collaborationId },
    data: { status: COLLABORATION_STATUS.CANCELLED },
    include: collaborationInclude,
  });
}

/**
 * Everything involving this user, in either direction. The old API needed two
 * separate endpoints (/Pending/{id} and /List/{id}) that each took the
 * technician id from the URL — so you could read anyone's collaborations.
 * Here the user comes from the token and `direction` is a filter.
 */
export async function listCollaborations({ user, status, direction = 'all', skip, take }) {
  const where = {};

  if (direction === 'incoming') where.inviteeId = user.id;
  else if (direction === 'outgoing') where.requesterId = user.id;
  else where.OR = [{ inviteeId: user.id }, { requesterId: user.id }];

  if (status) where.status = status;

  const [items, total] = await prisma.$transaction([
    prisma.collaborationRequest.findMany({
      where,
      include: collaborationInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.collaborationRequest.count({ where }),
  ]);

  return { items: items.map(withNames), total };
}

export default {
  requestCollaboration,
  respondToCollaboration,
  cancelCollaboration,
  listCollaborations,
};
