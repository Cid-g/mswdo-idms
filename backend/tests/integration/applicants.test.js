'use strict';

const supertest = require('supertest');
const app       = require('../../src/app');
const db        = require('../dbHelpers');
const { createTestUser, getToken } = require('../testHelpers');

let token;
let userId;

beforeAll(async () => {
  await db.connect();
  const user = await createTestUser({ username: 'enc_pwd', role: 'ENCODER', department: 'PWD' });
  userId = user._id.toString();
  token  = await getToken(app, 'enc_pwd');
});

afterAll(async () => { await db.disconnect(); });
afterEach(async () => {
  const mongoose = require('mongoose');
  const { collections } = mongoose.connection;
  // clear applicants and sequences between tests but keep users
  for (const key of ['applicants', 'sequences', 'auditlogs']) {
    if (collections[key]) await collections[key].deleteMany({});
  }
});

const VALID_APPLICANT = {
  firstName: 'Juan',
  lastName:  'Dela Cruz',
  birthdate: '1990-05-15',
  barangay:  'Poblacion 1',
};

describe('POST /api/applicants', () => {
  test('creates an applicant and returns 201', async () => {
    const res = await supertest(app)
      .post('/api/applicants')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_APPLICANT);

    expect(res.status).toBe(201);
    expect(res.body.firstName).toBe('Juan');
    expect(res.body.department).toBe('PWD');
    expect(res.body.status).toBe('PARTIAL');
    expect(res.body.controlNumber).toMatch(/^\d{4}-\d+$/); // YYYY-NNN
  });

  test('returns 400 when required fields are missing', async () => {
    const res = await supertest(app)
      .post('/api/applicants')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Only' }); // missing lastName + birthdate

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 401 with no token', async () => {
    const res = await supertest(app)
      .post('/api/applicants')
      .send(VALID_APPLICANT);

    expect(res.status).toBe(401);
  });
});

describe('GET /api/applicants', () => {
  test('returns paginated list scoped to user department', async () => {
    // Create two applicants
    await supertest(app)
      .post('/api/applicants')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_APPLICANT, firstName: 'Alice' });
    await supertest(app)
      .post('/api/applicants')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_APPLICANT, firstName: 'Bob' });

    const res = await supertest(app)
      .get('/api/applicants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    // All returned applicants must be from user's dept
    res.body.data.forEach((a) => expect(a.department).toBe('PWD'));
  });

  test('supports search by name', async () => {
    await supertest(app)
      .post('/api/applicants')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_APPLICANT, lastName: 'UniqueSearchName' });

    const res = await supertest(app)
      .get('/api/applicants?search=UniqueSearchName')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].lastName).toBe('UniqueSearchName');
  });
});

describe('GET /api/applicants/:id', () => {
  test('returns an applicant by id', async () => {
    const create = await supertest(app)
      .post('/api/applicants')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_APPLICANT);
    const id = create.body._id;

    const res = await supertest(app)
      .get(`/api/applicants/${id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(id);
    expect(res.body.firstName).toBe('Juan');
  });

  test('returns 404 for unknown id', async () => {
    const res = await supertest(app)
      .get('/api/applicants/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/applicants/:id', () => {
  test('updates base fields', async () => {
    const create = await supertest(app)
      .post('/api/applicants')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_APPLICANT);
    const id = create.body._id;

    const res = await supertest(app)
      .patch(`/api/applicants/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ contactNumber: '09171234567', purokStreet: 'Purok 3' });

    expect(res.status).toBe(200);
    expect(res.body.contactNumber).toBe('09171234567');
    expect(res.body.purokStreet).toBe('Purok 3');
  });
});
