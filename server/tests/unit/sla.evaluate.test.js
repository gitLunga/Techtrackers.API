/**
 * tests/unit/sla.evaluate.test.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   `evaluate()` decides whether a ticket is on track, late, or breached, and
 *   what escalation level it has earned. The background sweep acts on it and
 *   the UI renders it, so a mistake here either escalates tickets that are
 *   fine or stays silent on ones that are not — and both failures are quiet.
 *
 *   It is also the cheapest thing in the codebase to test properly: a pure
 *   function with no database and no clock of its own. The caller supplies
 *   `now`, which is exactly what makes "what happens four hours from now"
 *   expressible as an assertion instead of a wait.
 *
 * WHAT IT COVERS
 *   The escalation thresholds at their boundaries, breach detection, the
 *   terminal-state rule, compliance flags, and the missing-data cases that
 *   occur in real rows.
 */
import { describe, it, expect } from 'vitest';
import { evaluate } from '../../src/services/sla.service.js';
import { LOG_STATUS, ESCALATION_THRESHOLDS } from '../../src/constants/index.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A ticket logged `agoMs` ago with a `windowMs` resolution window. */
function makeLog({
  agoMs = 0,
  windowMs = 24 * HOUR,
  responseWindowMs = 4 * HOUR,
  status = LOG_STATUS.IN_PROGRESS,
  respondedAt = null,
  resolvedAt = null,
  escalationLevel = 0,
  now = Date.now(),
} = {}) {
  const createdAt = new Date(now - agoMs);
  return {
    createdAt,
    responseDueAt: new Date(createdAt.getTime() + responseWindowMs),
    resolutionDueAt: new Date(createdAt.getTime() + windowMs),
    status,
    respondedAt,
    resolvedAt,
    escalationLevel,
  };
}

const NOW = new Date('2026-06-15T12:00:00.000Z');
const at = (ms) => new Date(NOW.getTime() + ms);

describe('evaluate() — escalation levels', () => {
  it('is level 0 on a brand-new ticket', () => {
    const result = evaluate(makeLog({ agoMs: 0, now: NOW.getTime() }), NOW);
    expect(result.dueEscalationLevel).toBe(0);
    expect(result.percentConsumed).toBe(0);
  });

  it('is still level 0 just before the first threshold', () => {
    // Thresholds are 50 / 75 / 100 percent of the resolution window.
    const window = 24 * HOUR;
    const log = makeLog({ agoMs: window * 0.49, windowMs: window, now: NOW.getTime() });
    expect(evaluate(log, NOW).dueEscalationLevel).toBe(0);
  });

  /**
   * The thresholds are declared as data, so the test reads them from the same
   * source rather than hard-coding 50/75/100. If someone retunes the policy,
   * this test follows it instead of failing spuriously.
   */
  it.each(ESCALATION_THRESHOLDS)(
    'reaches level $level exactly at $atFraction of the window',
    ({ level, atFraction }) => {
      const window = 24 * HOUR;
      const log = makeLog({ agoMs: window * atFraction, windowMs: window, now: NOW.getTime() });
      expect(evaluate(log, NOW).dueEscalationLevel).toBe(level);
    },
  );

  it('stays at the top level once well past the deadline', () => {
    const window = 4 * HOUR;
    const log = makeLog({ agoMs: window * 5, windowMs: window, now: NOW.getTime() });
    const top = Math.max(...ESCALATION_THRESHOLDS.map((t) => t.level));
    expect(evaluate(log, NOW).dueEscalationLevel).toBe(top);
  });

  it('reports the level already recorded on the ticket separately from the one now due', () => {
    const window = 24 * HOUR;
    const log = makeLog({ agoMs: window * 0.8, windowMs: window, escalationLevel: 1, now: NOW.getTime() });
    const result = evaluate(log, NOW);
    // The sweep compares these two to decide whether to act.
    expect(result.currentEscalationLevel).toBe(1);
    expect(result.dueEscalationLevel).toBe(2);
  });
});

describe('evaluate() — terminal states', () => {
  /**
   * The rule that stops finished work being chased. Without it the sweep would
   * keep escalating tickets that were resolved weeks ago.
   */
  it.each([LOG_STATUS.RESOLVED, LOG_STATUS.CLOSED])(
    'never escalates a %s ticket, however overdue',
    (status) => {
      const window = 4 * HOUR;
      const log = makeLog({ agoMs: window * 10, windowMs: window, status, now: NOW.getTime() });
      const result = evaluate(log, NOW);
      expect(result.terminal).toBe(true);
      expect(result.dueEscalationLevel).toBe(0);
      expect(result.resolutionBreached).toBe(false);
      expect(result.responseBreached).toBe(false);
    },
  );

  it('does escalate an ON_HOLD ticket — hold is not a terminal state', () => {
    // Worth pinning: holding a ticket does NOT currently stop the clock, which
    // is a known gap. If that changes, this test should change with it
    // deliberately rather than silently.
    const window = 4 * HOUR;
    const log = makeLog({ agoMs: window * 2, windowMs: window, status: LOG_STATUS.ON_HOLD, now: NOW.getTime() });
    expect(evaluate(log, NOW).terminal).toBe(false);
    expect(evaluate(log, NOW).resolutionBreached).toBe(true);
  });
});

