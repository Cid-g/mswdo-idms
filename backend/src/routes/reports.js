const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { listReports, getReportData, exportReport } = require('../controllers/reportsController');

router.get('/',           authenticate, requireRole('ADMIN'), listReports);
router.get('/:id',        authenticate, requireRole('ADMIN'), getReportData);
router.get('/:id/export', authenticate, requireRole('ADMIN'), exportReport);

module.exports = router;
