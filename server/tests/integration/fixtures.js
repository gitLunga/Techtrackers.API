/**
 * tests/integration/fixtures.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Every integration test needs the same floor under it: roles, a department,
 *   a category, SLA targets and a user per role. Repeating that in each file
 *   makes the tests long and hides what each one is actually asserting.
 *
 *   It also keeps the tests honest about where their data comes from. Users are
 *   inserted directly with Prisma — there is no public registration endpoint,
 *   and an admin-created user is not what most tests are about — but the TOKENS
 *   come from the real /auth/login route. So every authenticated request in the
 *   suite carries a genuinely issued JWT, and the login path is exercised as a
 *   side effect of setting up anything at all.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not reuse the demo seed. That seed is tuned for a populated-looking
 *   UI; a test needs the smallest world in which its assertion means something.
 */
import bcrypt from 'bcryptjs';
import request from 'supertest';
import prisma from '../../src/config/prisma.js';
import { createApp } from '../../src/app.js';
import env from '../../src/config/env.js';

export const app = createApp();
export const api = (path) => `${env.API_PREFIX}${path}`;

/** Cost 4 rather than the production 12: these hashes are thrown away, and
 *  cost 12 on a dozen fixture users adds seconds to every run. */
const PASSWORD = 'TestPass123!';
const hash = () => bcrypt.hash(PASSWORD, 4);

const ROLE_NAMES = ['ADMIN', 'HOD', 'TECHNICIAN', 'STAFF', 'EXTERNAL_TECHNICIAN'];

/**
 * Builds the minimum world: roles, two departments, a category, SLA rows, and
 * one user per role plus a second department's staff member (needed to prove
 * that cross-department reads are refused).
 */
export async function seedBaseline() {
  for (const name of ROLE_NAMES) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }
  const roles = Object.fromEntries(
    (await prisma.role.findMany()).map((r) => [r.name, r.id]),
  );

  const ict = await prisma.department.upsert({
    where: { code: 'ICT' }, update: {}, create: { name: 'ICT', code: 'ICT' },
  });
  const hr = await prisma.department.upsert({
    where: { code: 'HR' }, update: {}, create: { name: 'Human Resources', code: 'HR' },
  });

  const category = await prisma.category.upsert({
    where: { name: 'Hardware' }, update: {}, create: { name: 'Hardware' },
  });

  // Short windows so a test can reason about the SLA clock without waiting.
  const slaTargets = [
    { priority: 'LOW', responseMinutes: 480, resolutionMinutes: 2880 },
    { priority: 'MEDIUM', responseMinutes: 240, resolutionMinutes: 1440 },
    { priority: 'HIGH', responseMinutes: 60, resolutionMinutes: 480 },
    { priority: 'CRITICAL', responseMinutes: 15, resolutionMinutes: 240 },
  ];
  for (const target of slaTargets) {
    await prisma.sla.upsert({
      where: { priority: target.priority }, update: target, create: target,
    });
  }

  const passwordHash = await hash();
  const makeUser = async (email, surname, roleNames, departmentId, technician = false) => {
    const user = await prisma.user.create({
      data: {
        email, surname, initials: surname[0], passwordHash, departmentId,
        roles: { create: roleNames.map((n) => ({ roleId: roles[n] })) },
      },
    });
    if (technician) {
      await prisma.technician.create({
        data: { userId: user.id, specialization: 'General', type: roleNames.includes('EXTERNAL_TECHNICIAN') ? 'EXTERNAL' : 'INTERNAL' },
      });
    }
    return user;
  };

  const users = {
    admin: await makeUser('admin@test.local', 'Admin', ['ADMIN'], ict.id),
    hod: await makeUser('hod@test.local', 'Hod', ['HOD'], ict.id),
    tech: await makeUser('tech@test.local', 'Tech', ['TECHNICIAN'], ict.id, true),
    otherTech: await makeUser('tech2@test.local', 'Second', ['TECHNICIAN'], ict.id, true),
    staff: await makeUser('staff@test.local', 'Staff', ['STAFF'], ict.id),
    // Same role, different department — the control for visibility tests.
    otherStaff: await makeUser('staff2@test.local', 'Other', ['STAFF'], hr.id),
  };

  return { roles, departments: { ict, hr }, category, users };
}

/**
 * Logs in through the real endpoint and returns the access token.
 * A failure here is a genuine finding, not fixture noise — it means login is
 * broken — so it throws loudly with the response body.
 */
export async function login(email) {
  const res = await request(app).post(api('/auth/login')).send({ email, password: PASSWORD });
  if (res.status !== 200) {
    throw new Error(`Fixture login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
}

/** Access tokens for every baseline user, keyed the same way. */
export async function loginAll(users) {
  const entries = await Promise.all(
    Object.entries(users).map(async ([key, user]) => [key, await login(user.email)]),
  );
  return Object.fromEntries(entries);
}

/** `auth(token)` -> the header object, so requests read as one line. */
export const auth = (token) => ({ Authorization: `Bearer ${token}` });

export { PASSWORD, prisma, request };
