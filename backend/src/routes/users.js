const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditLog } = require('../middleware/auditLog');
const { photoUpload } = require('../lib/upload');
const {
  createUser, getUsers, getUserById, updateUser, updateStatus, resetPassword, changeOwnPassword, updateOwnProfile,
} = require('../controllers/userController');

const SA_OR_ADMIN = requireRole('SUPERADMIN', 'ADMIN');

router.use(authenticate);

const targetUserId = (req) => req.params.id;
const ownId        = (req) => req.user.id;

router.patch('/me/profile',          photoUpload.single('avatar'), auditLog('USER_UPDATED', 'Profile updated', 'User', ownId), updateOwnProfile);
router.patch('/me/password',         auditLog('USER_UPDATED', 'Password changed', 'User', ownId), changeOwnPassword);
router.post('/',                    SA_OR_ADMIN, auditLog('USER_CREATED', 'New staff account created', 'User'), createUser);
router.get('/',                     SA_OR_ADMIN, getUsers);
router.get('/:id',                  SA_OR_ADMIN, getUserById);
router.patch('/:id',                SA_OR_ADMIN, auditLog('USER_UPDATED', 'Staff account updated', 'User', targetUserId), updateUser);
router.patch('/:id/status',         SA_OR_ADMIN, auditLog('USER_STATUS_CHANGED', 'Staff account status changed', 'User', targetUserId), updateStatus);
router.post('/:id/reset-password',  SA_OR_ADMIN, auditLog('USER_UPDATED', 'Staff password reset', 'User', targetUserId), resetPassword);

module.exports = router;
