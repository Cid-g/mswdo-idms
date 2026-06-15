const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { login, refresh, logout, me } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { auditLog } = require('../middleware/auditLog');

// Per API_SPEC: 10 req/min on login, 30 req/min on refresh.
// Disabled under tests (heavy suites make many logins; no test asserts rate-limiting).
const noopLimiter = (req, res, next) => next();
const isTest = process.env.NODE_ENV === 'test';

const loginLimiter = isTest ? noopLimiter : rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMIT', message: 'Too many login attempts. Please wait 1 minute.' },
  },
});

const refreshLimiter = isTest ? noopLimiter : rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMIT', message: 'Too many refresh attempts.' },
  },
});

router.post(
  '/login',
  loginLimiter,
  auditLog('LOGIN', (req) => `User '${req.body.username}' attempted login`),
  login
);

router.post('/refresh', refreshLimiter, refresh);

router.post(
  '/logout',
  authenticate,
  auditLog('LOGOUT', (req) => `User logged out`),
  logout
);

router.get('/me', authenticate, me);

module.exports = router;
