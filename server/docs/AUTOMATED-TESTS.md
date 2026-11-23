# Testing Techtrackers

Four layers, each catching something the others structurally cannot. For the hand-driven
walk through every endpoint in Postman, see **[TESTING.md](TESTING.md)**; this page is about
the suites that run by themselves. Run them
all with `npm test`; run the fast ones constantly with `npm run test:unit`.

| Layer | Command | Needs | Time | Catches |
|---|---|---|---|---|
| Unit | `npm run test:unit` | nothing | ~1s | wrong logic in the SLA clock, the authorization rules, the lifecycle table |
| Integration | `npm run test:integration` | PostgreSQL | ~3s | wrong status codes, unwired checks, broken routes, Prisma queries that no longer match the schema |
| API suite | `npx newman run docs/Techtrackers.postman_collection.json --env-var baseUrl=http://localhost:5000` | the server running | ~6s | the whole surface, 104 requests and 193 assertions, in the order a real client uses it |
| Concurrency | `npm run check:concurrency` | the server running | <1s | the ticket-reference race, which only appears under simultaneous load |

CI runs all four on every push. See `.github/workflows/ci.yml`.

---

## Unit tests — `tests/unit/`

No database, no network, no clock of their own. They run in milliseconds, so
there is no reason not to run them on every save (`npm run test:watch`).

**`sla.evaluate.test.js`** covers `slaService.evaluate()`, the function that
decides whether a ticket is on track, late or breached, and what escalation
level it has earned. The background sweep acts on its answer and the UI renders
it, so a mistake here either chases tickets that are fine or stays silent on
ones that are not — and both failures are invisible until someone complains.

It is testable at all because `evaluate(log, now)` takes `now` as an argument
instead of calling `new Date()` itself. That one decision is what makes "what
happens four hours from now" an assertion rather than a wait. **Keep it that
way.**

**`authorization.test.js`** covers `visibilityFilter` (what a role can read) and
`assertCanModify` (what it can change), plus the `STATUS_TRANSITIONS` table.
Prisma is mocked, because what is being tested is the *decision*; the queries
themselves are proved by the integration tests.

### These tests were checked by breaking the code on purpose

A test that never fails proves nothing. Each suite was validated by mutating
the source and confirming the suite went red:

| Mutation | Result |
|---|---|
| escalation threshold `>=` → `>` | 3 tests failed |
| terminal states no longer suppress escalation | 2 failed |
| `percentConsumed` clamp removed | 1 failed |
| response breach ignores `respondedAt` | 1 failed |
| ticket deadline before its creation date | 1 failed |
| HOD department scope dropped from `assertCanModify` | 1 failed |
| HOD read filter unscoped to `{}` | 2 failed |
| staff fallback filter opened to `{}` | 3 failed |
| reporter allowed to resolve their own ticket | 4 failed |
| collaboration no longer requires `ACCEPTED` | 1 failed |
| `assertCanModify` short-circuited entirely | 9 failed |

If you add a test, do this to it. Break the thing it is meant to protect and
watch it fail; if it still passes, it is decoration.

---

## Integration tests — `tests/integration/`

These drive the real Express app with supertest against a real PostgreSQL.

**They never touch your development database.** `setup.js` points them at
`<your database>_test`, creates it, migrates it, and truncates it between
files — and refuses to start if that name ever resolves to the same database as
`DATABASE_URL`. Override with `TEST_DATABASE_URL` if you want it elsewhere.

First run creates the database automatically. If your PostgreSQL role is not
allowed to create databases you will get a message saying so; grant it once:

```sql
ALTER ROLE techtrackers CREATEDB;
```

**`log-lifecycle.test.js`** walks one ticket the whole way: staff log a fault →
HOD assigns → technician works and resolves → reporter closes. Then it checks
the audit trail recorded every step in order, that references are gapless, and
that validation rejects what it should.

**`authorization.test.js`** is the one to read if you read only one. The unit
tests prove the rules are right; this proves they are *wired in*. That is a
different failure, and it is the one that shipped: `PATCH /logs/:id/status`
had correct rules available and never called them, so any account could drive
any ticket by knowing its id. A unit test of the rules would have passed the
whole time.

**A failure in that file is an access-control hole, not a flaky test.**

### 403 and 404 mean different things here, deliberately

- **404** — you cannot see this ticket. Returned even though the ticket exists,
  because confirming existence is itself a disclosure. If this were 403 while
  `GET /logs/:id` returned 404, the pair of codes would let any account
  enumerate valid ticket ids.
- **403** — you can see this ticket and still may not do that to it. The
  reporter trying to mark their own fault RESOLVED is the case this is for.
- **422** — a field is invalid. Reports every bad field at once, so a form can
  mark them rather than show a banner.
- **400** — the request was well formed but names something that does not
  exist, or is JSON the parser could not read at all.

Tests assert on these exactly. Changing one is an API change.

---

## Writing a new integration test

```js
import { describe, it, expect, beforeAll } from 'vitest';
import { app, api, auth, request, seedBaseline, loginAll } from './fixtures.js';
import { truncateAll } from './setup.js';

let world, tokens;

beforeAll(async () => {
  await truncateAll();          // start from nothing
  world = await seedBaseline(); // roles, 2 departments, a category, SLAs, a user per role
  tokens = await loginAll(world.users); // real JWTs from the real /auth/login
});

it('does the thing', async () => {
  const res = await request(app).get(api('/logs')).set(auth(tokens.hod));
  expect(res.status).toBe(200);
});
```

`seedBaseline()` gives you `users.admin`, `.hod`, `.tech`, `.otherTech`,
`.staff` and `.otherStaff` — the last one is in a *different department*, which
is the control for every visibility assertion. Tokens come from the real login
route, so authentication is exercised as a side effect of setting anything up.

Files run sequentially, never in parallel: they share one database and would
otherwise delete each other's rows mid-assertion. That is `fileParallelism:
false` in `vitest.config.js`.

---

## The API suite and the concurrency check

Both need the server running (`npm run dev`) and the development data seeded
(`npm run db:seed`).

```bash
npm run db:seed
npm run dev        # in one terminal
npx newman run docs/Techtrackers.postman_collection.json --env-var baseUrl=http://localhost:5000
npm run check:concurrency
```

The collection is **re-runnable** — it creates its one user with a timestamped
email specifically so a second run does not collide with the first. It did
collide once, and the result was three requests silently sending the literal
`{{newUserId}}` and testing nothing.

The concurrency check fires 10 simultaneous submissions per department and
asserts every one succeeded with a gapless reference. It exists because the
original read-then-write allocation produced 3 tickets and 7 rejections out of
10. If you ever touch `nextReference`, run it.

---

## What is not covered yet

Honest gaps, in the order worth closing:

- **Business-hours SLA.** The clock is wall-clock: a ticket logged Friday at
  16:00 burns its whole weekend. Phase 3.
- **ON_HOLD does not stop the clock.** A ticket waiting on a part keeps
  escalating. Pinned by a test so the current behaviour is at least known.
- **The frontend has no tests.** Lint only.
- **Notifications, chat, feedback and reports** have Postman coverage but no
  integration tests.
