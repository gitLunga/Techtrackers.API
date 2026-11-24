/**
 * tests/integration/log-lifecycle.test.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   This is the path every ticket in the system takes: a staff member logs a
 *   fault, an HOD assigns it, a technician works it, the reporter confirms the
 *   fix. If that sequence breaks, the product does not work — no amount of unit
 *   coverage elsewhere compensates.
 *
 *   It runs against the real Express app and a real PostgreSQL, so it covers
 *   what unit tests structurally cannot: the route chain, the validation
 *   middleware, the status codes, the Prisma queries, the SLA deadlines
 *   actually being written, and the history trail accumulating as it goes.
 *
 * HOW TO READ IT
 *   The first block walks the happy path in order, each test depending on the
 *   one before it — deliberately, because the thing being tested IS the
 *   sequence. The later blocks are independent and assert the rules that
 *   protect it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { app, api, auth, request, prisma, seedBaseline, loginAll } from './fixtures.js';
import { LOG_STATUS } from '../../src/constants/index.js';
import { truncateAll } from './setup.js';

let world;
let tokens;

beforeAll(async () => {
  await truncateAll();
  world = await seedBaseline();
  tokens = await loginAll(world.users);
});

describe('the full ticket lifecycle', () => {
  // Shared across the sequence: each step acts on the ticket the last one left.
  let ticketId;
  let reference;

  it('a staff member logs a fault', async () => {
    const res = await request(app)
      .post(api('/logs'))
      .set(auth(tokens.staff))
      .field('title', 'Projector in Lecture Hall 3 will not power on')
      .field('description', 'No lights on the unit. Checked the wall socket with another device.')
      .field('categoryId', String(world.category.id))
      .field('priority', 'HIGH')
      .field('location', 'Building 5, Lecture Hall 3');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const log = res.body.data;
    ticketId = log.id;
    reference = log.reference;

    // A new ticket is PENDING and belongs to nobody yet.
    expect(log.status).toBe(LOG_STATUS.PENDING);
    expect(log.technician).toBeNull();

    // The reference is the thing a user quotes on the phone, so its shape
    // matters: department code, then a zero-padded per-department sequence.
    expect(reference).toMatch(/^[A-Z]+-\d{4}$/);
    expect(reference.startsWith(`${world.departments.ict.code}-`)).toBe(true);

    // The SLA must be attached AT CREATION. If deadlines are only computed on
    // assignment, every unassigned ticket sits outside the SLA silently.
    expect(log.sla).not.toBeNull();
    expect(log.timestamps.responseDueAt).toBeTruthy();
    expect(log.timestamps.resolutionDueAt).toBeTruthy();
    // HIGH priority is a 60-minute response target, and the deadline is
    // measured from creation, not from assignment.
    const minutes =
      (new Date(log.timestamps.responseDueAt) - new Date(log.timestamps.createdAt)) / 60000;
    expect(Math.round(minutes)).toBe(60);

    // The clock is live on the response, so the UI needs no second request.
    expect(log.slaStatus.percentConsumed).toBe(0);
    expect(log.slaStatus.resolutionBreached).toBe(false);
  });

  it('the ticket is visible to its reporter', async () => {
    const res = await request(app).get(api(`/logs/${ticketId}`)).set(auth(tokens.staff));
    expect(res.status).toBe(200);
    expect(res.body.data.reference).toBe(reference);
  });

  it('it appears in the department queue an HOD sees', async () => {
    const res = await request(app).get(api('/logs')).set(auth(tokens.hod));
    expect(res.status).toBe(200);
    expect(res.body.data.map((l) => l.id)).toContain(ticketId);
  });

  it('the HOD assigns it to a technician', async () => {
    const res = await request(app)
      .post(api(`/logs/${ticketId}/assign`))
      .set(auth(tokens.hod))
      .send({ technicianId: world.users.tech.id });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(LOG_STATUS.ASSIGNED);
    expect(res.body.data.technician.id).toBe(world.users.tech.id);
  });

  it('the assigned technician starts work, which stops the response clock', async () => {
    const res = await request(app)
      .patch(api(`/logs/${ticketId}/status`))
      .set(auth(tokens.tech))
      .send({ status: LOG_STATUS.IN_PROGRESS, note: 'On site, testing the power supply.' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(LOG_STATUS.IN_PROGRESS);

    // respondedAt is what makes the response SLA measurable. Without it the
    // ticket would read as never-answered however much work was done.
    const stored = await prisma.log.findUnique({ where: { id: ticketId } });
    expect(stored.respondedAt).toBeTruthy();
  });

  it('the SLA endpoint reports the ticket as on track', async () => {
    const res = await request(app).get(api(`/logs/${ticketId}/sla`)).set(auth(tokens.tech));
    expect(res.status).toBe(200);
    expect(res.body.data.resolutionBreached).toBe(false);
    expect(res.body.data.dueEscalationLevel).toBe(0);
    expect(res.body.data.respondedInTime).toBe(true);
  });

  it('the technician marks it resolved', async () => {
    const res = await request(app)
      .patch(api(`/logs/${ticketId}/status`))
      .set(auth(tokens.tech))
      .send({ status: LOG_STATUS.RESOLVED, note: 'Replaced the internal power board.' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(LOG_STATUS.RESOLVED);

    const stored = await prisma.log.findUnique({ where: { id: ticketId } });
    expect(stored.resolvedAt).toBeTruthy();
  });

  it('the reporter closes it, confirming the fix held', async () => {
    // The one action the reporter is allowed beyond logging: this is what
    // makes "resolved" mean something other than the technician's opinion.
    const res = await request(app)
      .patch(api(`/logs/${ticketId}/status`))
      .set(auth(tokens.staff))
      .send({ status: LOG_STATUS.CLOSED, note: 'Confirmed working, thank you.' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(LOG_STATUS.CLOSED);

    const stored = await prisma.log.findUnique({ where: { id: ticketId } });
    expect(stored.closedAt).toBeTruthy();
  });

  it('leaves a complete, ordered audit trail', async () => {
    const res = await request(app).get(api(`/logs/${ticketId}/history`)).set(auth(tokens.hod));
    expect(res.status).toBe(200);

    // The endpoint returns newest first, which is the order a timeline reads
    // in. Reversed here so the assertion reads in the order things happened.
    const statuses = res.body.data.map((h) => h.toStatus).reverse();

    // Every transition recorded, in the order it happened. This trail is what
    // answers "who changed this and when" months later.
    expect(statuses).toEqual([
      LOG_STATUS.PENDING,
      LOG_STATUS.ASSIGNED,
      LOG_STATUS.IN_PROGRESS,
      LOG_STATUS.RESOLVED,
      LOG_STATUS.CLOSED,
    ]);

    // Each row names who did it, which is the half that makes it an audit
    // trail rather than a status log.
    expect(res.body.data.every((h) => h.changedBy?.name)).toBe(true);
  });

  it('refuses to move a CLOSED ticket through the generic status route', async () => {
    // CLOSED is terminal; reviving a ticket goes through /reopen, which records
    // a reason. Allowing it here would lose that.
    const res = await request(app)
      .patch(api(`/logs/${ticketId}/status`))
      .set(auth(tokens.admin))
      .send({ status: LOG_STATUS.IN_PROGRESS });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('allocates gapless, sequential references per department', async () => {
    const second = await request(app)
      .post(api('/logs'))
      .set(auth(tokens.staff))
      .field('title', 'Second fault for reference sequencing')
      .field('description', 'Checking that the reference counter advances by one.')
      .field('categoryId', String(world.category.id))
      .field('priority', 'LOW');

    expect(second.status).toBe(201);
    const seq = (ref) => Number(ref.split('-').pop());
    expect(seq(second.body.data.reference)).toBe(seq(reference) + 1);
  });
});

/**
 * Two different rejections, deliberately different codes:
 *   422 — the request was understood but a field is invalid (schema validation,
 *         which reports every bad field at once);
 *   400 — the request was well formed but refers to something that does not
 *         exist, or is malformed JSON the parser could not read at all.
 * Pinning both means a client can rely on telling them apart.
 */
