/**
 * src/realtime/socket.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Replaces Hubs/ChatHub.cs and `app.MapHub<ChatHub>("/chatHub")`. The old hub
 *   had NO authentication — SignalR accepted any connection and its methods
 *   trusted whatever user id the caller sent, so anyone could join any ticket's
 *   conversation and post as anyone.
 *
 * WHAT IT ACHIEVES
 *   The SAME JWT that protects the REST API also protects the socket: the
 *   handshake is rejected without a valid token. Once connected, a client is
 *   joined to its own `user:<id>` room, which is how notifications reach exactly
 *   the right person and nobody else.
 *
 *   Joining a ticket room is authorised through chat.service.assertParticipant —
 *   the identical check the REST endpoint uses, so there is no weaker back door
 *   through the socket.
 */
import { Server } from 'socket.io';
import env from '../config/env.js';
import logger from '../config/logger.js';
import prisma from '../config/prisma.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { registerSocketServer } from './emitter.js';
import * as chatService from '../services/chat.service.js';

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
  });

  // Handshake gate: no valid token, no connection.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token ?? socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) return next(new Error('Authentication required'));

      const payload = verifyAccessToken(token);
      const user = await prisma.user.findUnique({
        where: { id: Number(payload.sub) },
        select: {
          id: true, surname: true, initials: true, isActive: true, departmentId: true,
          roles: { select: { role: { select: { name: true } } } },
        },
      });
      if (!user || !user.isActive) return next(new Error('Account not found or deactivated'));

      socket.user = {
        id: user.id,
        name: `${user.initials} ${user.surname}`.trim(),
        departmentId: user.departmentId,
        roles: user.roles.map((r) => r.role.name),
      };
      return next();
    } catch (error) {
      return next(new Error(`Authentication failed: ${error.message}`));
    }
  });

  io.on('connection', (socket) => {
    // Personal room: this is the address emitToUser() writes to.
    socket.join(`user:${socket.user.id}`);
    logger.debug(`Socket connected: ${socket.user.name} (${socket.id})`);

    // Opening a ticket subscribes you to its live chat and escalation events —
    // but only if you are actually a participant.
    socket.on('log:join', async (logId, ack) => {
      try {
        await chatService.assertParticipant(Number(logId), socket.user);
        socket.join(`log:${logId}`);
        ack?.({ success: true });
      } catch (error) {
        ack?.({ success: false, message: error.message });
      }
    });

    socket.on('log:leave', (logId) => socket.leave(`log:${logId}`));

    // Sending over the socket takes the SAME service path as POST /logs/:id/chat,
    // so the message is persisted, not just broadcast.
    socket.on('chat:send', async ({ logId, message }, ack) => {
      try {
        const saved = await chatService.sendMessage({
          logId: Number(logId),
          message,
          sender: socket.user,
        });
        ack?.({ success: true, data: saved });
      } catch (error) {
        ack?.({ success: false, message: error.message });
      }
    });

    socket.on('disconnect', () => logger.debug(`Socket disconnected: ${socket.id}`));
  });

  registerSocketServer(io);
  return io;
}

export default createSocketServer;
