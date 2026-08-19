/**
 * src/routes/index.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   ASP.NET discovered controllers by reflection — `app.MapControllers()` found
 *   them automatically. Express has no such magic, which is actually useful: it
 *   forces the API's full shape to be written down in one file.
 *
 * WHAT IT ACHIEVES
 *   THE map of the API. Every URL prefix in the system appears here exactly
 *   once, so app.js never needs to know what features exist, and adding a
 *   feature is a one-line change in a place you can find.
 *
 *   The `/` index route is a live directory of the API — handy in Postman and
 *   for anyone meeting the codebase for the first time.
 */
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import logRoutes from './log.routes.js';
import userRoutes from './user.routes.js';
import { departmentRouter, categoryRouter, slaRouter } from './reference.routes.js';
import {
  technicianRouter,
  collaborationRouter,
  notificationRouter,
  feedbackRouter,
  reportRouter,
} from './misc.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/logs', logRoutes);
router.use('/technicians', technicianRouter);
router.use('/departments', departmentRouter);
router.use('/categories', categoryRouter);
router.use('/slas', slaRouter);
router.use('/collaborations', collaborationRouter);
router.use('/notifications', notificationRouter);
router.use('/feedback', feedbackRouter);
router.use('/reports', reportRouter);

/** Self-describing index — GET /api/v1 lists what is mounted. */
router.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Techtrackers API v1',
    data: {
      endpoints: {
        auth: '/auth (login, refresh, logout, me, forgot-password, verify-otp, reset-password, change-password)',
        users: '/users (admin user management)',
        logs: '/logs (tickets: create, list, status, assign, escalate, chat, feedback, attachments)',
        technicians: '/technicians (assignable list, per-technician stats and ratings)',
        departments: '/departments',
        categories: '/categories',
        slas: '/slas (SLA targets per priority)',
        collaborations: '/collaborations',
        notifications: '/notifications',
        feedback: '/feedback',
        reports: '/reports (status-counts, issues, monthly-summary, technician-performance, sla-compliance)',
      },
    },
  });
});

export default router;
