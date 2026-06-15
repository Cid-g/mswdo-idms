const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/rbac');
const {
  createIDRecord,
  listIDRecords,
  getIDRecordById,
  getIDImage,
  getIDBackImage,
  releaseIDRecord,
  reprintIDRecord,
  revokeIDRecord,
  getPrintQueue,
  batchLogPrint,
  batchReleaseIDRecords,
} = require('../controllers/idRecordController');
const { auditLog } = require('../middleware/auditLog');

router.use(authenticate);

const ALL = requireRole('SUPERADMIN', 'ADMIN', 'ENCODER', 'RELEASING_STAFF');

router.get('/',                  ALL,      listIDRecords);
router.post('/',                 ALL,      createIDRecord);
router.get('/print-queue',       ALL,      getPrintQueue);
router.post('/batch-log-print',  ALL,      batchLogPrint);
router.post('/batch-release',    ALL,      batchReleaseIDRecords);
router.get('/:id',               ALL,      getIDRecordById);
router.get('/:id/image',         ALL,      getIDImage);
router.get('/:id/image/back',    ALL,      getIDBackImage);
router.post('/:id/release',      ALL,      releaseIDRecord);
router.post('/:id/reprint',      ALL,      reprintIDRecord);
router.post(
  '/:id/revoke',
  ALL,
  auditLog('ID_REVOKED', (req) => `ID cancelled. Reason: ${req.body?.reason ?? '—'}`, 'IDRecord', (req) => req.params.id),
  revokeIDRecord,
);

module.exports = router;
