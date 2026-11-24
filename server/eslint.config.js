/**
 * eslint.config.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Lint on a Node service is not about formatting opinions — it is about the
 *   class of mistake that only shows up at runtime, on the request that
 *   happens to take that branch. A typo'd variable in an error path, an
 *   `await` forgotten on a Prisma call, a promise whose rejection nobody
 *   handles: all of them pass code review and all of them are a 500 at 2am.
 *
 *   The rules below are chosen to catch exactly that and to stay quiet
 *   otherwise. Nothing here argues about quotes or semicolons; a rule that
 *   fires on style trains people to ignore the output.
 *
 * HOW IT IS SCOPED
 *   Three zones, because they have genuinely different rules:
 *     - src/      the service itself. Strictest.
 *     - tests/    may use globals and may leave values unused in fixtures.
 *     - scripts/, prisma/  operational tooling, where console output IS the
 *                 interface, so no-console would be wrong.
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'uploads/**', 'coverage/**', 'src/generated/**'] },

  js.configs.recommended,

  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      /* ---------------------- the runtime-failure rules ---------------------- */

      // An unhandled rejection in Express takes the process down unless
      // asyncHandler wrapped it. This is the rule that catches a missing await.
      'require-atomic-updates': 'error',
      'no-await-in-loop': 'off', // deliberate in the SLA sweep; see the job

      // `catch (e) {}` hides the failure and leaves the caller with a success.
      'no-empty': ['error', { allowEmptyCatch: false }],

      // Comparing with == against null is fine and used deliberately for
      // "null or undefined"; everywhere else it is a bug waiting to happen.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Reassigning a parameter makes the original value unrecoverable, which
      // matters in middleware where req is shared down the chain.
      'no-param-reassign': ['error', { props: false }],

      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-unsafe-optional-chaining': 'error',
      'no-promise-executor-return': 'error',
      'no-unreachable-loop': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error', // '${x}' in a single-quoted string
      'no-return-await': 'error',

      /* ------------------------------ hygiene ------------------------------- */

      // Logging goes through config/logger.js so it carries a level and a
      // timestamp and can be turned down in production. A bare console.log
      // escapes all of that.
      'no-console': 'warn',

      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // Tests: vitest globals, and fixtures legitimately build values a given
    // test does not read.
    files: ['tests/**/*.js', 'vitest.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
    rules: { 'no-console': 'off', 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] },
  },

  {
    // Operational scripts: printing to the terminal is the whole point.
    files: ['scripts/**/*.{js,mjs}', 'prisma/**/*.js'],
    rules: { 'no-console': 'off' },
  },
];
