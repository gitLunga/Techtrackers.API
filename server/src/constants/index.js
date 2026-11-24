/**
 * src/constants/index.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Business rules in the old code were expressed as string literals typed out
 *   at each call site. The results were real bugs, still visible in the C#:
 *     - LogService wrote "PENDING"; ManageLogsService filtered "INPROGRESS";
 *       GenerateReport counted "On Hold" while ChangeLogStatus wrote "ONHOLD",
 *       so the on-hold count was permanently zero.
 *     - AssignTechnicianService hard-coded `RoleId == 3` for "Technician".
 *       Re-seed the roles table in a different order and the app silently
 *       assigns tickets to the wrong people.
 *
 * WHAT IT ACHIEVES
 *   One place naming every state, role and transition. The status TRANSITIONS
 *   map additionally encodes the ticket lifecycle as data, so the rule "you
 *   cannot move a CLOSED ticket back to IN_PROGRESS" is enforced by a lookup
 *   rather than by whichever `if` a developer remembered to write.
 */

export const ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  HOD: 'HOD',
  TECHNICIAN: 'TECHNICIAN',
  STAFF: 'STAFF',
  EXTERNAL_TECHNICIAN: 'EXTERNAL_TECHNICIAN',
});

export const PRIORITIES = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const LOG_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  ON_HOLD: 'ON_HOLD',
  ESCALATED: 'ESCALATED',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
});

export const NOTIFICATION_TYPE = Object.freeze({
  INFORMATION: 'INFORMATION',
  WARNING: 'WARNING',
  ALERT: 'ALERT',
});

export const TECHNICIAN_TYPE = Object.freeze({ INTERNAL: 'INTERNAL', EXTERNAL: 'EXTERNAL' });

export const ASSET_STATUS = Object.freeze({
  IN_USE: 'IN_USE',
  IN_STORAGE: 'IN_STORAGE',
  UNDER_REPAIR: 'UNDER_REPAIR',
  RETIRED: 'RETIRED',
});

export const COLLABORATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED',
});

/**
 * The ticket lifecycle, as data. Key = current status, value = statuses it is
 * legal to move to next.
 */
export const STATUS_TRANSITIONS = Object.freeze({
  PENDING: ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'CLOSED'],
  ASSIGNED: ['IN_PROGRESS', 'ON_HOLD', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['ON_HOLD', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  ON_HOLD: ['IN_PROGRESS', 'ESCALATED', 'CLOSED'],
  ESCALATED: ['IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'], // reopened if the fix did not hold
  CLOSED: [], // terminal — reopening goes through the dedicated reopen endpoint
});

/** Statuses that mean "this ticket still needs work" — used by SLA + counts. */
export const OPEN_STATUSES = Object.freeze([
  LOG_STATUS.PENDING,
  LOG_STATUS.ASSIGNED,
  LOG_STATUS.IN_PROGRESS,
  LOG_STATUS.ON_HOLD,
  LOG_STATUS.ESCALATED,
]);

/** Escalation thresholds as a fraction of the resolution window consumed. */
export const ESCALATION_THRESHOLDS = Object.freeze([
  { level: 1, atFraction: 0.5, type: NOTIFICATION_TYPE.INFORMATION, label: 'half of the SLA window has elapsed' },
  { level: 2, atFraction: 0.75, type: NOTIFICATION_TYPE.WARNING, label: 'three quarters of the SLA window has elapsed' },
  { level: 3, atFraction: 1.0, type: NOTIFICATION_TYPE.ALERT, label: 'the SLA resolution deadline has been breached' },
]);

export default {
  ROLES,
  PRIORITIES,
  LOG_STATUS,
  NOTIFICATION_TYPE,
  TECHNICIAN_TYPE,
  ASSET_STATUS,
  COLLABORATION_STATUS,
  STATUS_TRANSITIONS,
  OPEN_STATUSES,
  ESCALATION_THRESHOLDS,
};
