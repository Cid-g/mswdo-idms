const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/rbac');
const {
  anchorRecord,
  verifyRecord,
  getAnchorStatus,
  getHealth,
  listAnchors,
  simulateTamper,
} = require('../controllers/blockchainController');

router.post('/anchor/:idRecordId', authenticate, requireRole('SUPERADMIN', 'ADMIN'), anchorRecord);
router.get('/verify/:idNumber',    authenticate, requireRole('SUPERADMIN', 'ADMIN', 'ENCODER', 'RELEASING_STAFF'), verifyRecord);
router.get('/status/:idRecordId',  authenticate, requireRole('SUPERADMIN', 'ADMIN', 'ENCODER', 'RELEASING_STAFF'), getAnchorStatus);
router.get('/health',              authenticate, requireRole('SUPERADMIN'), getHealth);
router.get('/anchors',             authenticate, requireRole('SUPERADMIN'), listAnchors);
router.get('/simulate-tamper/:idNumber', authenticate, requireRole('SUPERADMIN'), simulateTamper);

module.exports = router;