describe('evaluate() — breach detection', () => {
  it('flags a resolution breach once the deadline passes', () => {
    const log = makeLog({ agoMs: 25 * HOUR, windowMs: 24 * HOUR, now: NOW.getTime() });
    const result = evaluate(log, NOW);
    expect(result.resolutionBreached).toBe(true);
    expect(result.resolutionRemainingMinutes).toBeLessThan(0);
  });

  it('flags a response breach only while nothing has responded', () => {
    const base = { agoMs: 5 * HOUR, responseWindowMs: 4 * HOUR, now: NOW.getTime() };
    expect(evaluate(makeLog(base), NOW).responseBreached).toBe(true);

    // Someone picked it up late — the deadline was missed, but it is no longer
    // an outstanding breach to chase.
    const responded = makeLog({ ...base, respondedAt: at(-30 * MINUTE) });
    expect(evaluate(responded, NOW).responseBreached).toBe(false);
  });

  it('does not flag a breach while there is time left', () => {
    const log = makeLog({ agoMs: 1 * HOUR, windowMs: 24 * HOUR, now: NOW.getTime() });
    const result = evaluate(log, NOW);
    expect(result.resolutionBreached).toBe(false);
    expect(result.resolutionRemainingMinutes).toBeGreaterThan(0);
  });
});

describe('evaluate() — compliance flags', () => {
  it('marks a response inside its window as in time', () => {
    const log = makeLog({
      agoMs: 6 * HOUR, responseWindowMs: 4 * HOUR,
      respondedAt: at(-4 * HOUR), // 2h after a ticket created 6h ago
      now: NOW.getTime(),
    });
    expect(evaluate(log, NOW).respondedInTime).toBe(true);
  });

  it('marks a late response as not in time', () => {
    const log = makeLog({
      agoMs: 6 * HOUR, responseWindowMs: 1 * HOUR,
      respondedAt: at(-1 * HOUR), // 5h after creation, window was 1h
      now: NOW.getTime(),
    });
    expect(evaluate(log, NOW).respondedInTime).toBe(false);
  });

  it('leaves compliance null when the event has not happened', () => {
    const result = evaluate(makeLog({ now: NOW.getTime() }), NOW);
    // null means "no answer yet", which is different from false.
    expect(result.respondedInTime).toBeNull();
    expect(result.resolvedInTime).toBeNull();
  });

  it('marks a resolution inside its window as in time', () => {
    const log = makeLog({
      agoMs: 10 * HOUR, windowMs: 24 * HOUR,
      status: LOG_STATUS.RESOLVED, resolvedAt: at(-2 * HOUR),
      now: NOW.getTime(),
    });
    expect(evaluate(log, NOW).resolvedInTime).toBe(true);
  });
});

describe('evaluate() — display values', () => {
  it('clamps percentConsumed at 100 while still escalating past it', () => {
    const window = 4 * HOUR;
    const log = makeLog({ agoMs: window * 3, windowMs: window, now: NOW.getTime() });
    const result = evaluate(log, NOW);
    // A progress bar should stop at 100%...
    expect(result.percentConsumed).toBe(100);
    // ...but the escalation decision must still see how far past it is.
    expect(result.dueEscalationLevel).toBe(3);
  });

  it('reports remaining time in whole minutes', () => {
    const log = makeLog({ agoMs: 0, windowMs: 90 * MINUTE, now: NOW.getTime() });
    expect(evaluate(log, NOW).resolutionRemainingMinutes).toBe(90);
  });
});

describe('evaluate() — rows with missing data', () => {
  it('handles a ticket with no SLA attached', () => {
    const log = {
      createdAt: at(-2 * HOUR),
      responseDueAt: null,
      resolutionDueAt: null,
      status: LOG_STATUS.PENDING,
    };
    const result = evaluate(log, NOW);
    expect(result.dueEscalationLevel).toBe(0);
    expect(result.resolutionRemainingMinutes).toBeNull();
    expect(result.resolutionBreached).toBe(false);
  });

  it('treats a zero-length window as unmeasurable rather than instantly breached', () => {
    const created = at(-1 * HOUR);
    const log = {
      createdAt: created,
      responseDueAt: created,
      resolutionDueAt: created, // window of zero
      status: LOG_STATUS.PENDING,
    };
    // Division by a zero window must not produce Infinity or NaN.
    const result = evaluate(log, NOW);
    expect(result.percentConsumed).toBe(0);
    expect(Number.isFinite(result.percentConsumed)).toBe(true);
    expect(result.dueEscalationLevel).toBe(0);
  });

  it('does not escalate a ticket whose deadline sits before its creation', () => {
    // An inverted window means corrupt data — a bad import, or a deadline
    // recalculated against the wrong timestamp. The clock must refuse to
    // interpret it rather than produce a fraction from a negative window.
    const log = {
      createdAt: at(-1 * HOUR),
      responseDueAt: at(-3 * HOUR),
      resolutionDueAt: at(-2 * HOUR), // one hour BEFORE createdAt
      status: LOG_STATUS.PENDING,
    };
    const result = evaluate(log, NOW);
    expect(result.percentConsumed).toBe(0);
    expect(result.dueEscalationLevel).toBe(0);
    // It is still reported as past its deadline, which is true and visible.
    expect(result.resolutionBreached).toBe(true);
  });

  it('defaults a missing escalationLevel to 0 rather than undefined', () => {
    const log = makeLog({ now: NOW.getTime() });
    delete log.escalationLevel;
    expect(evaluate(log, NOW).currentEscalationLevel).toBe(0);
  });

  it('accepts ISO strings as well as Date objects', () => {
    // Rows arriving over HTTP carry strings, not Dates.
    const log = makeLog({ agoMs: 12 * HOUR, windowMs: 24 * HOUR, now: NOW.getTime() });
    const asStrings = {
      ...log,
      createdAt: log.createdAt.toISOString(),
      responseDueAt: log.responseDueAt.toISOString(),
      resolutionDueAt: log.resolutionDueAt.toISOString(),
    };
    expect(evaluate(asStrings, NOW).percentConsumed).toBe(evaluate(log, NOW).percentConsumed);
  });
});
