/**
 * src/services/user.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   AddUserService.cs — the file that was supposed to own user management — was
 *   ENTIRELY COMMENTED OUT in the C# repo, so there was no working way to create
 *   a user through the API at all. Users had to be inserted by hand in SQL.
 *   Meanwhile TechnicianHandler and ExternalTechnicianHandler each created users
 *   their own way.
 *
 * WHAT IT ACHIEVES
 *   Working, role-aware user administration: create, list (filter/search),
 *   read, update, deactivate, and role assignment. Creating a technician also
 *   creates the linked Technician profile in the same transaction, so the two
 *   tables cannot disagree.
 */
import prisma from '../config/prisma.js';
import ApiError from '../utils/ApiError.js';
import { hashPassword } from '../utils/password.js';
import { publicUser } from './auth.service.js';
import { ROLES, TECHNICIAN_TYPE } from '../constants/index.js';
import * as auditService from './audit.service.js';

const userInclude = {
  department: true,
  roles: { include: { role: true } },
  technician: true,
};

const TECH_ROLES = [ROLES.TECHNICIAN, ROLES.EXTERNAL_TECHNICIAN];

/** "08:30" -> 510 minutes past midnight. */
function timeToMinutes(value, fallback) {
  if (!value) return fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) throw ApiError.badRequest(`Invalid time "${value}". Use HH:MM, e.g. 08:30.`);
  const [, h, m] = match;
  const minutes = Number(h) * 60 + Number(m);
  if (minutes > 1439) throw ApiError.badRequest(`Invalid time "${value}"`);
  return minutes;
}

export async function createUser(payload, actorId) {
  const {
    surname, initials, email, password, phone,
    departmentId, roles, technicianProfile,
  } = payload;

  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) throw ApiError.badRequest(`Department ${departmentId} does not exist`);

  const roleRows = await prisma.role.findMany({ where: { name: { in: roles } } });
  if (roleRows.length !== roles.length) {
    const found = roleRows.map((r) => r.name);
    throw ApiError.badRequest(`Unknown role(s): ${roles.filter((r) => !found.includes(r)).join(', ')}`);
  }

  const isTechnician = roles.some((r) => TECH_ROLES.includes(r));

  const user = await prisma.user.create({
    data: {
      surname,
      initials: initials ?? '',
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      phone: phone ?? null,
      departmentId,
      roles: { create: roleRows.map((role) => ({ roleId: role.id })) },
      // Created in the SAME statement as the user, so a technician can never
      // exist without their profile.
      ...(isTechnician
        ? {
            technician: {
              create: {
                specialization: technicianProfile?.specialization ?? null,
                contacts: technicianProfile?.contacts ?? phone ?? null,
                availableFrom: timeToMinutes(technicianProfile?.availableFrom, 480),
                availableTo: timeToMinutes(technicianProfile?.availableTo, 1020),
                type: roles.includes(ROLES.EXTERNAL_TECHNICIAN)
                  ? TECHNICIAN_TYPE.EXTERNAL
                  : (technicianProfile?.type ?? TECHNICIAN_TYPE.INTERNAL),
                location: technicianProfile?.location ?? null,
              },
            },
          }
        : {}),
    },
    include: userInclude,
  });

  await auditService.recordAction({
    actorId, action: 'user.create', targetType: 'User', targetId: user.id,
    metadata: { email: user.email, roles },
  });

  return { ...publicUser(user), technicianProfile: user.technician ?? null };
}

