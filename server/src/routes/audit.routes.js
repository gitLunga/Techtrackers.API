/**
 * src/routes/audit.routes.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Read-only surface for the admin action log. ADMIN-only — this is exactly
 *   the data an intruder or a curious HOD should not get to browse.
 */
import { Router } from 'express';
import * as auditController from '../controllers/audit.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import schemas from '../validators/audit.validator.js';
import { ROLES } from '../constants/index.js';

const router = Router();

router.use(authenticate);
router.use(authorize(ROLES.ADMIN));
router.get('/', validate(schemas.listAuditLogsSchema), auditController.list);

export default router;
