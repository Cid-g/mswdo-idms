const router = require('express').Router();
const { authenticate }  = require('../middleware/auth');
const { requireRole }   = require('../middleware/rbac');
const { getAuditLogs, getAuditActions, getAuditUsers } = require('../controllers/auditLogController');

// SA + ADMIN can access audit logs
router.get('/',       authenticate, requireRole('SUPERADMIN', 'ADMIN'), getAuditLogs);
router.get('/actions',authenticate, requireRole('SUPERADMIN', 'ADMIN'), getAuditActions);
router.get('/users',  authenticate, requireRole('SUPERADMIN', 'ADMIN'), getAuditUsers);

module.exports = router;
