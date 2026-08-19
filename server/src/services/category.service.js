/**
 * src/services/category.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Category.cs existed as a model and the Logs table pointed at it, but there
 *   was NO controller and NO service to manage categories — the only way to add
 *   one was a manual INSERT. Any staff member logging a ticket had to know a
 *   valid CategoryId by heart.
 *
 * WHAT IT ACHIEVES
 *   Plain CRUD so an admin can curate the issue categories from the UI, and the
 *   log form can populate its dropdown from GET /categories.
 */
import prisma from '../config/prisma.js';
import ApiError from '../utils/ApiError.js';

export async function listCategories() {
  return prisma.category.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { logs: true } } },
  });
}

export async function getCategoryById(id) {
  const category = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { logs: true } } },
  });
  if (!category) throw ApiError.notFound(`Category ${id} not found`);
  return category;
}

export async function createCategory({ name }) {
  return prisma.category.create({ data: { name: name.trim() } });
}

export async function updateCategory(id, { name }) {
  await getCategoryById(id);
  return prisma.category.update({ where: { id }, data: { name: name.trim() } });
}

export async function deleteCategory(id) {
  const category = await getCategoryById(id);
  if (category._count.logs > 0) {
    throw ApiError.conflict(
      `"${category.name}" is used by ${category._count.logs} ticket(s) and cannot be deleted.`,
    );
  }
  await prisma.category.delete({ where: { id } });
}

export default { listCategories, getCategoryById, createCategory, updateCategory, deleteCategory };
