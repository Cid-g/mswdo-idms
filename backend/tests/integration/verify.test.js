'use strict';

const supertest  = require('supertest');
const mongoose   = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const app        = require('../../src/app');
const db         = require('../dbHelpers');
const { createTestUser } = require('../testHelpers');
const Applicant  = require('../../src/models/Applicant');
const IDRecord   = require('../../src/models/IDRecord');

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.disconnect(); });
afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of ['applicants', 'idrecords', 'users', 'blockchainanchors', 'auditlogs']) {
    if (collections[key]) await collections[key].deleteMany({});
  }
});

async function seedVerifiableRecord() {
  const encoder = await createTestUser({ username: 'enc_verify' });
  const applicant = await Applicant.create({
    firstName:   'Maria',
    lastName:    'Santos',
    birthdate:   new Date('1975-03-10'),
    barangay:    'Poblacion 1',
    department:  'PWD',
    encodedById: encoder._id,
    status:      'COMPLETE',
  });
  const qrToken = uuidv4();
  const idRecord = await IDRecord.create({
    applicantId: applicant._id,
    department:  'PWD',
    idNumber:    'PWD-2026-TEST-001',
    qrToken,
    status:      'ACTIVE',
    issuedDate:  new Date(),
    expiryDate:  new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000),
    idImagePath: 'uploads/ids/dummy-front.png',
  });
  return { applicant, idRecord, qrToken };
}

describe('GET /api/verify/:token — public endpoint, no auth required', () => {
  test('returns 404 for an unknown token', async () => {
    const res = await supertest(app)
      .get('/api/verify/this-token-does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toBe('NOT_FOUND');
  });

  test('returns 200 with masked name and id info for a valid token', async () => {
    const { qrToken } = await seedVerifiableRecord();

    const res = await supertest(app)
      .get(`/api/verify/${qrToken}`);

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.idNumber).toBe('PWD-2026-TEST-001');

    // Name must be masked
    expect(res.body.maskedName).toBeTruthy();
    expect(res.body.maskedName).not.toContain('Maria');
    expect(res.body.maskedName).not.toContain('Santos');
    // Format: "S****, M****"
    expect(res.body.maskedName).toMatch(/^[A-Z]\*+, [A-Z]\*+$/);
  });

  test('includes department label in response', async () => {
    const { qrToken } = await seedVerifiableRecord();

    const res = await supertest(app)
      .get(`/api/verify/${qrToken}`);

    expect(res.body.idType).toBe('PWD');
    expect(res.body.idTypeLabel).toBe('Person with Disability (PWD)');
  });

  test('blockchain shows anchored:false when no anchor exists', async () => {
    const { qrToken } = await seedVerifiableRecord();

    const res = await supertest(app)
      .get(`/api/verify/${qrToken}`);

    expect(res.body.blockchain).toBeDefined();
    expect(res.body.blockchain.anchored).toBe(false);
  });

  test('includes verifiedAt timestamp', async () => {
    const { qrToken } = await seedVerifiableRecord();

    const before = Date.now();
    const res = await supertest(app)
      .get(`/api/verify/${qrToken}`);
    const after = Date.now();

    const ts = new Date(res.body.verifiedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
