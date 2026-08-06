'use strict';

const router = require('express').Router();
const { getVerificationSyncStatus } = require('../controllers/verificationSyncController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

// Verification synchronization is system-wide and contains operational metadata.
// Read-only visibility remains SuperAdmin-only; recovery mutations are a later slice.
router.get('/status', authenticate, requireRole('SUPERADMIN'), getVerificationSyncStatus);

module.exports = router;
