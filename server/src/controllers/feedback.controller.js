/**
 * src/controllers/feedback.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Replaces FeedbackController.cs. The old version took the rater's identity
 *   from the request body (`User_ID`), which is what allowed anyone to post
 *   feedback as anyone else — and made the technician performance scores
 *   derived from it meaningless.
 *
 * WHAT IT ACHIEVES
 *   The rater is `req.user`. There is no field in the request that can name a
 *   different one.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/apiResponse.js';
import * as feedbackService from '../services/feedback.service.js';

export const submit = asyncHandler(async (req, res) => {
  const feedback = await feedbackService.submitFeedback({ ...req.body, user: req.user });
  return created(res, feedback, 'Thank you for your feedback');
});

export const getForLog = asyncHandler(async (req, res) => {
  const feedback = await feedbackService.getFeedbackForLog(req.params.id, req.user);
  return ok(res, feedback, `${feedback.length} feedback entr(ies)`);
});

export const getTechnicianRating = asyncHandler(async (req, res) => {
  const rating = await feedbackService.getTechnicianRating(req.params.id);
  return ok(res, rating, 'Technician rating retrieved');
});

export default { submit, getForLog, getTechnicianRating };
