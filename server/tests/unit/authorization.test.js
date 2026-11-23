/**
 * tests/unit/authorization.test.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   These two functions are the whole access-control story for tickets.
 *   `visibilityFilter` decides what a role can READ; `assertCanModify` decides
 *   what it can CHANGE. A mistake in either is a confidentiality or integrity
 *   failure, not a cosmetic bug — a wrong clause in the filter shows one
 *   department another's tickets, and a missing branch in assertCanModify lets
 *   any account drive any ticket through its lifecycle.
 *
 *   That second one is not hypothetical: changeStatus shipped with no
 *   authorization check at all, and the audit found it. These tests exist so it
 *   cannot come back silently.
 *
 * WHY THE DATABASE IS MOCKED HERE
 *   assertCanModify consults the database only for its last branch, the
 *   accepted-collaborator case. Mocking Prisma keeps the rules themselves
 *   testable in milliseconds. The queries are proved for real by the
 *   integration tests; what is proved here is the DECISION, which is the part
 *   that is easy to get wrong and hard to see.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ROLES, LOG_STATUS, STATUS_TRANSITIONS } from '../../src/constants/index.js';

// Declared before the import of the module under test: vi.mock is hoisted, so
// log.service.js receives this stub instead of a real client and never opens a
// connection.
const findFirst = vi.fn();
vi.mock('../../src/config/prisma.js', () => ({
  default: { collaborationRequest: { findFirst: (...a) => findFirst(...a) } },
}));

const { visibilityFilter, assertCanModify } = await import('../../src/services/log.service.js');

const user = (roles, overrides = {}) => ({
  id: 'u-self', roles: Array.isArray(roles) ? roles : [roles], departmentId: 'dept-ict', ...overrides,
});

const ticket = (overrides = {}) => ({
  id: 'log-1', departmentId: 'dept-ict', technicianId: 'u-tech',
  reportedById: 'u-reporter', status: LOG_STATUS.IN_PROGRESS, ...overrides,
});

beforeEach(() => {
  findFirst.mockReset();
  findFirst.mockResolvedValue(null); // not a collaborator unless a test says so
});

describe('visibilityFilter — what each role can read', () => {
  it('gives an admin an unrestricted filter', () => {
    // An empty object is the whole point: no WHERE clause is added.
    expect(visibilityFilter(user(ROLES.ADMIN))).toEqual({});
  });

  it('scopes an HOD to their own department', () => {
    expect(visibilityFilter(user(ROLES.HOD))).toEqual({ departmentId: 'dept-ict' });
  });

  it('scopes a technician to their assignments and accepted collaborations', () => {
    const filter = visibilityFilter(user(ROLES.TECHNICIAN));
    expect(filter).toEqual({
      OR: [
        { technicianId: 'u-self' },
        { collaborations: { some: { inviteeId: 'u-self', status: 'ACCEPTED' } } },
      ],
    });
  });

  it('treats an external technician the same as an internal one', () => {
    expect(visibilityFilter(user(ROLES.EXTERNAL_TECHNICIAN)))
      .toEqual(visibilityFilter(user(ROLES.TECHNICIAN)));
  });

  it('scopes a staff member to tickets they themselves reported', () => {
    expect(visibilityFilter(user(ROLES.STAFF))).toEqual({ reportedById: 'u-self' });
  });

  it('falls back to the narrowest filter for a role it does not recognise', () => {
    // Fail closed. An unknown or newly added role must not accidentally see
    // everything while someone forgets to update this function.
    expect(visibilityFilter(user('SOMETHING_NEW'))).toEqual({ reportedById: 'u-self' });
  });

  it('gives an unrestricted filter to anyone holding ADMIN among several roles', () => {
    expect(visibilityFilter(user([ROLES.STAFF, ROLES.ADMIN]))).toEqual({});
  });

  it('never returns an unrestricted filter for a non-admin', () => {
    // The dangerous failure mode is {} — it silently removes the WHERE clause.
    for (const role of [ROLES.HOD, ROLES.TECHNICIAN, ROLES.EXTERNAL_TECHNICIAN, ROLES.STAFF]) {
      expect(Object.keys(visibilityFilter(user(role))).length).toBeGreaterThan(0);
    }
  });
});

describe('assertCanModify — who can drive a ticket', () => {
  const allowed = (promise) => expect(promise).resolves.toBeUndefined();
  const refused = (promise) => expect(promise).rejects.toThrow();

  it('lets an admin change any ticket', async () => {
    await allowed(assertCanModify(ticket({ departmentId: 'dept-other' }), user(ROLES.ADMIN)));
  });

  it('lets an HOD change a ticket in their own department', async () => {
    await allowed(assertCanModify(ticket({ departmentId: 'dept-ict' }), user(ROLES.HOD)));
  });

  it('refuses an HOD a ticket in another department', async () => {
    // The cross-department case. An HOD is powerful inside their own
    // department and ordinary outside it.
    await refused(assertCanModify(ticket({ departmentId: 'dept-finance' }), user(ROLES.HOD)));
  });

  it('lets the assigned technician change their own ticket', async () => {
    await allowed(assertCanModify(ticket({ technicianId: 'u-self' }), user(ROLES.TECHNICIAN)));
  });

  it("refuses a technician another technician's ticket", async () => {
    await refused(assertCanModify(ticket({ technicianId: 'u-someone-else' }), user(ROLES.TECHNICIAN)));
  });

  it('lets an accepted collaborator change the ticket they were invited onto', async () => {
    findFirst.mockResolvedValue({ id: 'collab-1' });
    await allowed(assertCanModify(ticket(), user(ROLES.TECHNICIAN)));
    // Scoped to this ticket and this user, and only an ACCEPTED invitation.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { logId: 'log-1', inviteeId: 'u-self', status: 'ACCEPTED' },
      }),
    );
  });

  it('refuses someone with a pending or declined invitation', async () => {
    // The query filters on ACCEPTED, so a pending invite returns nothing.
    findFirst.mockResolvedValue(null);
    await refused(assertCanModify(ticket(), user(ROLES.TECHNICIAN)));
  });

  it('refuses an unrelated staff member outright', async () => {
    await refused(assertCanModify(ticket(), user(ROLES.STAFF, { id: 'u-stranger' })));
  });
});

describe('assertCanModify — the reporter is deliberately limited', () => {
  const reporter = user(ROLES.STAFF, { id: 'u-reporter' });

  it('lets the reporter close a ticket the technician has marked RESOLVED', async () => {
    // Confirming the fix worked is the reporter's one power, and it is the
    // step that makes "resolved" mean something.
    await expect(
      assertCanModify(ticket({ status: LOG_STATUS.RESOLVED }), reporter, LOG_STATUS.CLOSED),
    ).resolves.toBeUndefined();
  });

  it('refuses the reporter marking their own issue RESOLVED', async () => {
    // The whole point of the restriction: the person who reported the fault
    // must not be able to declare it fixed.
    await expect(
      assertCanModify(ticket({ status: LOG_STATUS.IN_PROGRESS }), reporter, LOG_STATUS.RESOLVED),
    ).rejects.toThrow(/only close a ticket once the technician/i);
  });

  it('refuses the reporter closing a ticket that is not RESOLVED yet', async () => {
    await expect(
      assertCanModify(ticket({ status: LOG_STATUS.IN_PROGRESS }), reporter, LOG_STATUS.CLOSED),
    ).rejects.toThrow();
  });

  it('refuses the reporter any other status change', async () => {
    for (const to of [LOG_STATUS.IN_PROGRESS, LOG_STATUS.ON_HOLD, LOG_STATUS.ESCALATED, LOG_STATUS.ASSIGNED]) {
      await expect(assertCanModify(ticket(), reporter, to)).rejects.toThrow();
    }
  });

  it('does not reach the database for the reporter branch', async () => {
    // It throws on the rules alone. Worth pinning: a refusal should not cost
    // a query, and the branch order is what guarantees it.
    await expect(assertCanModify(ticket(), reporter, LOG_STATUS.RESOLVED)).rejects.toThrow();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('STATUS_TRANSITIONS — the lifecycle table', () => {
  it('declares every status as a starting point', () => {
    // A status missing from the table reads as "no transitions allowed" and
    // silently strands any ticket that reaches it.
    for (const status of Object.values(LOG_STATUS)) {
      expect(STATUS_TRANSITIONS).toHaveProperty(status);
    }
  });

  it('only ever names real statuses as destinations', () => {
    const real = Object.values(LOG_STATUS);
    for (const [from, tos] of Object.entries(STATUS_TRANSITIONS)) {
      for (const to of tos) {
        expect(real, `${from} -> ${to}`).toContain(to);
      }
    }
  });

  it('never allows a status to transition to itself', () => {
    for (const [from, tos] of Object.entries(STATUS_TRANSITIONS)) {
      expect(tos, `${from} -> ${from}`).not.toContain(from);
    }
  });

  it('treats CLOSED as terminal', () => {
    // Reviving a closed ticket goes through the dedicated reopen endpoint, so
    // the generic status change must not offer a way out.
    expect(STATUS_TRANSITIONS[LOG_STATUS.CLOSED]).toEqual([]);
  });

  it('lets a RESOLVED ticket be reopened when the fix did not hold', () => {
    expect(STATUS_TRANSITIONS[LOG_STATUS.RESOLVED]).toContain(LOG_STATUS.IN_PROGRESS);
  });

  it('allows every open status to be closed', () => {
    // There must always be a way to dispose of a ticket, or the queue grows
    // items nobody can clear.
    for (const status of Object.values(LOG_STATUS)) {
      if (status === LOG_STATUS.CLOSED) continue;
      expect(STATUS_TRANSITIONS[status], status).toContain(LOG_STATUS.CLOSED);
    }
  });

  it('never allows PENDING straight to RESOLVED', () => {
    // Nothing can be fixed before anyone has looked at it. Allowing this would
    // make the response-time SLA unmeasurable.
    expect(STATUS_TRANSITIONS[LOG_STATUS.PENDING]).not.toContain(LOG_STATUS.RESOLVED);
  });
});
