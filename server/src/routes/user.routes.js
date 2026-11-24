/**
 * src/routes/user.routes.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   User administration is the most privileged surface in the system, so its
 *   access policy needs to be obvious rather than buried. Every route here is
 *   ADMIN-only except the two reads an HOD legitimately needs for their own
 *   department's staffing.
 *
 * WHAT IT ACHIEVES
 *   `router.use(authenticate)` then per-route `authorize(...)`. Read the file
 *   top to bottom and you have the complete answer to "who can create users?".
 */
import { Router } from 'express';
import * as userController from '../controllers/user.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate, idParam } from '../middleware/validate.js';
import schemas from '../validators/user.validator.js';
import { ROLES } from '../constants/index.js';

const router = Router();

router.use(authenticate);

router.get('/roles', authorize(ROLES.ADMIN, ROLES.HOD), userController.listRoles);

router.post('/', authorize(ROLES.ADMIN), validate(schemas.createUserSchema), userController.createUser);
router.get('/', authorize(ROLES.ADMIN, ROLES.HOD), validate(schemas.listUsersSchema), userController.listUsers);
router.get('/:id', authorize(ROLES.ADMIN, ROLES.HOD), validate({ params: idParam() }), userController.getUser);
router.patch('/:id', authorize(ROLES.ADMIN), validate(schemas.updateUserSchema), userController.updateUser);

// Deactivate, not delete — see user.service.js for why.
router.delete('/:id', authorize(ROLES.ADMIN), validate({ params: idParam() }), userController.deactivateUser);
router.post('/:id/reactivate', authorize(ROLES.ADMIN), validate({ params: idParam() }), userController.reactivateUser);

export default router;
