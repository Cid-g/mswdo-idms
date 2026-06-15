'use strict';

const supertest = require('supertest');
const app       = require('../../src/app');
const db        = require('../dbHelpers');
const { createTestUser, TEST_PASSWORD } = require('../testHelpers');

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.disconnect(); });
afterEach(async () => { await db.clear(); });

describe('POST /api/auth/login', () => {
  test('returns 200 with tokens on valid credentials', async () => {
    const user = await createTestUser({ username: 'encoder1' });

    const res = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'encoder1', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.username).toBe('encoder1');
    expect(res.body.user.role).toBe(user.role);
  });

  test('returns 401 for wrong password', async () => {
    await createTestUser({ username: 'encoder2' });

    const res = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'encoder2', password: 'WrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('returns 401 for non-existent username', async () => {
    const res = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'whatever' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('returns 400 when username or password is missing', async () => {
    const res = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'encoder1' }); // no password

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 403 for inactive account', async () => {
    await createTestUser({ username: 'suspended', status: 'INACTIVE' });

    const res = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'suspended', password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /api/auth/refresh', () => {
  test('returns a new accessToken given a valid refreshToken', async () => {
    await createTestUser({ username: 'refreshuser' });

    const loginRes = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'refreshuser', password: TEST_PASSWORD });
    const { refreshToken } = loginRes.body;

    const refreshRes = await supertest(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).toBeTruthy();
    // New token should differ from old (rotation)
    expect(refreshRes.body.refreshToken).not.toBe(refreshToken);
  });

  test('returns 401 when no refreshToken is provided', async () => {
    const res = await supertest(app)
      .post('/api/auth/refresh')
      .send({});
    expect(res.status).toBe(401);
  });

  test('returns 401 for an invalid refreshToken', async () => {
    const res = await supertest(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'not-a-valid-token' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  test('returns user profile with a valid token', async () => {
    await createTestUser({ username: 'meuser' });

    const loginRes = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'meuser', password: TEST_PASSWORD });
    const { accessToken } = loginRes.body;

    const res = await supertest(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('meuser');
    expect(res.body.passwordHash).toBeUndefined(); // must not leak hash
  });

  test('returns 401 with no token', async () => {
    const res = await supertest(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
