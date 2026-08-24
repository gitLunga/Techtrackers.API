/**
 * src/services/asset.service.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The system tracked tickets ABOUT hardware but never the hardware itself —
 *   "Hardware Failure" was just a category name. This gives admins an actual
 *   inventory: what exists, where, who has it, and (via Log.assetId) which
 *   tickets have been raised against it.
 *
 * WHAT IT ACHIEVES
 *   Plain CRUD plus assignment, all audited — same shape as user/department/
 *   category/SLA administration.
 */
import prisma from '../config/prisma.js';
import ApiError from '../utils/ApiError.js';
import * as auditService from './audit.service.js';

const assetInclude = {
  department: { select: { id: true, name: true, code: true } },
  assignedTo: { select: { id: true, surname: true, initials: true } },
  _count: { select: { logs: true } },
};

const fullName = (u) => (u ? `${u.initials ?? ''} ${u.surname ?? ''}`.trim() : null);

function toAssetResponse(asset) {
  if (!asset) return null;
  return {
    ...asset,
    assignedTo: asset.assignedTo ? { ...asset.assignedTo, name: fullName(asset.assignedTo) } : null,
    ticketCount: asset._count?.logs ?? 0,
    _count: undefined,
  };
}

export async function listAssets({ filters = {}, skip, take }) {
  const where = {};
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.status) where.status = filters.status;
  if (filters.assignedToId) where.assignedToId = filters.assignedToId;
  if (filters.search) {
    where.OR = [
      { tag: { contains: filters.search, mode: 'insensitive' } },
      { name: { contains: filters.search, mode: 'insensitive' } },
      { serialNumber: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await prisma.$transaction([
    prisma.asset.findMany({ where, include: assetInclude, orderBy: { tag: 'asc' }, skip, take }),
    prisma.asset.count({ where }),
  ]);

  return { items: rows.map(toAssetResponse), total };
}

export async function getAssetById(id) {
  const asset = await prisma.asset.findUnique({ where: { id }, include: assetInclude });
  if (!asset) throw ApiError.notFound(`Asset ${id} not found`);
  return toAssetResponse(asset);
}

/** Also used to validate an assetId supplied elsewhere (e.g. ticket creation). */
export async function assertAssetExists(id) {
  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) throw ApiError.badRequest(`Asset ${id} does not exist`);
  return asset;
}

export async function createAsset(payload, actorId) {
  const department = await prisma.department.findUnique({ where: { id: payload.departmentId } });
  if (!department) throw ApiError.badRequest(`Department ${payload.departmentId} does not exist`);
  if (payload.assignedToId) {
    const user = await prisma.user.findUnique({ where: { id: payload.assignedToId } });
    if (!user) throw ApiError.badRequest(`User ${payload.assignedToId} does not exist`);
  }

  const existingTag = await prisma.asset.findUnique({ where: { tag: payload.tag } });
  if (existingTag) throw ApiError.conflict(`Asset tag "${payload.tag}" is already in use`);

  const asset = await prisma.asset.create({ data: payload, include: assetInclude });

  await auditService.recordAction({
    actorId, action: 'asset.create', targetType: 'Asset', targetId: asset.id,
    metadata: { tag: asset.tag, name: asset.name },
  });

  return toAssetResponse(asset);
}

export async function updateAsset(id, payload, actorId) {
  await getAssetById(id);

  if (payload.departmentId) {
    const department = await prisma.department.findUnique({ where: { id: payload.departmentId } });
    if (!department) throw ApiError.badRequest(`Department ${payload.departmentId} does not exist`);
  }
  if (payload.assignedToId) {
    const user = await prisma.user.findUnique({ where: { id: payload.assignedToId } });
    if (!user) throw ApiError.badRequest(`User ${payload.assignedToId} does not exist`);
  }
  if (payload.tag) {
    const existingTag = await prisma.asset.findUnique({ where: { tag: payload.tag } });
    if (existingTag && existingTag.id !== id) throw ApiError.conflict(`Asset tag "${payload.tag}" is already in use`);
  }

  const asset = await prisma.asset.update({ where: { id }, data: payload, include: assetInclude });

  await auditService.recordAction({
    actorId, action: 'asset.update', targetType: 'Asset', targetId: id,
    metadata: { fields: Object.keys(payload) },
  });

  return toAssetResponse(asset);
}

/**
 * Blocked while any ticket references the asset, same guard rail pattern as
 * departments/categories — a hard delete would otherwise either orphan the
 * ticket's assetId or throw a raw FK error.
 */
export async function deleteAsset(id, actorId) {
  const asset = await prisma.asset.findUnique({ where: { id }, include: { _count: { select: { logs: true } } } });
  if (!asset) throw ApiError.notFound(`Asset ${id} not found`);
  if (asset._count.logs > 0) {
    throw ApiError.conflict(`"${asset.tag}" is referenced by ${asset._count.logs} ticket(s) and cannot be deleted. Retire it instead.`);
  }

  await prisma.asset.delete({ where: { id } });
  await auditService.recordAction({
    actorId, action: 'asset.delete', targetType: 'Asset', targetId: id,
    metadata: { tag: asset.tag },
  });
}

export default { listAssets, getAssetById, assertAssetExists, createAsset, updateAsset, deleteAsset };
