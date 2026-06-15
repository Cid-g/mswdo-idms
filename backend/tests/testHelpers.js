'use strict';

const bcrypt    = require('bcryptjs');
const supertest = require('supertest');
const User      = require('../src/models/User');

const TEST_PASSWORD = 'Test@1234!';

async function createTestUser(overrides = {}) {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const defaults = {
    firstName:    'Test',
    lastName:     'User',
    username:     `testuser_${suffix}`,
    email:        `test_${suffix}@example.com`,
    passwordHash: await bcrypt.hash(TEST_PASSWORD, 1), // low rounds for test speed
    role:         'ENCODER',
    department:   'PWD',
    status:       'ACTIVE',
  };
  return User.create({ ...defaults, ...overrides });
}

async function getToken(app, username) {
  const res = await supertest(app)
    .post('/api/auth/login')
    .send({ username, password: TEST_PASSWORD });
  return res.body.accessToken;
}

module.exports = { createTestUser, getToken, TEST_PASSWORD };
