
/**
 * src/server.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The other half of Program.cs: `app.Run()` — binding the port and managing
 *   the process lifecycle. Keeping it apart from app.js means the Express app
 *   can be imported and tested without ever opening a socket.
 *
 * WHAT IT ACHIEVES
 *   1. Verifies the database is reachable BEFORE accepting traffic, so a
 *      misconfigured DATABASE_URL fails at boot with a clear message instead of
 *      as a 500 on the first request.
 *   2. Attaches Socket.IO to the same HTTP server (one port for REST and
 *      websockets, as SignalR did).
 *   3. Starts the SLA monitor — the replacement for AddHostedService<SLAMonitoringService>().
 *   4. GRACEFUL SHUTDOWN. On SIGTERM (every container orchestrator sends this
 *      on deploy) it stops accepting new connections, lets in-flight requests
 *      finish, then closes the DB pool. Without this, a deploy kills requests
 *      mid-transaction. The old app had no shutdown handling at all.
 *   5. Last-resort handlers for unhandled rejections and uncaught exceptions, so
 *      a crash is logged rather than vanishing silently.
 */
import http from 'node:http';
import { createApp } from './app.js';
import env from './config/env.js';
import logger from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/prisma.js';
import { createSocketServer } from './realtime/socket.js';
import { startSlaMonitor, stopSlaMonitor } from './jobs/slaMonitor.job.js';

async function bootstrap() {
  try {
    await connectDatabase();
    logger.info('Database connection established');
  } catch (error) {
    logger.error(`Could not connect to the database: ${error.message}`);
    logger.error('Check DATABASE_URL in .env, and that PostgreSQL is running.');
    process.exit(1);
  }

  const app = createApp();
  const server = http.createServer(app);

  createSocketServer(server);
  startSlaMonitor();

  server.listen(env.PORT, () => {
    logger.info(`Techtrackers API listening on http://localhost:${env.PORT}`);
    logger.info(`   API base:      http://localhost:${env.PORT}${env.API_PREFIX}`);
    logger.info(`   Health check:  http://localhost:${env.PORT}/health`);
    logger.info(`   Environment:   ${env.NODE_ENV}`);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    stopSlaMonitor();

    server.close(async () => {
      await disconnectDatabase();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Backstop: if connections refuse to drain within 10s, exit anyway rather
    // than hanging the deploy forever.
    setTimeout(() => {
      logger.error('Could not close connections in time — forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled promise rejection: ${reason}`);
  });

  process.on('uncaughtException', (error) => {
    // The process state is unknown after this point; log and let the supervisor
    // restart us rather than continuing in a corrupt state.
    logger.error(`Uncaught exception: ${error.message}`, { stack: error.stack });
    process.exit(1);
  });
}

bootstrap();
