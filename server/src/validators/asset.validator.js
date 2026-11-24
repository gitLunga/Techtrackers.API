/**
 * src/validators/asset.validator.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Assets get their own file rather than joining misc.validator.js — unlike
 *   departments/categories/SLAs (small, fixed reference lists), assets are a
 *   real, growing entity with its own lifecycle (assignment, status, retirement).
 */
import { z } from 'zod';
import { id, pagination } from './common.validator.js';
import { ASSET_STATUS } from '../constants/index.js';

const assetStatus = z.enum(Object.values(ASSET_STATUS));

export const createAssetSchema = {
  body: z.object({
    tag: z.string().trim().min(2).max(50),
    name: z.string().trim().min(2).max(150),
    type: z.string().trim().min(2).max(50),
    serialNumber: z.string().trim().max(100).optional(),
    departmentId: id,
    status: assetStatus.optional().default(ASSET_STATUS.IN_STORAGE),
    assignedToId: id.optional(),
    notes: z.string().trim().max(1000).optional(),
    purchaseDate: z.coerce.date().optional(),
  }),
};

export const updateAssetSchema = {
  params: z.object({ id }),
  body: z
    .object({
      tag: z.string().trim().min(2).max(50).optional(),
      name: z.string().trim().min(2).max(150).optional(),
      type: z.string().trim().min(2).max(50).optional(),
      serialNumber: z.string().trim().max(100).optional(),
      departmentId: id.optional(),
      status: assetStatus.optional(),
      // Explicit null clears the assignment; omitted leaves it unchanged.
      assignedToId: id.nullable().optional(),
      notes: z.string().trim().max(1000).optional(),
      purchaseDate: z.coerce.date().optional(),
    })
    .refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update' }),
};

export const listAssetsSchema = {
  query: pagination.extend({
    departmentId: id.optional(),
    status: assetStatus.optional(),
    assignedToId: id.optional(),
    search: z.string().trim().min(1).max(100).optional(),
  }),
};

export default { createAssetSchema, updateAssetSchema, listAssetsSchema };
