'use strict';

// Environment variables for all test suites.
// This file runs before each test file (setupFiles in jest.config.js).

process.env.NODE_ENV          = 'test';
process.env.JWT_SECRET        = 'test-secret-at-least-32-chars-long-for-jest';
process.env.JWT_ACCESS_EXPIRES  = '15m';
process.env.JWT_REFRESH_EXPIRES = '7d';
process.env.FABRIC_ENABLED    = 'false';
process.env.VERIFICATION_BASE_URL = 'http://localhost:5173/verify';
process.env.UPLOADS_DIR       = './uploads';
process.env.FRONTEND_URL      = 'http://localhost:5173';
