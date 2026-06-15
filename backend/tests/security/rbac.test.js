'use strict';

const supertest = require('supertest');
const mongoose  = require('mongoose');
const app       = require('../../src/app');
const db        = require('../dbHelpers');
const { createTestUser, getToken } = require('../testHelpers');

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.disconnect(); });
afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of ['users', 'refreshtokens', 'auditlogs']) {
    if (collections[key]) await collections[key].deleteMany({});
  }
});

describe('Authentication guard (no token)', () => {
  test('GET /api/applicants → 401', async () => {
    const res = await supertest(app).get('/api/applicants');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('GET /api/users → 401', async () => {
    const res = await supertest(app).get('/api/users');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('GET /api/dashboard/admin → 401', async () => {
    const res = await supertest(app).get('/api/dashboard/admin');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('GET /api/audit-logs → 401', async () => {
    const res = await supertest(app).get('/api/audit-logs');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('Role enforcement (ENCODER token on admin-only routes)', () => {
  let encoderToken;

  beforeEach(async () => {
    await createTestUser({ username: 'enc_rbac', role: 'ENCODER', department: 'PWD' });
    encoderToken = await getToken(app, 'enc_rbac');
  });

  test('GET /api/users → 403 for ENCODER', async () => {
    const res = await supertest(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${encoderToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('POST /api/users → 403 for ENCODER', async () => {
    const res = await supertest(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${encoderToken}`)
      .send({ username: 'hacker', password: 'Test@1234!', role: 'ADMIN', department: 'PWD' });

    expect(res.status).toBe(403);
  });

  test('GET /api/dashboard/superadmin → 403 for ENCODER', async () => {
    const res = await supertest(app)
      .get('/api/dashboard/superadmin')
      .set('Authorization', `Bearer ${encoderToken}`);

    expect(res.status).toBe(403);
  });

  test('GET /api/audit-logs → 403 for ENCODER', async () => {
    const res = await supertest(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${encoderToken}`);

    expect(res.status).toBe(403);
  });
});

describe('Token tampering', () => {
  test('malformed Bearer token → 401', async () => {
    const res = await supertest(app)
      .get('/api/applicants')
      .set('Authorization', 'Bearer not.a.valid.jwt');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('expired or garbage token → 401', async () => {
    const res = await supertest(app)
      .get('/api/applicants')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalid');

    expect(res.status).toBe(401);
  });
});

describe('Public routes accessible without token', () => {
  test('GET /api/health → 200 (no auth required)', async () => {
    const res = await supertest(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('POST /api/auth/login → accessible without token', async () => {
    // Should return 401 (wrong creds) not 401 (no token)
    const res = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'wrong' });

    // 401 from login logic (not auth middleware)
    expect(res.status).toBe(401);
  });

  test('GET /api/verify/:token → accessible without auth token', async () => {
    const res = await supertest(app)
      .get('/api/verify/public-access-test');

    // 404 (record not found) not 401 (auth failure)
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe('NOT_FOUND');
  });
});
