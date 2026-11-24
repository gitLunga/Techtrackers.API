/**
 * src/controllers/asset.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Thin HTTP adapter over asset.service.js — same shape as every other
 *   controller in this API.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created, noContent, paginated } from '../utils/apiResponse.js';
import getPagination from '../utils/pagination.js';
import * as assetService from '../services/asset.service.js';

export const list = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query);
  const { items, total } = await assetService.listAssets({ filters: req.query, skip, take });
  return paginated(res, items, { page, limit, total }, `${total} asset(s) found`);
});

export const get = asyncHandler(async (req, res) =>
  ok(res, await assetService.getAssetById(req.params.id), 'Asset retrieved'));

export const create = asyncHandler(async (req, res) =>
  created(res, await assetService.createAsset(req.body, req.user.id), `Asset ${req.body.tag} created`));

export const update = asyncHandler(async (req, res) =>
  ok(res, await assetService.updateAsset(req.params.id, req.body, req.user.id), 'Asset updated'));

export const remove = asyncHandler(async (req, res) => {
  await assetService.deleteAsset(req.params.id, req.user.id);
  return noContent(res);
});

export default { list, get, create, update, remove };
