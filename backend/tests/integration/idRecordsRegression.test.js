'use strict';

// Regression tests for the two fixes applied during the 2026-05-30 code review:
//   Bug #1 — reissue an ID after revocation must work (partial unique index on
//            applicantId, ACTIVE-only — revoked records no longer block a reissue).
//   Bug #2 — id-record read/release/reprint/image endpoints must enforce the
//            same department check that revoke already had (no cross-dept access).

const supertest = require('supertest');
const mongoose  = require('mongoose');
const app       = require('../../src/app');
const db        = require('../dbHelpers');
const { createTestUser, getToken } = require('../testHelpers');
const Applicant  = require('../../src/models/Applicant');
const IDRecord   = require('../../src/models/IDRecord');

let pwdToken;
let pwdEncoder;

beforeAll(async () => {
  await db.connect();
  // The partial unique index on applicantId must exist for the uniqueness
  // behaviour to be exercised by these tests.
  await IDRecord.syncIndexes();
  pwdEncoder = await createTestUser({ username: 'enc_reg', role: 'ENCODER', department: 'PWD' });
  pwdToken   = await getToken(app, 'enc_reg');
});

afterAll(async () => { await db.disconnect(); });

afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of ['applicants', 'idrecords', 'auditlogs']) {
    if (collections[key]) await collections[key].deleteMany({});
  }
});

async function makeApplicant(overrides = {}) {
  return Applicant.create({
    firstName:   'Test',
    lastName:    'Applicant',
    birthdate:   new Date('1990-01-01'),
    barangay:    'Poblacion 1',
    department:  'PWD',
    encodedById: pwdEncoder._id,
    status:      'PARTIAL',
    ...overrides,
  });
}

let idCounter = 0;
function makeIDRecord(applicant, overrides = {}) {
  idCounter += 1;
  return IDRecord.create({
    applicantId: applicant._id,
    department:  applicant.department,
    idNumber:    `03-6906-000-${String(idCounter).padStart(7, '0')}`,
    qrToken:     `tok-${idCounter}-${Date.now()}`,
    status:      'ACTIVE',
    ...overrides,
  });
}

// ── Bug #1 — reissue after revoke ──────────────────────────────────────────────
describe('Bug #1 — reissue ID after revocation', () => {
  test('allows a new ACTIVE ID once the previous one is REVOKED', async () => {
    const applicant = await makeApplicant();

    const first = await makeIDRecord(applicant);
    // Simulate revocation (what POST /:id/revoke persists)
    first.status = 'REVOKED';
    await first.save();

    // A replacement ID for the same applicant must now be allowed
    await expect(makeIDRecord(applicant)).resolves.toBeDefined();

    const active = await IDRecord.countDocuments({ applicantId: applicant._id, status: 'ACTIVE' });
    expect(active).toBe(1);
  });

  test('still rejects TWO simultaneously ACTIVE IDs for the same applicant', async () => {
    const applicant = await makeApplicant();
    await makeIDRecord(applicant); // first ACTIVE

    // Second ACTIVE for the same applicant must violate the partial unique index
    await expect(makeIDRecord(applicant)).rejects.toThrow();
  });
});

// ── Bug #2 — cross-department access guard ─────────────────────────────────────
describe('Bug #2 — cross-dept access on id-record endpoints', () => {
  // pwdToken is a PWD encoder; the record below belongs to SENIOR_CITIZEN.
  async function foreignRecord() {
    const scApplicant = await makeApplicant({ department: 'SENIOR_CITIZEN' });
    return makeIDRecord(scApplicant, { department: 'SENIOR_CITIZEN' });
  }

  test('GET /:id → 403 for a record in another department', async () => {
    const rec = await foreignRecord();
    const res = await supertest(app)
      .get(`/api/id-records/${rec._id}`)
      .set('Authorization', `Bearer ${pwdToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('GET /:id/image → 403 for a record in another department', async () => {
    const rec = await foreignRecord();
    const res = await supertest(app)
      .get(`/api/id-records/${rec._id}/image`)
      .set('Authorization', `Bearer ${pwdToken}`);
    expect(res.status).toBe(403);
  });

  test('POST /:id/release → 403 for a record in another department', async () => {
    const rec = await foreignRecord();
    const res = await supertest(app)
      .post(`/api/id-records/${rec._id}/release`)
      .set('Authorization', `Bearer ${pwdToken}`);
    expect(res.status).toBe(403);
  });

  test('POST /:id/reprint → 403 for a record in another department', async () => {
    const rec = await foreignRecord();
    const res = await supertest(app)
      .post(`/api/id-records/${rec._id}/reprint`)
      .set('Authorization', `Bearer ${pwdToken}`);
    expect(res.status).toBe(403);
  });

  test('GET /:id → 200 for a record in the user own department', async () => {
    const ownApplicant = await makeApplicant({ department: 'PWD' });
    const rec = await makeIDRecord(ownApplicant, { department: 'PWD' });
    const res = await supertest(app)
      .get(`/api/id-records/${rec._id}`)
      .set('Authorization', `Bearer ${pwdToken}`);
    expect(res.status).toBe(200);
    expect(res.body.idNumber).toBe(rec.idNumber);
  });
});
