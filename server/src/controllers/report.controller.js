/**
 * src/controllers/report.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Replaces GenerateReportController.cs, MonthlySummaryReportController.cs and
 *   TechPerformanceReportController.cs — three controllers holding one method
 *   each, all under different route prefixes, so the React app had to know three
 *   unrelated base URLs to draw one dashboard.
 *
 * WHAT IT ACHIEVES
 *   One /reports namespace. Every report accepts the same optional from/to range
 *   and is automatically scoped to what the caller may see, so an HOD's report
 *   covers their department and an admin's covers everything — without separate
 *   endpoints per role.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import * as reportService from '../services/report.service.js';

export const statusCounts = asyncHandler(async (req, res) =>
  ok(res, await reportService.getStatusCountReport(req.user, req.query), 'Status counts retrieved'));

export const issues = asyncHandler(async (req, res) => {
  const rows = await reportService.getIssueReport(req.user, req.query);
  return ok(res, rows, `${rows.length} ticket(s) in report`);
});

export const monthlySummary = asyncHandler(async (req, res) =>
  ok(res, await reportService.getMonthlySummary(req.user, req.query), 'Monthly summary retrieved'));

export const technicianPerformance = asyncHandler(async (req, res) =>
  ok(res, await reportService.getTechnicianPerformance(req.user, req.query), 'Technician performance retrieved'));

export const slaCompliance = asyncHandler(async (req, res) =>
  ok(res, await reportService.getSlaComplianceReport(req.user, req.query), 'SLA compliance retrieved'));

export default { statusCounts, issues, monthlySummary, technicianPerformance, slaCompliance };
