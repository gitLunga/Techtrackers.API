/**
 * src/controllers/collaboration.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Replaces CollabController.cs (and deletes the dead CollaControllerB.cs stub).
 *   Notice how much smaller it is than the original: everything that shrank was
 *   business logic that has moved into collaboration.service.js where it can be
 *   reused and tested.
 *
 * WHAT IT ACHIEVES
 *   Note that every handler passes `req.user` into the service. That is the fix
 *   for the old API's central flaw here: its endpoints took a technician id from
 *   the URL, so anyone could accept or list anyone else's collaborations.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created, paginated } from '../utils/apiResponse.js';
import getPagination from '../utils/pagination.js';
import * as collaborationService from '../services/collaboration.service.js';

export const requestCollaboration = asyncHandler(async (req, res) => {
  const collaboration = await collaborationService.requestCollaboration({
    ...req.body,
    requester: req.user,
  });
  return created(res, collaboration, 'Collaboration request sent');
});

export const respond = asyncHandler(async (req, res) => {
  const collaboration = await collaborationService.respondToCollaboration({
    collaborationId: req.params.id,
    status: req.body.status,
    responder: req.user,
  });
  return ok(res, collaboration, `Collaboration request ${req.body.status.toLowerCase()}`);
});

export const cancel = asyncHandler(async (req, res) => {
  const collaboration = await collaborationService.cancelCollaboration({
    collaborationId: req.params.id,
    actor: req.user,
  });
  return ok(res, collaboration, 'Collaboration request cancelled');
});

export const list = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query);
  const { items, total } = await collaborationService.listCollaborations({
    user: req.user,
    status: req.query.status,
    direction: req.query.direction,
    skip,
    take,
  });
  return paginated(res, items, { page, limit, total }, `${total} collaboration request(s)`);
});

export default { requestCollaboration, respond, cancel, list };
