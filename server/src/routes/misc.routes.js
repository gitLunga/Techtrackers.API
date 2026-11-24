/**
 * src/routes/misc.routes.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The remaining feature routers: technicians, collaborations, notifications,
 *   feedback and reports. Each is a handful of lines, so they are grouped and
 *   exported individually rather than spread over five near-empty files.
 */
import { Router } from 'express';
import * as technicianController from '../controllers/technician.controller.js';
import * as collaborationController from '../controllers/collaboration.controller.js';
import * as notificationController from '../controllers/notification.controller.js';
import * as feedbackController from '../controllers/feedback.controller.js';
import * as reportController from '../controllers/report.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate, idParam } from '../middleware/validate.js';
import schemas from '../validators/misc.validator.js';
import { ROLES } from '../constants/index.js';

/* ------------------------------ technicians ----------------------------- */
export const technicianRouter = Router();
technicianRouter.use(authenticate);
// Anyone signed in may see the technician list (the collaboration picker needs it).
technicianRouter.get('/', technicianController.listTechnicians);
// Own stats, or anyone's if you are ADMIN/HOD — the check is in the controller
// because it depends on the id being requested, not just on the role.
technicianRouter.get('/:id/stats', validate({ params: idParam() }), technicianController.getTechnicianStats);
technicianRouter.get('/:id/rating', validate({ params: idParam() }), feedbackController.getTechnicianRating);

/* ---------------------------- collaborations ---------------------------- */
export const collaborationRouter = Router();
collaborationRouter.use(authenticate);
collaborationRouter.get('/', validate(schemas.listCollaborationsSchema), collaborationController.list);
collaborationRouter.post(
  '/',
  authorize(ROLES.TECHNICIAN, ROLES.EXTERNAL_TECHNICIAN, ROLES.ADMIN),
  validate(schemas.createCollaborationSchema),
  collaborationController.requestCollaboration,
);
// No role check: the service enforces that ONLY the invitee may respond, which
// is a per-record rule that a role check cannot express.
collaborationRouter.patch('/:id', validate(schemas.respondCollaborationSchema), collaborationController.respond);
collaborationRouter.delete('/:id', validate({ params: idParam() }), collaborationController.cancel);

/* ----------------------------- notifications ---------------------------- */
export const notificationRouter = Router();
notificationRouter.use(authenticate);
// Every route here is implicitly "mine" — no user id appears in any URL.
notificationRouter.get('/', validate(schemas.listNotificationsSchema), notificationController.list);
notificationRouter.get('/unread-count', notificationController.unreadCount);
notificationRouter.patch('/read-all', notificationController.markAllAsRead);
notificationRouter.patch('/:id/read', validate({ params: idParam() }), notificationController.markAsRead);

/* -------------------------------- feedback ------------------------------ */
export const feedbackRouter = Router();
feedbackRouter.use(authenticate);
feedbackRouter.post('/', validate(schemas.createFeedbackSchema), feedbackController.submit);

/* -------------------------------- reports ------------------------------- */
export const reportRouter = Router();
reportRouter.use(authenticate);
// Reports are management information: staff have no route in here at all.
reportRouter.use(authorize(ROLES.ADMIN, ROLES.HOD, ROLES.TECHNICIAN));
reportRouter.get('/status-counts', validate(schemas.reportRangeSchema), reportController.statusCounts);
reportRouter.get('/issues', validate(schemas.reportRangeSchema), reportController.issues);
reportRouter.get('/monthly-summary', validate(schemas.reportRangeSchema), reportController.monthlySummary);
reportRouter.get('/technician-performance', authorize(ROLES.ADMIN, ROLES.HOD), validate(schemas.reportRangeSchema), reportController.technicianPerformance);
reportRouter.get('/sla-compliance', validate(schemas.reportRangeSchema), reportController.slaCompliance);

export default {
  technicianRouter,
  collaborationRouter,
  notificationRouter,
  feedbackRouter,
  reportRouter,
};
