/**
 * prisma/seed.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old system had NO seeding. A fresh clone gave you empty tables, and
 *   since AddUserService was commented out there was no API to create the first
 *   user either — you had to write SQL by hand before you could log in. Roles
 *   and SLAs were likewise manual, which is exactly why code hard-coded
 *   `RoleId == 3`: whoever wrote it was reading their own local database.
 *
 * WHAT IT ACHIEVES
 *   `npm run db:seed` gives you a working system in seconds: roles, departments,
 *   categories, SLA targets, and one user per role to test with. Everything uses
 *   `upsert`, so running it repeatedly is safe and never duplicates rows.
 *
 * RUN IT WITH:  npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Every seeded account shares this password — development convenience only.
const DEFAULT_PASSWORD = 'Password123';

async function main() {
  console.log('Seeding Techtrackers database...\n');

  /* ---------------------------------- roles ------------------------------- */
  const roleDefinitions = [
    { name: 'ADMIN', description: 'Full system access; manages users, assigns tickets, sees all reports' },
    { name: 'HOD', description: 'Head of Department; oversees their department and receives escalations' },
    { name: 'TECHNICIAN', description: 'Internal technician who resolves assigned tickets' },
    { name: 'STAFF', description: 'Logs issues and tracks their own tickets' },
    { name: 'EXTERNAL_TECHNICIAN', description: 'Contracted technician from outside the organisation' },
  ];

  for (const role of roleDefinitions) {
    await prisma.role.upsert({ where: { name: role.name }, update: { description: role.description }, create: role });
  }
  console.log(`  roles         ${roleDefinitions.length}`);

  /* ------------------------------- departments ---------------------------- */
  const departmentDefinitions = [
    { name: 'Information Technology', code: 'ICT' },
    { name: 'Human Resources', code: 'HR' },
    { name: 'Finance', code: 'FIN' },
    { name: 'Operations', code: 'OPS' },
  ];

  for (const dept of departmentDefinitions) {
    await prisma.department.upsert({ where: { name: dept.name }, update: { code: dept.code }, create: dept });
  }
  console.log(`  departments   ${departmentDefinitions.length}`);

  /* -------------------------------- categories ---------------------------- */
  const categoryNames = [
    'Hardware Failure', 'Software Issue', 'Network Connectivity', 'Account & Access',
    'Printer & Peripherals', 'Email & Communication', 'Security Incident', 'Other',
  ];

  for (const name of categoryNames) {
    await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.log(`  categories    ${categoryNames.length}`);

  /* ----------------------------------- SLAs ------------------------------- */
  // This table is what makes SLA assignment automatic: priority selects a row.
  const slaDefinitions = [
    { priority: 'CRITICAL', description: 'System down or business-critical outage', responseMinutes: 15, resolutionMinutes: 240 },
    { priority: 'HIGH', description: 'Major impact on a team or department', responseMinutes: 60, resolutionMinutes: 480 },
    { priority: 'MEDIUM', description: 'Standard request with a workaround available', responseMinutes: 240, resolutionMinutes: 1440 },
    { priority: 'LOW', description: 'Minor issue or general request', responseMinutes: 480, resolutionMinutes: 4320 },
  ];

  for (const sla of slaDefinitions) {
    await prisma.sla.upsert({ where: { priority: sla.priority }, update: sla, create: sla });
  }
  console.log(`  SLAs          ${slaDefinitions.length}`);

  /* ----------------------------------- users ------------------------------ */
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  const ict = await prisma.department.findUnique({ where: { name: 'Information Technology' } });
  const hr = await prisma.department.findUnique({ where: { name: 'Human Resources' } });
  const fin = await prisma.department.findUnique({ where: { name: 'Finance' } });

  const userDefinitions = [
    { surname: 'Mokoena', initials: 'T', email: 'admin@techtrackers.local', departmentId: ict.id, roles: ['ADMIN'] },
    { surname: 'Dlamini', initials: 'N', email: 'hod@techtrackers.local', departmentId: ict.id, roles: ['HOD'] },
    {
      surname: 'Nkosi', initials: 'S', email: 'tech1@techtrackers.local', departmentId: ict.id, roles: ['TECHNICIAN'],
      technician: { specialization: 'Hardware & Networking', availableFrom: 480, availableTo: 1020, type: 'INTERNAL' },
    },
    {
      surname: 'Botha', initials: 'P', email: 'tech2@techtrackers.local', departmentId: ict.id, roles: ['TECHNICIAN'],
      technician: { specialization: 'Software & Applications', availableFrom: 540, availableTo: 1080, type: 'INTERNAL' },
    },
    {
      surname: 'Naidoo', initials: 'R', email: 'external@techtrackers.local', departmentId: ict.id, roles: ['EXTERNAL_TECHNICIAN'],
      technician: { specialization: 'Server Infrastructure', availableFrom: 480, availableTo: 1020, type: 'EXTERNAL', location: 'Johannesburg' },
    },
    { surname: 'Khumalo', initials: 'L', email: 'staff@techtrackers.local', departmentId: hr.id, roles: ['STAFF'] },
    { surname: 'Van Wyk', initials: 'A', email: 'staff2@techtrackers.local', departmentId: fin.id, roles: ['STAFF'] },
  ];

  for (const def of userDefinitions) {
    const roleRows = await prisma.role.findMany({ where: { name: { in: def.roles } } });

    const user = await prisma.user.upsert({
      where: { email: def.email },
      update: {},
      create: {
        surname: def.surname,
        initials: def.initials,
        email: def.email,
        passwordHash,
        departmentId: def.departmentId,
        roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
        ...(def.technician ? { technician: { create: def.technician } } : {}),
      },
    });

    // Re-running the seed must not wipe a password you changed while testing,
    // hence `update: {}` above; roles are reconciled separately.
    for (const role of roleRows) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
      });
    }
  }
  console.log(`  users         ${userDefinitions.length}`);

  console.log('\nSeed complete. Sign in with any of these:\n');
  console.log('   ROLE                  EMAIL                             PASSWORD');
  console.log('   --------------------  --------------------------------  -------------');
  for (const u of userDefinitions) {
    console.log(`   ${u.roles[0].padEnd(20)}  ${u.email.padEnd(32)}  ${DEFAULT_PASSWORD}`);
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