export async function listUsers({ filters = {}, skip, take }) {
  const where = {};
  if (filters.role) where.roles = { some: { role: { name: filters.role } } };
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (typeof filters.isActive === 'boolean') where.isActive = filters.isActive;
  if (filters.search) {
    where.OR = [
      { surname: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
      { initials: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({ where, include: userInclude, orderBy: { surname: 'asc' }, skip, take }),
    prisma.user.count({ where }),
  ]);

  return {
    items: rows.map((u) => ({ ...publicUser(u), technicianProfile: u.technician ?? null })),
    total,
  };
}

export async function getUserById(id) {
  const user = await prisma.user.findUnique({ where: { id }, include: userInclude });
  if (!user) throw ApiError.notFound(`User ${id} not found`);
  return { ...publicUser(user), technicianProfile: user.technician ?? null };
}

export async function updateUser(id, payload, actorId) {
  const existing = await prisma.user.findUnique({ where: { id }, include: userInclude });
  if (!existing) throw ApiError.notFound(`User ${id} not found`);

  const data = {};
  if (payload.surname !== undefined) data.surname = payload.surname;
  if (payload.initials !== undefined) data.initials = payload.initials;
  if (payload.phone !== undefined) data.phone = payload.phone;
  if (payload.isActive !== undefined) data.isActive = payload.isActive;
  if (payload.email !== undefined) data.email = payload.email.toLowerCase();
  if (payload.departmentId !== undefined) {
    const dept = await prisma.department.findUnique({ where: { id: payload.departmentId } });
    if (!dept) throw ApiError.badRequest(`Department ${payload.departmentId} does not exist`);
    data.departmentId = payload.departmentId;
  }

  const user = await prisma.$transaction(async (tx) => {
    // Roles are replaced wholesale rather than merged, so the request body is
    // the complete truth and a removed role is actually removed.
    if (payload.roles) {
      const roleRows = await tx.role.findMany({ where: { name: { in: payload.roles } } });
      if (roleRows.length !== payload.roles.length) {
        throw ApiError.badRequest('One or more roles do not exist');
      }
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({
        data: roleRows.map((role) => ({ userId: id, roleId: role.id })),
      });
    }

    if (payload.technicianProfile) {
      const p = payload.technicianProfile;
      const profileData = {
        specialization: p.specialization ?? undefined,
        contacts: p.contacts ?? undefined,
        location: p.location ?? undefined,
        type: p.type ?? undefined,
        ...(p.availableFrom ? { availableFrom: timeToMinutes(p.availableFrom) } : {}),
        ...(p.availableTo ? { availableTo: timeToMinutes(p.availableTo) } : {}),
      };
      await tx.technician.upsert({
        where: { userId: id },
        update: profileData,
        create: { userId: id, ...profileData },
      });
    }

    return tx.user.update({ where: { id }, data, include: userInclude });
  });

  await auditService.recordAction({
    actorId, action: 'user.update', targetType: 'User', targetId: id,
    metadata: { fields: Object.keys(payload) },
  });

  return { ...publicUser(user), technicianProfile: user.technician ?? null };
}

/**
 * Deactivate rather than DELETE. A user is referenced by every ticket they
 * logged or worked; hard-deleting them would either cascade away real history
 * or fail on a foreign key. Deactivating blocks sign-in and hides them from
 * assignment lists while keeping the audit trail intact.
 */
export async function deactivateUser(id, actorId) {
  if (id === actorId) throw ApiError.badRequest('You cannot deactivate your own account');

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw ApiError.notFound(`User ${id} not found`);
  if (!user.isActive) throw ApiError.conflict('That account is already deactivated');

  const openTickets = await prisma.log.count({
    where: { technicianId: id, status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED'] } },
  });
  if (openTickets > 0) {
    throw ApiError.conflict(
      `This technician still has ${openTickets} open ticket(s). Reassign them before deactivating.`,
    );
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { isActive: false } }),
    prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await auditService.recordAction({
    actorId, action: 'user.deactivate', targetType: 'User', targetId: id,
    metadata: { email: user.email },
  });

  return { message: 'User deactivated and signed out of all devices' };
}

export async function reactivateUser(id, actorId) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw ApiError.notFound(`User ${id} not found`);
  await prisma.user.update({ where: { id }, data: { isActive: true } });

  await auditService.recordAction({
    actorId, action: 'user.reactivate', targetType: 'User', targetId: id,
    metadata: { email: user.email },
  });

  return { message: 'User reactivated' };
}

export async function listRoles() {
  return prisma.role.findMany({ orderBy: { id: 'asc' } });
}

export default {
  createUser,
  listUsers,
  getUserById,
  updateUser,
  deactivateUser,
  reactivateUser,
  listRoles,
};
