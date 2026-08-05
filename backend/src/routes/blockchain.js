const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/rbac');
const {
  anchorRecord,
  verifyRecord,
  getAnchorStatus,
  getHealth,
  getSyncStatus,
  retrySyncOperation,
  reconcileBlockchain,
  listAnchors,
  simulateTamper,
} = require('../controllers/blockchainController');

// Operational mutations and recovery controls are SuperAdmin-only.
router.post('/anchor/:idRecordId', authenticate, requireRole('SUPERADMIN'), anchorRecord);
router.get('/health',              authenticate, requireRole('SUPERADMIN'), getHealth);
router.get('/sync-status',         authenticate, requireRole('SUPERADMIN'), getSyncStatus);
router.post('/sync/:operationId/retry', authenticate, requireRole('SUPERADMIN'), retrySyncOperation);
router.post('/reconcile',          authenticate, requireRole('SUPERADMIN'), reconcileBlockchain);
router.get('/anchors',             authenticate, requireRole('SUPERADMIN'), listAnchors);
router.get('/simulate-tamper/:idNumber', authenticate, requireRole('SUPERADMIN'), simulateTamper);

// Read-only staff integrity/status surfaces retain their existing role access.
router.get('/verify/:idNumber',   authenticate, requireRole('SUPERADMIN', 'ADMIN', 'ENCODER', 'RELEASING_STAFF'), verifyRecord);
router.get('/status/:idRecordId', authenticate, requireRole('SUPERADMIN', 'ADMIN', 'ENCODER', 'RELEASING_STAFF'), getAnchorStatus);

module.exports = router;
