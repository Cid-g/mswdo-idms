const router = require('express').Router();
const { authenticate }  = require('../middleware/auth');
const { requireRole }   = require('../middleware/rbac');
const { templateUpload } = require('../lib/upload');
const {
  getTemplate,
  createVersion,
  listVersions,
  getVersion,
  activateVersion,
  updateVersionConfig,
  previewVersion,
} = require('../controllers/templateController');

router.use(authenticate);

const ALL = requireRole('SUPERADMIN', 'ADMIN', 'ENCODER', 'RELEASING_STAFF');

router.get('/', ALL, getTemplate);

router.post(
  '/versions',
  ALL,
  templateUpload.fields([
    { name: 'frontFile', maxCount: 1 },
    { name: 'backFile',  maxCount: 1 },
  ]),
  createVersion,
);

router.get('/versions/:versionId',                  ALL, getVersion);
router.patch('/versions/:versionId/activate',       ALL, activateVersion);
router.patch('/versions/:versionId/config',         ALL, updateVersionConfig);
router.get('/versions/:versionId/preview',          ALL, previewVersion);

router.get('/:templateId/versions',                 ALL, listVersions);

module.exports = router;
