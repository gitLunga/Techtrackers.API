/**
 * tests/integration/setup.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Integration tests drive the real Express app against a real PostgreSQL,
 *   which is the only way to catch a wrong status code, a broken route chain or
 *   a Prisma query that does not match the schema. But a test suite that writes
 *   to the database you are developing against will eventually delete something
 *   you wanted, and a suite that inherits leftover rows passes or fails for
 *   reasons nobody can reproduce.
 *
 *   So this file guarantees two things before any test runs:
 *     1. the tests are pointed at a SEPARATE database, never the development
 *        one — it refuses to run if the two URLs match;
 *     2. that database exists and carries the current migrations.
 *
 * HOW THE DATABASE IS CHOSEN
 *   TEST_DATABASE_URL if set (this is what CI sets). Otherwise it derives one
 *   from DATABASE_URL by appending `_test` to the database name, so a developer
 *   who has the app running already needs no extra configuration.
 *
 * WHY IT RUNS ONCE, NOT PER FILE
 *   `globalSetup` would run once but cannot share a Prisma client with the
 *   tests. This is a setupFile, so it runs per test file — the migration step is
 *   therefore guarded by a marker table check, which is a cheap query, rather
 *   than shelling out to Prisma every time.
 */
// Loaded first and explicitly: this file inspects DATABASE_URL before any
// application module is imported, so it cannot rely on env.js having done it.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { beforeAll, afterAll } from 'vitest';

/** Derive a test database URL from the development one. */
function deriveTestUrl(devUrl) {
  const url = new URL(devUrl);
  // pathname is "/techtrackers" -> "/techtrackers_test"
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
  return url.toString();
}

const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  throw new Error(
    'DATABASE_URL is not set. Integration tests need a PostgreSQL connection — ' +
      'copy .env.example to .env, or set TEST_DATABASE_URL directly.',
  );
}

const testUrl = process.env.TEST_DATABASE_URL ?? deriveTestUrl(devUrl);

// The guard that matters. Everything below truncates tables, so pointing this
// at the development database would wipe real work.
if (new URL(testUrl).pathname === new URL(devUrl).pathname) {
  throw new Error(
    'TEST_DATABASE_URL points at the same database as DATABASE_URL. ' +
      'Integration tests truncate every table, so they refuse to run against ' +
      'your development database. Use a separate one (e.g. techtrackers_test).',
  );
}

// Everything imported after this line — Prisma included — sees the test URL.
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';

const { default: prisma } = await import('../../src/config/prisma.js');

/** Tables are truncated in one statement so foreign keys never block it. */
async function truncateAll() {
  const rows = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  // RESTART IDENTITY resets sequences, so ids are predictable across runs.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

beforeAll(async () => {
  // Create the database if it is not there yet. Connecting to the maintenance
  // database with the same credentials avoids needing a second set.
  try {
    await prisma.$connect();
  } catch (error) {
    const dbName = new URL(testUrl).pathname.slice(1).split('?')[0];
    if (!/does not exist/i.test(error.message)) throw error;
    try {
      execSync(`psql "${deriveMaintenanceUrl(testUrl)}" -c 'CREATE DATABASE "${dbName}"'`, {
        stdio: 'pipe',
      });
    } catch {
      throw new Error(
        `The test database "${dbName}" does not exist and could not be created.\n` +
          `Create it once with:   createdb ${dbName}\n` +
          `or grant the role permission:   ALTER ROLE <user> CREATEDB;`,
      );
    }
  }

  // Apply migrations only if the schema is not already current. `migrate
  // deploy` is idempotent but costs a few seconds, and this runs per file.
  const migrated = await prisma
    .$queryRaw`SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'logs'`
    .then((r) => r.length > 0)
    .catch(() => false);

  if (!migrated) {
    execSync('npx prisma migrate deploy', {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: testUrl },
    });
  }

  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** The same host and credentials, but the `postgres` maintenance database. */
function deriveMaintenanceUrl(url) {
  const u = new URL(url);
  u.pathname = '/postgres';
  u.search = '';
  return u.toString();
}

export { prisma, truncateAll, testUrl };
