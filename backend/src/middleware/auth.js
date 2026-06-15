const jwt = require('jsonwebtoken');

/**
 * Verifies the Bearer JWT and attaches { id, role, department } to req.user.
 * Does NOT do a database lookup — the JWT payload carries sufficient info for most checks.
 * Use GET /auth/me when you need the full user document.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'No authentication token provided.' },
    });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: payload.id,
      role: payload.role,
      department: payload.department,
    };
    next();
  } catch (err) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Token is invalid or has expired.' },
    });
  }
}

module.exports = { authenticate };
