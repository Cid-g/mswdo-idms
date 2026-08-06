'use strict';

const router = require('express').Router();
const {
  getVerificationSyncStatus,
  retryVerificationSyncOperation,
} = require('../controllers/verificationSyncController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

// Verification synchronization is system-wide and contains operational metadata.
// Visibility and recovery are SuperAdmin-only. Retry only requeues an existing
// immutable FAILED row; the background sender remains the sole cloud write path.
router.get('/status', authenticate, requireRole('SUPERADMIN'), getVerificationSyncStatus);
router.post(
  '/operations/:operationRef/retry',
  authenticate,
  requireRole('SUPERADMIN'),
  retryVerificationSyncOperation
);

module.exports = router;
