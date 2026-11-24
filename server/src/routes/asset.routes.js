/**
 * src/routes/asset.routes.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   Same read/write split as departments/categories/SLAs: any signed-in user
 *   may read (the log-issue form's optional asset picker needs it), only an
 *   ADMIN may write.
 */
import { Router } from 'express';
import * as assetController from '../controllers/asset.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate, idParam } from '../middleware/validate.js';
import schemas from '../validators/asset.validator.js';
import { ROLES } from '../constants/index.js';

const router = Router();
router.use(authenticate);

router.get('/', validate(schemas.listAssetsSchema), assetController.list);
router.get('/:id', validate({ params: idParam() }), assetController.get);
router.post('/', authorize(ROLES.ADMIN), validate(schemas.createAssetSchema), assetController.create);
router.patch('/:id', authorize(ROLES.ADMIN), validate(schemas.updateAssetSchema), assetController.update);
router.delete('/:id', authorize(ROLES.ADMIN), validate({ params: idParam() }), assetController.remove);

export default router;
