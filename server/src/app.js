/**
 * src/app.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   This is Program.cs's `builder.Services...` + middleware pipeline half —
 *   assembling the Express application and deciding the ORDER things run in.
 *
 *   It is deliberately SEPARATE from server.js (which owns the network socket).
 *   Because `app` is exported without ever calling `.listen()`, tests can drive
 *   the whole API in-process with supertest, and no port is occupied.
 *
 * WHAT IT ACHIEVES — AND WHY THE ORDER MATTERS
 *   Express middleware runs top to bottom. This order is not arbitrary:
 *     1. helmet         security headers before anything can respond
 *     2. cors           preflight must be answered before auth rejects it,
 *                       otherwise the browser reports a CORS error instead of 401
 *     3. body parsers    populate req.body before any validator reads it
 *     4. logging        so even rejected requests are recorded
 *     5. rate limiting  cheap rejection before touching the database
 *     6. health         must answer even when the DB is down
 *     7. routes         the actual API
 *     8. notFound       nothing matched
 *     9. errorHandler   LAST — Express only treats a 4-arg function as an error
 *                       handler, and only sees errors raised ABOVE it
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import env from './config/env.js';
import logger from './config/logger.js';
import prisma from './config/prisma.js';
import routes from './routes/index.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';

export function createApp() {
  const app = express();

  // Behind a reverse proxy (nginx, Render, Railway) this makes req.ip the real
  // client address, which the rate limiter depends on to key its buckets.
  app.set('trust proxy', 1);

  // 1. Security headers. crossOriginResourcePolicy is relaxed so a browser on
  //    localhost:3000 can render attachment images served from localhost:5000.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // 2. CORS — the Node equivalent of the old "corspolicy". Origins come from
  //    the environment rather than being hard-coded as they were in Program.cs.
  app.use(
    cors({
      origin(origin, callback) {
        // Requests with no Origin header (Postman, curl, server-to-server) are
        // not browser requests and are not subject to CORS.
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
    }),
  );

  // 3. Body parsing. The limit stops a giant JSON payload exhausting memory.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(compression());

  // 4. Request logging.
  if (env.NODE_ENV !== 'test') {
    app.use(morgan(env.isProduction ? 'combined' : 'dev', {
      stream: { write: (line) => logger.debug(line.trim()) },
    }));
  }

  // 5. Blanket rate limit.
  app.use(globalLimiter);

  /**
   * 6. Health check. Mounted BEFORE the routers and outside the API prefix so
   *    a load balancer can probe it without auth. It reports 503 when the
   *    database is unreachable, which is what makes it a real readiness check
   *    rather than "is the process alive".
   */
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        success: true,
        status: 'healthy',
        database: 'connected',
        environment: env.NODE_ENV,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({ success: false, status: 'unhealthy', database: 'disconnected', error: error.message });
    }
  });

  // 7. The API itself, under a versioned prefix (/api/v1) so a future v2 can
  //    live alongside it instead of breaking existing clients.
  app.use(env.API_PREFIX, routes);

  // 8 & 9. Must be last, in this order.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
