/**
 * src/routes/reference.routes.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Departments, categories and SLAs share one policy shape — ANY signed-in user
 *   may READ them (the log form needs the dropdowns), only an ADMIN may WRITE.
 *   Grouping them makes that symmetry visible; three separate files would hide it.
 *
 * WHAT IT ACHIEVES
 *   Three small routers mounted under /departments, /categories and /slas.
 */
import { Router } from 'express';
import * as referenceController from '../controllers/reference.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate, idParam } from '../middleware/validate.js';
import schemas from '../validators/misc.validator.js';
import { ROLES } from '../constants/index.js';

/* ------------------------------ departments ----------------------------- */
export const departmentRouter = Router();
departmentRouter.use(authenticate);
departmentRouter.get('/', referenceController.listDepartments);
departmentRouter.get('/:id', validate({ params: idParam() }), referenceController.getDepartment);
departmentRouter.post('/', authorize(ROLES.ADMIN), validate(schemas.createDepartmentSchema), referenceController.createDepartment);
departmentRouter.patch('/:id', authorize(ROLES.ADMIN), validate(schemas.updateDepartmentSchema), referenceController.updateDepartment);
departmentRouter.delete('/:id', authorize(ROLES.ADMIN), validate({ params: idParam() }), referenceController.deleteDepartment);

/* ------------------------------- categories ----------------------------- */
export const categoryRouter = Router();
categoryRouter.use(authenticate);
categoryRouter.get('/', referenceController.listCategories);
categoryRouter.get('/:id', validate({ params: idParam() }), referenceController.getCategory);
categoryRouter.post('/', authorize(ROLES.ADMIN), validate(schemas.categoryBodySchema), referenceController.createCategory);
categoryRouter.patch('/:id', authorize(ROLES.ADMIN), validate(schemas.categoryUpdateSchema), referenceController.updateCategory);
categoryRouter.delete('/:id', authorize(ROLES.ADMIN), validate({ params: idParam() }), referenceController.deleteCategory);

/* ---------------------------------- SLAs -------------------------------- */
export const slaRouter = Router();
slaRouter.use(authenticate);
slaRouter.get('/', referenceController.listSlas);
slaRouter.get('/:id', validate({ params: idParam() }), referenceController.getSla);
// Upsert: one SLA per priority, so POSTing an existing priority updates it.
slaRouter.post('/', authorize(ROLES.ADMIN), validate(schemas.upsertSlaSchema), referenceController.upsertSla);
slaRouter.delete('/:id', authorize(ROLES.ADMIN), validate({ params: idParam() }), referenceController.deleteSla);

export default { departmentRouter, categoryRouter, slaRouter };
