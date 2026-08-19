/**
 * src/routes/auth.routes.js
 * -----------------------------------------------------------------------------
 * WHY ROUTE FILES EXIST AT ALL
 *   In ASP.NET, routing lived on the controller as attributes ([Route], [HttpPost]),
 *   so you could not see the API's shape without opening every controller — and
 *   `[Route("api/[controller]/[action]")]` meant URLs were generated from C#
 *   METHOD NAMES. Renaming a method silently broke the frontend.
 *
 *   Express separates routing from handlers. That is an advantage worth using:
 *   a routes file is a readable TABLE OF CONTENTS of the API. URLs are written
 *   down explicitly, so renaming a function can never change a URL.
 *
 * HOW TO READ ONE
 *   Each line is:  METHOD  path  ->  [middleware chain]  ->  controller
 *   The chain runs left to right and each link can stop the request:
 *       authLimiter  -> throttle abuse
 *       authenticate -> who are you?           (401 if unknown)
 *       authorize    -> may you do this?       (403 if not)
 *       validate     -> is the input sane?     (422 if not)
 *       controller   -> do it
 *   This is the same pipeline as ASP.NET's [Authorize] + ModelState, but visible
 *   in one place instead of spread across attributes.
 */
import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import schemas from '../validators/auth.validator.js';

const router = Router();

// ---- public (no token required) -------------------------------------------
router.post('/login', authLimiter, validate(schemas.loginSchema), authController.login);
router.post('/refresh', validate(schemas.refreshSchema), authController.refresh);

// Password reset: three steps, all rate-limited because all are unauthenticated.
router.post('/forgot-password', authLimiter, validate(schemas.requestOtpSchema), authController.requestOtp);
router.post('/verify-otp', authLimiter, validate(schemas.verifyOtpSchema), authController.verifyOtp);
router.post('/reset-password', authLimiter, validate(schemas.resetPasswordSchema), authController.resetPassword);

// ---- authenticated ---------------------------------------------------------
router.post('/logout', authenticate, validate(schemas.logoutSchema), authController.logout);
router.get('/me', authenticate, authController.me);
router.post('/change-password', authenticate, validate(schemas.changePasswordSchema), authController.changePassword);

export default router;
