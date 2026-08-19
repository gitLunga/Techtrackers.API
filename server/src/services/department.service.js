/**
 * src/services/department.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The C# DepartmentService was the closest thing in the old codebase to a
 *   clean layer (it had an IDepartmentService interface), so this is mostly a
 *   faithful port — plus the guard rails it was missing.
 *
 * WHAT IT ACHIEVES
 *   Reference-data CRUD for departments, and it owns the department CODE
 *   ("ICT", "HR") used to build ticket references. Deriving those initials at
 *   runtime — as LogService and AdminLogsService each did, differently — meant
 *   renaming a department silently changed the reference format of every future
 *   ticket. Storing the code fixes that.
 */
import prisma from '../config/prisma.js';
import ApiError from '../utils/ApiError.js';

/** "Information Technology" -> "IT"; used only to suggest a code. */
function deriveCode(name) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return initials.slice(0, 5) || name.slice(0, 3).toUpperCase();
}

export async function listDepartments() {
  return prisma.department.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { users: true, logs: true } } },
  });
}

export async function getDepartmentById(id) {
  const department = await prisma.department.findUnique({
    where: { id },
    include: { _count: { select: { users: true, logs: true } } },
  });
  if (!department) throw ApiError.notFound(`Department ${id} not found`);
  return department;
}

export async function createDepartment({ name, code }) {
  return prisma.department.create({
    data: { name: name.trim(), code: (code ?? deriveCode(name)).toUpperCase() },
  });
}

export async function updateDepartment(id, { name, code }) {
  await getDepartmentById(id);
  return prisma.department.update({
    where: { id },
    data: {
      ...(name ? { name: name.trim() } : {}),
      ...(code ? { code: code.toUpperCase() } : {}),
    },
  });
}

/**
 * Blocked while anything references the department. The old DeleteDepartment
 * called Remove() unconditionally, so it either threw a raw SQL FK error back
 * at the client as a 500, or orphaned rows where the FK was not enforced.
 */
export async function deleteDepartment(id) {
  const department = await getDepartmentById(id);
  if (department._count.users > 0 || department._count.logs > 0) {
    throw ApiError.conflict(
      `"${department.name}" still has ${department._count.users} user(s) and ${department._count.logs} ticket(s). Move them first.`,
    );
  }
  await prisma.department.delete({ where: { id } });
}

export default {
  listDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment,
};
