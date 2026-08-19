/**
 * prisma/seed-demo.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   `db:seed` creates the things the system cannot run without — roles,
 *   departments, categories, SLA targets and one user per role. It deliberately
 *   creates NO tickets, because a production deployment must not be born with
 *   fake data in it.
 *
 *   That leaves a problem for anyone evaluating the system: a fresh install
 *   shows empty dashboards, empty reports and blank charts, so there is nothing
 *   to look at and no way to tell a working report from a broken one.
 *
 * WHAT IT ACHIEVES
 *   A realistic working service desk: ~40 tickets spread across every status,
 *   priority and age, with conversation, status history, escalations and
 *   feedback attached. After running this, every screen has something true to
 *   show — the SLA tiles are non-zero, the monthly trend has several points, and
 *   technician performance can actually be compared.
 *
 *   Deterministic: the same seed value produces the same data every time, so
 *   what you see matches what the walkthrough describes.
 *
 * RUN IT WITH:   npm run db:seed:demo
 * REMOVE IT:     npm run db:seed:demo -- --clear
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Marks every ticket this script creates so `--clear` can find them again. */
const DEMO_TAG = '[demo]';

/* ---- deterministic pseudo-random, so runs are reproducible --------------- */
let seed = 20260819;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (min, max) => min + Math.floor(rand() * (max - min + 1));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* ---- believable university IT tickets ------------------------------------ */
const TICKETS = [
  ['Laptop will not power on', 'My work laptop stopped powering on this morning. No lights at all when I press the button, even plugged in.', 'Hardware Failure', 'HIGH'],
  ['Cannot connect to campus Wi-Fi', 'Since yesterday my laptop will not join eduroam. It asks for credentials repeatedly and then fails.', 'Network Connectivity', 'MEDIUM'],
  ['Projector in Lecture Hall 3 not displaying', 'The projector powers on but shows "no signal" from every laptop we have tried. Lecture starts in an hour.', 'Hardware Failure', 'CRITICAL'],
  ['Printer keeps jamming on tray 2', 'The departmental printer jams on almost every job from tray 2. Tray 1 seems fine.', 'Printer & Peripherals', 'LOW'],
  ['Locked out of student portal', 'I have been locked out after too many failed sign-in attempts and cannot reset it myself.', 'Account & Access', 'MEDIUM'],
  ['Email not syncing on phone', 'Outlook on my phone has stopped pulling new mail since the weekend. Webmail works fine.', 'Email & Communication', 'LOW'],
  ['SPSS licence expired on lab machines', 'The statistics lab machines all report an expired SPSS licence. Postgraduate class needs it Thursday.', 'Software Issue', 'HIGH'],
  ['Suspicious email asking for password', 'Received an email pretending to be from IT asking me to confirm my password. Reporting it rather than clicking.', 'Security Incident', 'HIGH'],
  ['Shared drive missing from my computer', 'The departmental shared drive no longer appears after the last restart.', 'Network Connectivity', 'MEDIUM'],
  ['Monitor flickering constantly', 'The external monitor at my desk flickers every few seconds. Swapping the cable did not help.', 'Hardware Failure', 'MEDIUM'],
  ['Need Adobe Acrobat installed', 'I need the full Acrobat to edit accessibility tags in course PDFs.', 'Software Issue', 'LOW'],
  ['Lab PC very slow to log in', 'Machines in Lab B take upwards of ten minutes to reach the desktop after sign-in.', 'Hardware Failure', 'MEDIUM'],
  ['Cannot access research file server', 'Access denied to the research share since my department transfer went through.', 'Account & Access', 'HIGH'],
  ['Microphone not working in online class', 'Students cannot hear me on Teams. The microphone works in other applications.', 'Hardware Failure', 'HIGH'],
  ['Password reset for new staff member', 'New appointment starting Monday needs their initial credentials set up.', 'Account & Access', 'LOW'],
  ['Network point dead in office 214', 'The wall port in office 214 gives no link light on any laptop or cable.', 'Network Connectivity', 'MEDIUM'],
  ['Duplicate charges on printing quota', 'My printing quota was deducted twice for the same job on three occasions this week.', 'Printer & Peripherals', 'LOW'],
  ['Laptop overheating and shutting down', 'The machine gets extremely hot and shuts itself down after about twenty minutes of use.', 'Hardware Failure', 'HIGH'],
  ['Cannot join Teams meetings', 'Teams crashes on launch since the last update. Reinstalling did not fix it.', 'Software Issue', 'MEDIUM'],
  ['Request new laptop for research assistant', 'A new research assistant starts next month and needs a machine allocated.', 'Other', 'LOW'],
];

