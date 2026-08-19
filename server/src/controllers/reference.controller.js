/**
 * src/controllers/reference.controller.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Departments, categories and SLAs are "reference data": small, admin-managed
 *   lists that everything else points at. Their controllers are pure CRUD with
 *   no interesting logic, so keeping the three together avoids three files of
 *   six near-identical lines each.
 *
 *   (This is a judgement call, not a rule. The moment any of them grows real
 *   behaviour, it earns its own file.)
 *
 * WHAT IT ACHIEVES
 *   Gives the React app the endpoints it needs to populate dropdowns, and gives
 *   admins a way to configure SLA targets — which the old system had no API for
 *   at all, despite SLA being its headline feature.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created, noContent } from '../utils/apiResponse.js';
import * as departmentService from '../services/department.service.js';
import * as categoryService from '../services/category.service.js';
import * as slaService from '../services/sla.service.js';

/* ------------------------------ departments ----------------------------- */
export const listDepartments = asyncHandler(async (_req, res) =>
  ok(res, await departmentService.listDepartments(), 'Departments retrieved'));

export const getDepartment = asyncHandler(async (req, res) =>
  ok(res, await departmentService.getDepartmentById(req.params.id), 'Department retrieved'));

export const createDepartment = asyncHandler(async (req, res) =>
  created(res, await departmentService.createDepartment(req.body), 'Department created'));

export const updateDepartment = asyncHandler(async (req, res) =>
  ok(res, await departmentService.updateDepartment(req.params.id, req.body), 'Department updated'));

export const deleteDepartment = asyncHandler(async (req, res) => {
  await departmentService.deleteDepartment(req.params.id);
  return noContent(res);
});

/* ------------------------------- categories ----------------------------- */
export const listCategories = asyncHandler(async (_req, res) =>
  ok(res, await categoryService.listCategories(), 'Categories retrieved'));

export const getCategory = asyncHandler(async (req, res) =>
  ok(res, await categoryService.getCategoryById(req.params.id), 'Category retrieved'));

export const createCategory = asyncHandler(async (req, res) =>
  created(res, await categoryService.createCategory(req.body), 'Category created'));

export const updateCategory = asyncHandler(async (req, res) =>
  ok(res, await categoryService.updateCategory(req.params.id, req.body), 'Category updated'));

export const deleteCategory = asyncHandler(async (req, res) => {
  await categoryService.deleteCategory(req.params.id);
  return noContent(res);
});

/* ---------------------------------- SLAs -------------------------------- */
export const listSlas = asyncHandler(async (_req, res) =>
  ok(res, await slaService.listSlas(), 'SLAs retrieved'));

export const getSla = asyncHandler(async (req, res) =>
  ok(res, await slaService.getSlaById(req.params.id), 'SLA retrieved'));

/**
 * Upsert rather than create: there is exactly one SLA per priority, so posting
 * the same priority twice should update the target, not fail on a duplicate.
 */
export const upsertSla = asyncHandler(async (req, res) =>
  ok(res, await slaService.upsertSla(req.body), 'SLA saved'));

export const deleteSla = asyncHandler(async (req, res) => {
  await slaService.deleteSla(req.params.id);
  return noContent(res);
});

export default {
  listDepartments, getDepartment, createDepartment, updateDepartment, deleteDepartment,
  listCategories, getCategory, createCategory, updateCategory, deleteCategory,
  listSlas, getSla, upsertSla, deleteSla,
};
