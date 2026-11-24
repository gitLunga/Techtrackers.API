/**
 * scripts/concurrency-check.mjs
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Postman and Newman fire requests SEQUENTIALLY, so they cannot catch a race.
 *   The ticket-reference allocator had one: it read the department's last
 *   reference and then wrote the next, and two submissions in the same instant
 *   computed the same number. The unique index kept the data correct, but the
 *   loser's transaction aborted — 10 simultaneous submissions produced 3
 *   tickets and 7 rejections, each telling a real user their issue could not be
 *   logged.
 *
 *   The fix is a `SELECT ... FOR UPDATE` row lock per department in
 *   log.service.js -> nextReference(). This script is the regression test for
 *   it, and it must stay in the suite: the bug is invisible to every other test
 *   we have, and easy to reintroduce by "optimising away" the lock.
 *
 * WHAT IT CHECKS
 *   1. Every concurrent submission succeeds  (no spurious 409s)
 *   2. No two tickets share a reference      (correctness)
 *   3. References are GAPLESS per department (a missing HR-0014 looks like a
 *      lost ticket to whoever is quoted it)
 *   4. Departments do not block each other   (the lock is per-department)
 *
 * RUN IT WITH:  npm run check:concurrency        (API must be running)
 */
const BASE = process.env.API_URL ?? 'http://localhost:5000/api/v1';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Password123';
const N = Number(process.env.CONCURRENCY ?? 10);

let failures = 0;
const check = (label, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

async function login(email) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`Could not sign in as ${email}: ${body.message}`);
  return body.data.accessToken;
}

const createTicket = (token, categoryId, i) =>
  fetch(`${BASE}/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: `Concurrency regression probe ${i}`,
      description: 'Submitted simultaneously to verify reference allocation is serialised.',
      categoryId,
      priority: 'LOW',
    }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

/** Sequence numbers of one department's references, ascending. */
const sequences = (refs, code) =>
  refs.filter((r) => r.startsWith(`${code}-`))
      .map((r) => Number(r.split('-').pop()))
      .sort((a, b) => a - b);

const gapCount = (seq) => seq.slice(1).filter((v, i) => v !== seq[i] + 1).length;

async function main() {
  console.log(`\nConcurrency check — ${N} simultaneous submissions per department\n`);

  // Two users in DIFFERENT departments, so we also prove the lock is scoped.
  const [tokenA, tokenB] = await Promise.all([
    login('staff@techtrackers.local'),   // HR
    login('admin@techtrackers.local'),   // ICT
  ]);

  const cats = await (await fetch(`${BASE}/categories`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })).json();
  const categoryId = cats.data[0].id;

  const startedAt = Date.now();
  const results = await Promise.all([
    ...Array.from({ length: N }, (_, i) => createTicket(tokenA, categoryId, i)),
    ...Array.from({ length: N }, (_, i) => createTicket(tokenB, categoryId, i)),
  ]);
  const elapsed = Date.now() - startedAt;

  const created = results.filter((r) => r.status === 201);
  const rejected = results.filter((r) => r.status !== 201);
  const refs = created.map((r) => r.body.data.reference);

  console.log(`  ${created.length}/${results.length} succeeded in ${elapsed}ms\n`);

  check(
    'every concurrent submission succeeded',
    rejected.length === 0,
    rejected.length ? `${rejected.length} rejected, first: ${rejected[0].body?.message}` : '',
  );

  const duplicates = refs.filter((v, i, a) => a.indexOf(v) !== i);
  check('no duplicate references issued', duplicates.length === 0, duplicates.join(', '));

  // Each department's newly issued block must be contiguous.
  for (const code of ['HR', 'ICT']) {
    const seq = sequences(refs, code);
    if (seq.length === 0) continue;
    check(
      `${code} references are gapless`,
      gapCount(seq) === 0,
      `${code}-${String(seq[0]).padStart(4, '0')}..${code}-${String(seq.at(-1)).padStart(4, '0')}, ${gapCount(seq)} gap(s)`,
    );
  }

  // Per-department locking means 2N tickets should not take twice as long as N.
  check('departments did not serialise against each other', elapsed < 5000, `${elapsed}ms`);

  console.log(`\n${failures === 0 ? 'All concurrency checks passed.' : `${failures} check(s) FAILED.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nConcurrency check could not run: ${error.message}`);
  console.error('Is the API running (npm run dev) and the database seeded (npm run db:seed)?\n');
  process.exit(1);
});
