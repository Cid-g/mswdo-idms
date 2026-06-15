const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { getSuperadminDashboard, getAdminDashboard } = require('../controllers/dashboardController');

router.get('/superadmin', authenticate, requireRole('SUPERADMIN'), getSuperadminDashboard);
router.get('/admin',      authenticate, requireRole('ADMIN'),      getAdminDashboard);

module.exports = router;
