/**
 * src/routes/push.routes.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Browser push subscription management. `public-key` is unauthenticated
 *   (the frontend needs it before a user is signed in, e.g. to decide whether
 *   to show a "enable notifications" prompt); subscribe/unsubscribe require a
 *   signed-in user since a subscription always belongs to one.
 */
import { Router } from 'express';
import * as pushController from '../controllers/push.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import schemas from '../validators/push.validator.js';

const router = Router();

router.get('/public-key', pushController.publicKey);
router.post('/subscribe', authenticate, validate(schemas.subscribeSchema), pushController.subscribe);
router.post('/unsubscribe', authenticate, validate(schemas.unsubscribeSchema), pushController.unsubscribe);

export default router;
