/**
 * RBAC middleware factory functions.
 * Always call after authenticate middleware so req.user is set.
 *
 * Usage:
 *   router.get('/...', authenticate, requireRole('SUPERADMIN'), handler)
 *   router.get('/...', authenticate, requireRole('ADMIN', 'ENCODER', 'RELEASING_STAFF'), handler)
 *   router.patch('/...', authenticate, requireRole('ADMIN'), requireDept('PWD'), handler)
 */

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `Access restricted to: ${roles.join(', ')}.`,
        },
      });
    }
    next();
  };
}

/**
 * Requires req.user.department to match `dept`.
 * SUPERADMIN bypasses this check (they have cross-dept access).
 */
function requireDept(dept) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
      });
    }
    if (req.user.role === 'SUPERADMIN') return next();
    if (req.user.department !== dept) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `This resource belongs to the ${dept} department.`,
        },
      });
    }
    next();
  };
}

module.exports = { requireRole, requireDept };
