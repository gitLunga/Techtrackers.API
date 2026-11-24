/**
 * tests/integration/authorization.test.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The unit tests prove the authorization RULES are right. This file proves
 *   they are actually WIRED IN — that every route which should consult them
 *   does. Those are different failures, and the second is the one that shipped:
 *   `PATCH /logs/:id/status` had correct rules available to it and simply never
 *   called them, so any authenticated account could drive any ticket through
 *   its entire lifecycle by knowing its id. A unit test of the rules would have
 *   passed the whole time.
 *
 *   So these tests go through HTTP with real tokens for real users, and assert
 *   on the status code. A 200 where a 403 belongs is a confidentiality or
 *   integrity breach, which for TUT means one department reading another's
 *   staff complaints.
 *
 * WHAT A FAILURE HERE MEANS
 *   Not a regression in a helper — an access-control hole. Treat it as such.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { app, api, auth, request, seedBaseline, loginAll } from './fixtures.js';
import { LOG_STATUS } from '../../src/constants/index.js';
import { truncateAll } from './setup.js';

let world;
let tokens;
/** A ticket reported by ICT staff, assigned to the ICT technician. */
let ictTicket;
/** A ticket reported by HR staff, assigned to nobody. */
let hrTicket;

/** Logs a ticket as the given user and returns the created body. */
async function logTicket(token, title) {
  const res = await request(app)
    .post(api('/logs'))
    .set(auth(token))
    .field('title', title)
    .field('description', `${title} — created by the authorization fixture.`)
    .field('categoryId', String(world.category.id))
    .field('priority', 'MEDIUM');
  if (res.status !== 201) throw new Error(`Fixture ticket failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

beforeAll(async () => {
  await truncateAll();
  world = await seedBaseline();
  tokens = await loginAll(world.users);

  ictTicket = await logTicket(tokens.staff, 'ICT ticket for authorization checks');
  hrTicket = await logTicket(tokens.otherStaff, 'HR ticket for authorization checks');

  await request(app)
    .post(api(`/logs/${ictTicket.id}/assign`))
    .set(auth(tokens.hod))
    .send({ technicianId: world.users.tech.id });
});

describe('reading a ticket', () => {
  it('lets an admin read any ticket', async () => {
    for (const id of [ictTicket.id, hrTicket.id]) {
      const res = await request(app).get(api(`/logs/${id}`)).set(auth(tokens.admin));
      expect(res.status).toBe(200);
    }
  });

  it("lets an HOD read their own department's ticket", async () => {
    const res = await request(app).get(api(`/logs/${ictTicket.id}`)).set(auth(tokens.hod));
    expect(res.status).toBe(200);
  });

  it("hides another department's ticket from an HOD", async () => {
    // 404 rather than 403, deliberately: confirming a ticket exists is itself a
    // disclosure. The HOD learns nothing about HR's queue.
    const res = await request(app).get(api(`/logs/${hrTicket.id}`)).set(auth(tokens.hod));
    expect(res.status).toBe(404);
  });

  it("hides another staff member's ticket, even in the same department", async () => {
    // Staff see only what they reported. A ticket can name a person, a room or
    // a grievance; "same department" is not consent.
    const res = await request(app).get(api(`/logs/${ictTicket.id}`)).set(auth(tokens.otherStaff));
    expect(res.status).toBe(404);
  });

  it('lets the assigned technician read their ticket', async () => {
    const res = await request(app).get(api(`/logs/${ictTicket.id}`)).set(auth(tokens.tech));
    expect(res.status).toBe(200);
  });

  it('hides a ticket from a technician who is not on it', async () => {
    const res = await request(app).get(api(`/logs/${ictTicket.id}`)).set(auth(tokens.otherTech));
    expect(res.status).toBe(404);
  });

  it('scopes the list endpoint by the same rules, not just the detail endpoint', async () => {
    // The common mistake: guarding the detail route and leaving the list to
    // return everything. Checked separately for that reason.
    const hod = await request(app).get(api('/logs')).set(auth(tokens.hod));
    const ids = hod.body.data.map((l) => l.id);
    expect(ids).toContain(ictTicket.id);
    expect(ids).not.toContain(hrTicket.id);

    const staff = await request(app).get(api('/logs')).set(auth(tokens.otherStaff));
    const staffIds = staff.body.data.map((l) => l.id);
    expect(staffIds).toContain(hrTicket.id);
    expect(staffIds).not.toContain(ictTicket.id);
  });

  it('scopes the history endpoint too', async () => {
    const res = await request(app).get(api(`/logs/${hrTicket.id}/history`)).set(auth(tokens.hod));
    expect(res.status).toBe(404);
  });

  it('scopes the SLA endpoint too', async () => {
    const res = await request(app).get(api(`/logs/${hrTicket.id}/sla`)).set(auth(tokens.hod));
    expect(res.status).toBe(404);
  });
});

describe('changing a ticket', () => {
  /** A fresh ticket per test, so a refusal cannot be masked by earlier state. */
  const fresh = async () => logTicket(tokens.staff, `Status-change target ${Math.random()}`);

  it('refuses an unrelated staff member any status change', async () => {
    // THE REGRESSION TEST. This exact request used to return 200.
    const ticket = await fresh();
    const res = await request(app)
      .patch(api(`/logs/${ticket.id}/status`))
      .set(auth(tokens.otherStaff))
      .send({ status: LOG_STATUS.IN_PROGRESS });
    expect(res.status).toBe(404);
  });

  it('refuses a technician who is not assigned to the ticket', async () => {
    const ticket = await fresh();
    await request(app)
      .post(api(`/logs/${ticket.id}/assign`))
      .set(auth(tokens.hod))
      .send({ technicianId: world.users.tech.id });

    const res = await request(app)
      .patch(api(`/logs/${ticket.id}/status`))
      .set(auth(tokens.otherTech))
      .send({ status: LOG_STATUS.RESOLVED });
    expect(res.status).toBe(404);
  });

  it('refuses the reporter marking their own issue RESOLVED', async () => {
    // Over HTTP this time. The reporter can see the ticket, so this is a 403:
    // they are allowed to know it exists and not allowed to do this.
    const ticket = await fresh();
    const res = await request(app)
      .patch(api(`/logs/${ticket.id}/status`))
      .set(auth(tokens.staff))
      .send({ status: LOG_STATUS.RESOLVED });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/only close a ticket once the technician/i);
  });

  it('lets the reporter close a ticket once it is RESOLVED', async () => {
    const ticket = await fresh();
    await request(app)
      .post(api(`/logs/${ticket.id}/assign`))
      .set(auth(tokens.hod))
      .send({ technicianId: world.users.tech.id });
    await request(app)
      .patch(api(`/logs/${ticket.id}/status`))
      .set(auth(tokens.tech))
      .send({ status: LOG_STATUS.RESOLVED });

    const res = await request(app)
      .patch(api(`/logs/${ticket.id}/status`))
      .set(auth(tokens.staff))
      .send({ status: LOG_STATUS.CLOSED });
    expect(res.status).toBe(200);
  });

  it("refuses an HOD a ticket in another department", async () => {
    const res = await request(app)
      .patch(api(`/logs/${hrTicket.id}/status`))
      .set(auth(tokens.hod))
      .send({ status: LOG_STATUS.IN_PROGRESS });
    expect(res.status).toBe(404);
  });
});

describe('role-gated routes', () => {
  it('refuses assignment to anyone below HOD', async () => {
    for (const who of ['staff', 'tech']) {
      const res = await request(app)
        .post(api(`/logs/${ictTicket.id}/assign`))
        .set(auth(tokens[who]))
        .send({ technicianId: world.users.tech.id });
      expect(res.status, who).toBe(403);
    }
  });

  it('refuses manual escalation to anyone below HOD', async () => {
    const res = await request(app)
      .post(api(`/logs/${ictTicket.id}/escalate`))
      .set(auth(tokens.tech))
      .send({ level: 2, reason: 'Needs a vendor callout.' });
    expect(res.status).toBe(403);
  });

  it('refuses unassignment to anyone below HOD', async () => {
    const res = await request(app)
      .delete(api(`/logs/${ictTicket.id}/assign`))
      .set(auth(tokens.staff));
    expect(res.status).toBe(403);
  });

  it('allows an HOD what it refuses a technician', async () => {
    // The control. Without it, a 403 everywhere would look like a pass.
    const res = await request(app)
      .post(api(`/logs/${ictTicket.id}/escalate`))
      .set(auth(tokens.hod))
      .send({ level: 2, reason: 'Vendor callout approved.' });
    expect(res.status).toBe(200);
  });
});

describe('tokens', () => {
  it('refuses a token signed with the wrong secret', async () => {
    // A forged token with a correct-looking payload must not be accepted.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      Buffer.from(JSON.stringify({ sub: 1, roles: ['ADMIN'] })).toString('base64url') +
      '.not-a-valid-signature';
    const res = await request(app).get(api('/logs')).set(auth(forged));
    expect(res.status).toBe(401);
  });

  it('does not accept a refresh token as an access token', async () => {
    const login = await request(app)
      .post(api('/auth/login'))
      .send({ email: world.users.admin.email, password: 'TestPass123!' });
    const res = await request(app).get(api('/logs')).set(auth(login.body.data.refreshToken));
    expect(res.status).toBe(401);
  });
});