const CHATS = [
  'Thanks for logging this — I will take a look this afternoon.',
  'Could you send me a photo of the error message when you get a chance?',
  'I have ordered the replacement part, it should arrive in two days.',
  'Any update on this please? It is starting to hold up my teaching.',
  'Tried restarting as you suggested, unfortunately no change.',
  'This should be sorted now — could you confirm on your side?',
  'Confirmed working, thank you for the quick turnaround.',
];

const HOLD_REASONS = [
  'Awaiting a replacement part from the supplier.',
  'Waiting on the user to confirm a convenient time to visit.',
  'Escalated to the vendor; waiting on their response.',
  'Blocked until the network team completes the switch upgrade.',
];

const FEEDBACK = [
  [5, 'Sorted the same day, very helpful.'],
  [5, 'Excellent service, kept me updated throughout.'],
  [4, 'Fixed properly, took slightly longer than I hoped.'],
  [4, 'Good communication, problem solved.'],
  [3, 'Resolved in the end but I had to chase twice.'],
  [5, null],
  [4, null],
];

async function clearDemo() {
  const demoLogs = await prisma.log.findMany({
    where: { description: { contains: DEMO_TAG } },
    select: { id: true },
  });
  const ids = demoLogs.map((l) => l.id);
  if (ids.length === 0) {
    console.log('No demo tickets found — nothing to clear.\n');
    return 0;
  }
  // Children first where the relation is not set to cascade.
  await prisma.notification.deleteMany({ where: { logId: { in: ids } } });
  await prisma.log.deleteMany({ where: { id: { in: ids } } });
  console.log(`Removed ${ids.length} demo ticket(s).\n`);
  return ids.length;
}

