'use strict';

const router = require('express').Router();
const {
  getVerificationSyncStatus,
  resyncVerificationRecord,
  retryVerificationSyncOperation,
} = require('../controllers/verificationSyncController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

// Verification synchronization is system-wide and contains operational metadata.
// Visibility and recovery are SuperAdmin-only. Retry only requeues an existing
// immutable FAILED row. Full-record resync creates a new authoritative revision
// from current local sources. The background sender remains the sole cloud write path.
router.get('/status', authenticate, requireRole('SUPERADMIN'), getVerificationSyncStatus);

router.post(
  '/records/:idRecordRef/resync',
  authenticate,
  requireRole('SUPERADMIN'),
  resyncVerificationRecord
);
router.post(
  '/operations/:operationRef/retry',
  authenticate,
  requireRole('SUPERADMIN'),
  retryVerificationSyncOperation
);

module.exports = router;
