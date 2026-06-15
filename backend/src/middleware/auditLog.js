const AuditLog = require('../models/AuditLog');

/**
 * autoAuditLog — attach to any route that mutates data.
 * Logs to AuditLog collection AFTER the response is sent (non-blocking).
 * Only logs 2xx responses where req.user is present.
 *
 * For explicit action descriptions, use auditLog(action, description) instead.
 */
function autoAuditLog(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
      AuditLog.create({
        userId: req.user.id,
        action: `${req.method}:${req.route?.path ?? req.path}`,
        department: req.user.department,
        targetType: null,
        targetId: null,
        description: `${req.method} ${req.originalUrl} → ${res.statusCode}`,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        metadata: { method: req.method, url: req.originalUrl, statusCode: res.statusCode },
      }).catch((err) => {
        // Audit failure must never break the main flow
        console.error('[AuditLog] write error:', err.message);
      });
    }
  });

  next();
}

/**
 * auditLog — explicit audit entry with a specific action code and description.
 * Use when you need more precise logging than autoAuditLog.
 *
 * @param {string} action     - Machine-readable action code (e.g. 'ID_GENERATED')
 * @param {string|Function} description - Human-readable string, or fn(req) => string
 * @param {string} [targetType]         - e.g. 'Applicant', 'IDRecord', 'User'
 * @param {string|Function} [targetId]  - ObjectId string, or fn(req) => string
 */
function auditLog(action, description, targetType = null, targetId = null) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        const desc = typeof description === 'function' ? description(req) : description;
        const tId = typeof targetId === 'function' ? targetId(req) : targetId;

        AuditLog.create({
          userId: req.user.id,
          action,
          department: req.user.department,
          targetType,
          targetId: tId,
          description: desc,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          metadata: { method: req.method, url: req.originalUrl },
        }).catch((err) => {
          console.error('[AuditLog] write error:', err.message);
        });
      }
    });
    next();
  };
}

module.exports = { autoAuditLog, auditLog };
