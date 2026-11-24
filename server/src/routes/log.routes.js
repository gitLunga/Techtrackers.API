/**
 * src/routes/log.routes.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The ticket API surface, in one readable list. Compare with the old system,
 *   where ticket endpoints were spread over LogController, AdminLogController,
 *   ManageLogsController and TechController with URLs like
 *   `PUT /api/ManageLogs/ChangeLogStatus/{issueId}/{newStatus}` — a verb in the
 *   path and the new state as a URL segment.
 *
 * WHAT IT ACHIEVES
 *   Resource-shaped URLs (/logs/:id/status, /logs/:id/assign) and, more
 *   importantly, VISIBLE POLICY: the `authorize(...)` on each line tells you who
 *   may call it without opening the controller.
 *
 *   `router.use(authenticate)` at the top means every route below is protected
 *   by default — you have to opt OUT, not remember to opt in.
 */
import { Router } from 'express';
import * as logController from '../controllers/log.controller.js';
import * as chatController from '../controllers/chat.controller.js';
import * as feedbackController from '../controllers/feedback.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate, idParam } from '../middleware/validate.js';
import { withAttachments } from '../middleware/upload.js';
import logSchemas from '../validators/log.validator.js';
import miscSchemas from '../validators/misc.validator.js';
import { ROLES } from '../constants/index.js';

const router = Router();

// Everything below requires a valid token.
router.use(authenticate);

/**
 * Create a ticket. `withAttachments` runs BEFORE validate because multipart
 * bodies are not parsed until multer has consumed the stream — until then
 * req.body is empty and any validation would fail on every field.
 */
router.post('/', withAttachments, validate(logSchemas.createLogSchema), logController.createLog);

// Scoped automatically to what the caller may see; no role check needed.
router.get('/', validate(logSchemas.listLogsSchema), logController.listLogs);

// Declared before '/:id' so "counts" is not swallowed as an id.
router.get('/counts', logController.getCounts);

router.get('/:id', validate({ params: idParam() }), logController.getLog);
router.get('/:id/sla', validate({ params: idParam() }), logController.getSlaStatus);
router.get('/:id/history', validate({ params: idParam() }), logController.getHistory);

router.patch('/:id/status', validate(logSchemas.changeStatusSchema), logController.changeStatus);

// Dispatching work is an admin/HOD action.
router.post('/:id/assign', authorize(ROLES.ADMIN, ROLES.HOD), validate(logSchemas.assignSchema), logController.assign);
router.delete('/:id/assign', authorize(ROLES.ADMIN, ROLES.HOD), validate({ params: idParam() }), logController.unassign);
router.get('/:id/suggest-technician', authorize(ROLES.ADMIN, ROLES.HOD), validate({ params: idParam() }), logController.suggestTechnician);

router.post('/:id/reopen', authorize(ROLES.ADMIN, ROLES.HOD, ROLES.STAFF), validate(logSchemas.reopenSchema), logController.reopen);
router.post('/:id/escalate', authorize(ROLES.ADMIN, ROLES.HOD), validate(logSchemas.escalateSchema), logController.escalate);

router.get('/:id/attachments/:attachmentId', validate(logSchemas.attachmentParamsSchema), logController.downloadAttachment);

// Sub-resources of a ticket: chat and feedback live under the ticket they belong to.
router.get('/:id/chat', validate({ params: idParam() }), chatController.getMessages);
router.post('/:id/chat', validate(miscSchemas.sendChatSchema), chatController.sendMessage);
router.get('/:id/feedback', validate({ params: idParam() }), feedbackController.getForLog);

export default router;
