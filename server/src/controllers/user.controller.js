/**
 * src/controllers/user.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Replaces TechnicianHandler.cs and ExternalTechnicianHandler.cs, which were
 *   near-identical copies differing only in a hard-coded "internal"/"external"
 *   string, plus the dead AddUserService. A technician is a USER with a role —
 *   not a separate kind of thing needing its own controller.
 *
 * WHAT IT ACHIEVES
 *   One place to administer people. Technician-specific reads live under
 *   /technicians (see technician.controller.js) because that is a genuinely
 *   different question — "who can I assign work to?" — not a different entity.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/apiResponse.js';
import getPagination from '../utils/pagination.js';
import * as userService from '../services/user.service.js';

export const createUser = asyncHandler(async (req, res) => {
  const user = await userService.createUser(req.body, req.user.id);
  return created(res, user, `User ${user.email} created`);
});

export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query);
  const { items, total } = await userService.listUsers({ filters: req.query, skip, take });
  return res.status(200).json({
    success: true,
    message: `${total} user(s) found`,
    data: items,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await userService.getUserById(req.params.id);
  return ok(res, user, 'User retrieved');
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await userService.updateUser(req.params.id, req.body, req.user.id);
  return ok(res, user, 'User updated');
});

export const deactivateUser = asyncHandler(async (req, res) => {
  const result = await userService.deactivateUser(req.params.id, req.user.id);
  return ok(res, null, result.message);
});

export const reactivateUser = asyncHandler(async (req, res) => {
  const result = await userService.reactivateUser(req.params.id, req.user.id);
  return ok(res, null, result.message);
});

export const listRoles = asyncHandler(async (_req, res) => {
  const roles = await userService.listRoles();
  return ok(res, roles, 'Roles retrieved');
});

export default {
  createUser, listUsers, getUser, updateUser, deactivateUser, reactivateUser, listRoles,
};
