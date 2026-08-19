/**
 * src/config/prisma.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   This is the Node equivalent of `TechTrackersDbContext` registered in
 *   Program.cs with `builder.Services.AddDbContext<...>()`.
 *
 *   Important difference: EF Core registers the DbContext as SCOPED — a fresh
 *   one per HTTP request, because it tracks entity state. PrismaClient is
 *   stateless and owns a connection POOL, so the correct pattern is the
 *   opposite: exactly ONE instance for the whole process, shared by every
 *   request. Creating one per request would exhaust Postgres connections
 *   within seconds under load.
 *
 * WHAT IT ACHIEVES
 *   - Exports that single shared client, imported by every service.
 *   - Survives `node --watch` hot reloads by caching on globalThis; without
 *     this, each reload in dev leaks another pool until Postgres refuses
 *     connections ("too many clients already").
 *   - Exposes connect/disconnect used by the graceful-shutdown path.
 */
import { PrismaClient } from '@prisma/client';
import env from './env.js';

const createClient = () =>
  new PrismaClient({
    log: env.isDevelopment ? ['warn', 'error'] : ['error'],
  });

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.__techtrackersPrisma ?? createClient();

if (env.isDevelopment) globalForPrisma.__techtrackersPrisma = prisma;

export async function connectDatabase() {
  await prisma.$connect();
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}

export default prisma;
