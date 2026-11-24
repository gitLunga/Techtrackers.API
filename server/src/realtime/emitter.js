/**
 * src/realtime/emitter.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old stack used SignalR (Hubs/ChatHub.cs) for live chat. Socket.IO is the
 *   Node equivalent — but if services imported the Socket.IO server directly,
 *   every service would depend on the transport, and you could not run one
 *   (a script, a test, the SLA job) without booting an HTTP server.
 *
 * WHAT IT ACHIEVES
 *   A thin indirection: `socket.js` REGISTERS the live server here at startup;
 *   services only ever call `emitToUser(...)`. When no server is registered
 *   (CLI scripts, tests) the calls are silent no-ops instead of crashing.
 *   This is the same decoupling as injecting IHubContext<ChatHub> rather than
 *   newing up a hub.
 */
let io = null;

export function registerSocketServer(server) {
  io = server;
}

/** Rooms are named `user:<id>`; socket.js joins each client to its own room. */
export function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
}

/** Everyone currently viewing a given ticket. */
export function emitToLog(logId, event, payload) {
  if (!io || !logId) return;
  io.to(`log:${logId}`).emit(event, payload);
}

export default { registerSocketServer, emitToUser, emitToLog };