describe('validation is enforced at the edge, not in the service', () => {
  it('rejects a ticket with no title', async () => {
    const res = await request(app)
      .post(api('/logs'))
      .set(auth(tokens.staff))
      .field('description', 'A description without a title.')
      .field('categoryId', String(world.category.id));
    expect(res.status).toBe(422);
    // Reports the field, so the form can mark it rather than show a banner.
    expect(JSON.stringify(res.body)).toMatch(/title/i);
  });

  it('rejects an unknown priority rather than defaulting silently', async () => {
    const res = await request(app)
      .post(api('/logs'))
      .set(auth(tokens.staff))
      .field('title', 'A valid title for the priority check')
      .field('description', 'A valid description for the priority check.')
      .field('categoryId', String(world.category.id))
      .field('priority', 'URGENT'); // not a Priority
    expect(res.status).toBe(422);
  });

  it('rejects a category that does not exist with 400, not 500', async () => {
    const res = await request(app)
      .post(api('/logs'))
      .set(auth(tokens.staff))
      .field('title', 'A valid title for the category check')
      .field('description', 'A valid description for the category check.')
      .field('categoryId', '999999');
    expect(res.status).toBe(400);
  });

  it('accepts a ticket with no coordinates', async () => {
    // The Phase 1 fix. Geolocation fails over plain http and on locked-down
    // machines; a fault report must not depend on it.
    const res = await request(app)
      .post(api('/logs'))
      .set(auth(tokens.staff))
      .field('title', 'A fault reported without any location fix')
      .field('description', 'Submitted from a desktop with geolocation denied.')
      .field('categoryId', String(world.category.id));
    expect(res.status).toBe(201);
    expect(res.body.data.coordinates).toBeNull();
  });

  it('returns 404 for a ticket id that does not exist', async () => {
    const res = await request(app).get(api('/logs/999999')).set(auth(tokens.admin));
    expect(res.status).toBe(404);
  });

  it('returns 400, not 500, for malformed JSON', async () => {
    const res = await request(app)
      .patch(api('/logs/1/status'))
      .set(auth(tokens.admin))
      .set('Content-Type', 'application/json')
      .send('{"status": ');
    expect(res.status).toBe(400);
  });
});

describe('authentication is required', () => {
  it('refuses an unauthenticated request', async () => {
    const res = await request(app).get(api('/logs'));
    expect(res.status).toBe(401);
  });

  it('refuses a malformed bearer token', async () => {
    const res = await request(app).get(api('/logs')).set(auth('not-a-real-token'));
    expect(res.status).toBe(401);
  });
});
