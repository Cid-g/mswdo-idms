'use strict';

const supertest = require('supertest');
const mongoose  = require('mongoose');
const app       = require('../../src/app');
const db        = require('../dbHelpers');
const { createTestUser, getToken } = require('../testHelpers');
const Applicant  = require('../../src/models/Applicant');
const IDRecord   = require('../../src/models/IDRecord');

let token;
let encoderUser;

beforeAll(async () => {
  await db.connect();
  encoderUser = await createTestUser({ username: 'enc_ids', role: 'ENCODER', department: 'PWD' });
  token = await getToken(app, 'enc_ids');
});

afterAll(async () => { await db.disconnect(); });
afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of ['applicants', 'idrecords', 'idtemplates', 'sequences', 'auditlogs']) {
    if (collections[key]) await collections[key].deleteMany({});
  }
});

async function createApplicant(overrides = {}) {
  return Applicant.create({
    firstName:   'Test',
    lastName:    'Applicant',
    birthdate:   new Date('1990-01-01'),
    barangay:    'Poblacion 1',
    department:  'PWD',
    encodedById: encoderUser._id,
    status:      'PARTIAL',
    ...overrides,
  });
}

describe('POST /api/id-records', () => {
  test('returns 400 when applicantId is missing', async () => {
    const res = await supertest(app)
      .post('/api/id-records')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 404 when applicant does not exist', async () => {
    const res = await supertest(app)
      .post('/api/id-records')
      .set('Authorization', `Bearer ${token}`)
      .send({ applicantId: '000000000000000000000000' });

    expect(res.status).toBe(404);
  });

  test('returns 400 when applicant has no photo', async () => {
    const applicant = await createApplicant(); // no photoPath

    const res = await supertest(app)
      .post('/api/id-records')
      .set('Authorization', `Bearer ${token}`)
      .send({ applicantId: applicant._id.toString() });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/photo/i);
  });

  test('returns 400 when no active front template exists', async () => {
    // Both photo AND signature are now required before the template check runs
    const applicant = await createApplicant({
      photoPath:     'uploads/photos/dummy.png',
      signaturePath: 'uploads/signatures/dummy.png',
    });

    const res = await supertest(app)
      .post('/api/id-records')
      .set('Authorization', `Bearer ${token}`)
      .send({ applicantId: applicant._id.toString() });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/template/i);
  });

  test('returns 400 when applicant has no signature', async () => {
    const applicant = await createApplicant({ photoPath: 'uploads/photos/dummy.png' });

    const res = await supertest(app)
      .post('/api/id-records')
      .set('Authorization', `Bearer ${token}`)
      .send({ applicantId: applicant._id.toString() });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/signature/i);
  });

  test('returns 403 when encoder tries to generate ID for another dept', async () => {
    const scApplicant = await createApplicant({ department: 'SENIOR_CITIZEN' });

    const res = await supertest(app)
      .post('/api/id-records')
      .set('Authorization', `Bearer ${token}`) // token is PWD ENCODER
      .send({ applicantId: scApplicant._id.toString() });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('returns 401 with no token', async () => {
    const res = await supertest(app)
      .post('/api/id-records')
      .send({ applicantId: '000000000000000000000000' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/id-records', () => {
  test('returns 404 when no ID record exists for the applicant', async () => {
    const applicant = await createApplicant();

    const res = await supertest(app)
      .get(`/api/id-records?applicantId=${applicant._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('returns 400 when applicantId query param is missing', async () => {
    const res = await supertest(app)
      .get('/api/id-records')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
