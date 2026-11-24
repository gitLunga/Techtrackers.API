/**
 * vitest.config.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Two kinds of test live in this repo and they have different needs:
 *
 *   UNIT tests exercise pure logic — the SLA clock, the visibility filter, the
 *   transition table. They touch no database, so they run anywhere in
 *   milliseconds and are the ones that should run on every save.
 *
 *   INTEGRATION tests drive the real Express app against a real PostgreSQL.
 *   They catch what unit tests structurally cannot — a wrong status code, a
 *   broken route chain, a Prisma query that does not match the schema — but
 *   they need a database and they are slower.
 *
 *   Splitting them by `projects` means `npm test` runs everything, while
 *   `npm run test:unit` stays instant and needs no infrastructure. CI can run
 *   unit tests on every push and integration tests behind a Postgres service.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Integration tests share one database. Running files in parallel would
    // let them delete each other's rows mid-assertion.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.js'],
          globals: true,
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.js'],
          globals: true,
          environment: 'node',
          setupFiles: ['tests/integration/setup.js'],
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
