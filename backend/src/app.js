const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

// ── Security middleware ────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.set('trust proxy', 1); // trust first proxy so req.ip is correct for rate limiting

// ── General rate limiting (overridden on specific routes) ─────
// Skipped under tests so heavy suites aren't throttled (no test asserts rate-limiting).
if (process.env.NODE_ENV !== 'test') {
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  }));
}

// ── Body parsing ───────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Logging ────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ── Health check ───────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/users',       require('./routes/users'));       // Phase 3
app.use('/api/applicants',  require('./routes/applicants'));  // Phase 4 + 5
app.use('/api/files',       require('./routes/files'));       // Phase 5
app.use('/api/id-records',  require('./routes/idRecords'));   // Phase 7
app.use('/api/templates',   require('./routes/templates'));   // Phase 6
app.use('/api/dashboard',   require('./routes/dashboard'));   // Phase 9
app.use('/api/reports',     require('./routes/reports'));      // Reports tab
app.use('/api/audit-logs',   require('./routes/auditLogs'));   // Phase 10
app.use('/api/blockchain',  require('./routes/blockchain'));  // Phase 11
app.use('/api/verify',      require('./routes/verify'));      // Phase 12

// ── 404 handler ────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found.' },
  });
});

// ── Global error handler (matches API_SPEC error format) ───────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred.',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
});

module.exports = app;