async function main() {
  const clearOnly = process.argv.includes('--clear');

  if (clearOnly) {
    await clearDemo();
    return;
  }

  console.log('\nSeeding demo tickets...\n');
  await clearDemo();

  // ---- look up what the base seed created -------------------------------
  const [categories, slas, staff, technicians, admin] = await Promise.all([
    prisma.category.findMany(),
    prisma.sla.findMany(),
    prisma.user.findMany({ where: { roles: { some: { role: { name: 'STAFF' } } } } }),
    prisma.user.findMany({
      where: { roles: { some: { role: { name: { in: ['TECHNICIAN', 'EXTERNAL_TECHNICIAN'] } } } } },
      include: { department: true },
    }),
    prisma.user.findFirst({ where: { roles: { some: { role: { name: 'ADMIN' } } } } }),
  ]);

  if (staff.length === 0 || technicians.length === 0 || slas.length === 0) {
    console.error('Base data missing. Run `npm run db:seed` first.\n');
    process.exit(1);
  }

  const categoryByName = Object.fromEntries(categories.map((c) => [c.name, c]));
  const slaByPriority = Object.fromEntries(slas.map((s) => [s.priority, s]));
  const departments = await prisma.department.findMany();
  const deptById = Object.fromEntries(departments.map((d) => [d.id, d]));

  // Next reference number per department, so demo tickets continue the sequence
  // rather than colliding with anything already there.
  const nextSeq = {};
  for (const dept of departments) {
    const last = await prisma.log.findFirst({
      where: { departmentId: dept.id },
      orderBy: { id: 'desc' },
      select: { reference: true },
    });
    const parsed = last ? Number.parseInt(last.reference.split('-').pop(), 10) : 0;
    nextSeq[dept.id] = (Number.isFinite(parsed) ? parsed : 0) + 1;
  }

  /**
   * Distribution chosen so every screen has something to show:
   * a healthy majority resolved/closed, a working middle, and a few genuinely
   * breached so the "Past SLA" tile and the escalation timeline are not empty.
   */
  const PLAN = [
    { status: 'CLOSED',      count: 10, ageDays: [12, 90], resolve: true,  feedback: true },
    { status: 'RESOLVED',    count: 6,  ageDays: [2, 20],  resolve: true,  feedback: false },
    { status: 'IN_PROGRESS', count: 7,  ageDays: [0, 3],   assign: true },
    { status: 'ASSIGNED',    count: 4,  ageDays: [0, 1],   assign: true },
    { status: 'ON_HOLD',     count: 3,  ageDays: [1, 6],   assign: true,  hold: true },
    { status: 'ESCALATED',   count: 3,  ageDays: [4, 9],   assign: true,  breach: true },
    { status: 'PENDING',     count: 6,  ageDays: [0, 1] },
  ];

  const now = Date.now();
  let created = 0;
  let ticketIndex = 0;

  for (const group of PLAN) {
    for (let i = 0; i < group.count; i += 1) {
      const [title, description, categoryName, priority] = TICKETS[ticketIndex % TICKETS.length];
      ticketIndex += 1;

      const reporter = pick(staff);
      const category = categoryByName[categoryName] ?? categories[0];
      const sla = slaByPriority[priority];
      const dept = deptById[reporter.departmentId];

      const ageMs = between(group.ageDays[0] * 24, group.ageDays[1] * 24) * HOUR;
      const createdAt = new Date(now - ageMs);
      const responseDueAt = new Date(createdAt.getTime() + sla.responseMinutes * MINUTE);
      const resolutionDueAt = new Date(createdAt.getTime() + sla.resolutionMinutes * MINUTE);

      const technician = group.assign || group.resolve ? pick(technicians) : null;
      const respondedAt = technician
        ? new Date(createdAt.getTime() + between(5, Math.max(6, sla.responseMinutes)) * MINUTE)
        : null;

      // Resolved tickets: most inside the SLA window, a few outside, so the
      // compliance figure is realistic rather than a flat 100%.
      let resolvedAt = null;
      if (group.resolve) {
        const withinSla = rand() > 0.22;
        const factor = withinSla ? 0.3 + rand() * 0.55 : 1.1 + rand() * 0.8;
        resolvedAt = new Date(createdAt.getTime() + sla.resolutionMinutes * MINUTE * factor);
        if (resolvedAt.getTime() > now) resolvedAt = new Date(now - HOUR);
      }

      const reference = `${dept.code}-${String(nextSeq[dept.id]).padStart(4, '0')}`;
      nextSeq[dept.id] += 1;

      const history = [
        { toStatus: 'PENDING', changedById: reporter.id, note: 'Ticket logged', createdAt },
      ];
      if (technician) {
        history.push({
          fromStatus: 'PENDING', toStatus: 'ASSIGNED', changedById: admin.id,
          note: `Assigned to ${technician.initials} ${technician.surname}`,
          createdAt: respondedAt,
        });
      }
      if (['IN_PROGRESS', 'ON_HOLD', 'ESCALATED', 'RESOLVED', 'CLOSED'].includes(group.status)) {
        history.push({
          fromStatus: 'ASSIGNED', toStatus: 'IN_PROGRESS', changedById: technician.id,
          createdAt: new Date(respondedAt.getTime() + 20 * MINUTE),
        });
      }
      if (group.hold) {
        history.push({
          fromStatus: 'IN_PROGRESS', toStatus: 'ON_HOLD', changedById: technician.id,
          note: pick(HOLD_REASONS),
          createdAt: new Date(respondedAt.getTime() + 2 * HOUR),
        });
      }
      if (resolvedAt) {
        history.push({
          fromStatus: 'IN_PROGRESS', toStatus: 'RESOLVED', changedById: technician.id,
          note: 'Fault repaired and verified with the user.',
          createdAt: resolvedAt,
        });
      }
      if (group.status === 'CLOSED') {
        history.push({
          fromStatus: 'RESOLVED', toStatus: 'CLOSED', changedById: reporter.id,
          note: 'Confirmed working.',
          createdAt: new Date(resolvedAt.getTime() + between(1, 40) * HOUR),
        });
      }

      // A conversation on roughly half of the assigned tickets.
      const chatCount = technician && rand() > 0.5 ? between(2, 4) : 0;
      const chats = Array.from({ length: chatCount }, (_, c) => ({
        senderId: c % 2 === 0 ? technician.id : reporter.id,
        message: CHATS[(ticketIndex + c) % CHATS.length],
        createdAt: new Date(createdAt.getTime() + (c + 1) * between(30, 240) * MINUTE),
      }));

      const log = await prisma.log.create({
        data: {
          reference,
          title,
          // The tag is what --clear looks for.
          description: `${description} ${DEMO_TAG}`,
          location: pick(['Building A, room 12', 'HR Office, 2nd floor', 'Lab B', 'Lecture Hall 3', 'Finance, desk 14', null]),
          priority,
          status: group.status,
          note: group.hold ? pick(HOLD_REASONS) : null,
          categoryId: category.id,
          departmentId: reporter.departmentId,
          reportedById: reporter.id,
          technicianId: technician?.id ?? null,
          assignedById: technician ? admin.id : null,
          slaId: sla.id,
          createdAt,
          updatedAt: resolvedAt ?? createdAt,
          responseDueAt,
          /**
           * Only the group marked `breach` should be overdue.
           *
           * Without this, an open ticket whose age happened to exceed its SLA
           * window gets escalated by the very first sweep after boot — which
           * silently empties the ON_HOLD and ASSIGNED buckets and makes the
           * demo distribution different every run. Open, non-breach tickets are
           * therefore given a deadline comfortably in the future so the mix you
           * see matches the mix this script reports.
           */
          resolutionDueAt: group.breach
            ? new Date(now - between(2, 30) * HOUR)
            : group.resolve
              ? resolutionDueAt
              : new Date(Math.max(resolutionDueAt.getTime(), now + between(4, 60) * HOUR)),
          respondedAt,
          resolvedAt,
          closedAt: group.status === 'CLOSED' ? new Date(resolvedAt.getTime() + between(1, 40) * HOUR) : null,
          escalationLevel: group.breach ? 3 : 0,
          statusHistory: { create: history },
          chatMessages: { create: chats },
          ...(group.breach && {
            escalations: {
              create: [1, 2, 3].map((level) => ({
                level,
                reason: `SLA escalation level ${level}: the resolution deadline has been breached.`,
                createdAt: new Date(now - (4 - level) * HOUR),
              })),
            },
          }),
        },
      });

      if (group.feedback && rand() > 0.25) {
        const [rating, comments] = pick(FEEDBACK);
        await prisma.feedback.create({
          data: { logId: log.id, userId: reporter.id, rating, comments, createdAt: new Date(resolvedAt.getTime() + 2 * HOUR) },
        });
      }

      created += 1;
    }
  }

  // A couple of pending collaboration invitations so that screen is not empty.
  if (technicians.length >= 2) {
    const inProgress = await prisma.log.findMany({
      where: { status: 'IN_PROGRESS', technicianId: { not: null } },
      take: 2,
    });
    for (const log of inProgress) {
      const invitee = technicians.find((t) => t.id !== log.technicianId);
      if (!invitee) continue;
      await prisma.collaborationRequest.create({
        data: {
          logId: log.id,
          requesterId: log.technicianId,
          inviteeId: invitee.id,
          message: 'Could you take a look at this with me? Second opinion would help.',
          status: 'PENDING',
        },
      });
    }
  }

  // Unread notifications so the header badge is not zero.
  const recent = await prisma.log.findMany({ orderBy: { id: 'desc' }, take: 6 });
  await prisma.notification.createMany({
    data: recent.map((log) => ({
      userId: log.reportedById,
      logId: log.id,
      message: `Ticket ${log.reference} ("${log.title}") is now ${log.status.replace('_', ' ').toLowerCase()}.`,
      type: log.status === 'ESCALATED' ? 'ALERT' : 'INFORMATION',
      isRead: false,
    })),
  });

  const counts = await prisma.log.groupBy({ by: ['status'], _count: { _all: true } });
  console.log(`Created ${created} demo tickets.\n`);
  console.log('  STATUS            COUNT');
  console.log('  ----------------  -----');
  for (const row of counts.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${row.status.padEnd(16)}  ${String(row._count._all).padStart(5)}`);
  }
  const overdue = await prisma.log.count({
    where: { status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED'] }, resolutionDueAt: { lt: new Date() } },
  });
  console.log(`\n  ${overdue} ticket(s) are past their SLA deadline.`);
  console.log('\nDemo data ready. Sign in and every screen will have something to show.\n');
}

main()
  .catch((error) => { console.error('Demo seed failed:', error); process.exit(1); })
  .finally(() => prisma.$disconnect());
