'use strict';

const supertest = require('supertest');
const mongoose  = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const app = require('../../src/app');
const db  = require('../dbHelpers');
const { createTestUser, getToken } = require('../testHelpers');
const Applicant        = require('../../src/models/Applicant');
const IDRecord         = require('../../src/models/IDRecord');
const BlockchainAnchor = require('../../src/models/BlockchainAnchor');
const { computeHash }  = require('../../src/services/blockchain');

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.disconnect(); });
afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of ['applicants', 'idrecords', 'users', 'blockchainanchors', 'auditlogs']) {
    if (collections[key]) await collections[key].deleteMany({});
  }
  delete process.env.FABRIC_ENABLED;
});

// Seeds a complete applicant + active ID + a matching on-chain anchor.
async function seedAnchoredRecord() {
  const encoder = await createTestUser({ username: 'enc_bc', role: 'ENCODER' });
  const applicant = await Applicant.create({
    firstName: 'Maria', lastName: 'Santos', middleName: 'Reyes',
    birthdate: new Date('1975-03-10'), sex: 'Female',
    barangay: 'Poblacion 1', department: 'PWD',
    encodedById: encoder._id, status: 'COMPLETE',
  });
  const idRecord = await IDRecord.create({
    applicantId: applicant._id, department: 'PWD',
    idNumber: 'PWD-2026-TEST-001', qrToken: uuidv4(), status: 'ACTIVE',
    issuedDate: new Date('2026-05-01'),
    expiryDate: new Date('2031-05-01'),
    idImagePath: 'uploads/ids/dummy-front.png',
  });
  const { hash } = computeHash(applicant, idRecord);
  const anchor = await BlockchainAnchor.create({
    idRecordId: idRecord._id, recordRef: idRecord.idNumber,
    canonicalHash: hash, txId: 'tx-test-abc', blockNumber: 284,
    anchoredAt: new Date('2026-05-02'), lastCheckPassed: true,
  });
  return { applicant, idRecord, anchor };
}

async function superadminToken() {
  await createTestUser({ username: 'super_bc', role: 'SUPERADMIN', department: undefined });
  return getToken(app, 'super_bc');
}

describe('GET /api/blockchain/health', () => {
  test('reflects FABRIC_ENABLED=false', async () => {
    delete process.env.FABRIC_ENABLED;
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/health')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.fabricEnabled).toBe(false);
    expect(res.body.connected).toBe(false);
  });

  test('reflects FABRIC_ENABLED=true', async () => {
    process.env.FABRIC_ENABLED = 'true';
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/health')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.fabricEnabled).toBe(true);
    expect(res.body.connected).toBe(true);
  });

  test('rejects non-superadmin with 403', async () => {
    await createTestUser({ username: 'enc_only', role: 'ENCODER' });
    const token = await getToken(app, 'enc_only');
    const res = await supertest(app)
      .get('/api/blockchain/health')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/blockchain/anchors', () => {
  test('returns anchored records with applicant name', async () => {
    await seedAnchoredRecord();
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/anchors')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].idNumber).toBe('PWD-2026-TEST-001');
    expect(res.body[0].applicantName).toBe('Santos, Maria');
    expect(res.body[0].idRecordId).toBeTruthy();
    expect(res.body[0].lastCheckPassed).toBe(true);
  });

  test('returns empty array when nothing is anchored', async () => {
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/anchors')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/blockchain/simulate-tamper/:idNumber', () => {
  test('returns a mismatch and does NOT modify the DB', async () => {
    const { applicant } = await seedAnchoredRecord();
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/simulate-tamper/PWD-2026-TEST-001?field=birthDate')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.field).toBe('birthDate');
    expect(res.body.match).toBe(false);
    expect(res.body.tamperedHash).not.toBe(res.body.originalHash);
    expect(res.body.originalValue).toBe('1975-03-10');
    expect(res.body.tamperedValue).not.toBe('1975-03-10');

    const fresh = await Applicant.findById(applicant._id);
    expect(new Date(fresh.birthdate).toISOString().split('T')[0]).toBe('1975-03-10');
  });

  test('rejects an unknown field with 400', async () => {
    await seedAnchoredRecord();
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/simulate-tamper/PWD-2026-TEST-001?field=photo')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test('returns 404 when the record is not anchored', async () => {
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/simulate-tamper/PWD-DOES-NOT-EXIST?field=birthDate')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/blockchain/verify/:idNumber — offline fallback', () => {
  test('returns source:cached and hashMatch:true when Fabric is off and record is untampered', async () => {
    delete process.env.FABRIC_ENABLED;
    await seedAnchoredRecord();
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/verify/PWD-2026-TEST-001')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.anchored).toBe(true);
    expect(res.body.source).toBe('cached');
    expect(res.body.hashMatch).toBe(true);
  });

  test('returns source:cached and hashMatch:false when the DB record was edited after anchoring', async () => {
    delete process.env.FABRIC_ENABLED;
    const { applicant } = await seedAnchoredRecord();
    applicant.firstName = 'Mariah';
    await applicant.save();

    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/verify/PWD-2026-TEST-001')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.source).toBe('cached');
    expect(res.body.hashMatch).toBe(false);
  });
});
