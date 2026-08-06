'use strict';

const mongoose = require('mongoose');
const supertest = require('supertest');

const app = require('../../src/app');
const db = require('../dbHelpers');
const VerifyOutbox = require('../../src/models/VerifyOutbox');
const { digestVerificationPayload } = require('../../src/lib/verificationPayload');
const { createTestUser, getToken } = require('../testHelpers');

beforeAll(async () => {
  await db.connect();
  await VerifyOutbox.syncIndexes();
});
afterAll(async () => { await db.disconnect(); });
afterEach(async () => { await db.clear(); });

function payload(overrides = {}) {
  return {
    anchoredAt: null,
    anchoredHash: null,
    blockNumber: null,
    expiryDate: '2031-08-05',
    idNumber: 'PWD-OPS-0001',
    idType: 'PWD',
    issuedDate: '2026-08-05',
    maskedName: 'S****, M****',
    releasedAt: null,
    status: 'ACTIVE',
    txId: null,
    ...overrides,
  };
}

let sequence = 0;
function operation(overrides = {}) {
  sequence += 1;
  const idRecordId = overrides.idRecordId ?? new mongoose.Types.ObjectId();
  const recordPayload = overrides.payload ?? payload({ idNumber: `PWD-OPS-${sequence}` });
  return {
    operationId: overrides.operationId ?? `verify:issue:${idRecordId}`,
    idRecordId,
    tokenHash: overrides.tokenHash ?? sequence.toString(16).padStart(64, '0'),
    payload: recordPayload,
    payloadDigest: overrides.payloadDigest ?? digestVerificationPayload(recordPayload),
    epoch: overrides.epoch ?? 1,
    revision: overrides.revision ?? 1,
    nextAttempt: overrides.nextAttempt ?? new Date(),
    ...overrides,
  };
}

async function superadminToken() {
  await createTestUser({ username: 'super_verify_ops', role: 'SUPERADMIN', department: null });
  return getToken(app, 'super_verify_ops');
}

function assertPrivateFieldsAbsent(row) {
  expect(row).not.toHaveProperty('operationId');
  expect(row).not.toHaveProperty('tokenHash');
  expect(row).not.toHaveProperty('payload');
  expect(row).not.toHaveProperty('payloadDigest');
  expect(row).not.toHaveProperty('lastError');
  expect(row).not.toHaveProperty('lockOwner');
  expect(row).not.toHaveProperty('signedPayload');
  expect(row).not.toHaveProperty('signature');
}

describe('GET /api/verification-sync/status', () => {
  test('requires authentication and system-wide SuperAdmin authorization', async () => {
    const unauthenticated = await supertest(app).get('/api/verification-sync/status');
    expect(unauthenticated.status).toBe(401);

    await createTestUser({ username: 'admin_verify_ops', role: 'ADMIN', department: 'PWD' });
    const adminToken = await getToken(app, 'admin_verify_ops');
    const forbidden = await supertest(app)
      .get('/api/verification-sync/status')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });

  test('returns an exact empty read-only status shape', async () => {
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/verification-sync/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      counts: { PENDING: 0, PROCESSING: 0, FAILED: 0, SENT: 0 },
      undeliveredCount: 0,
      oldestUndelivered: null,
      staleProcessing: { count: 0, items: [] },
      recentFailures: { count: 0, items: [] },
    });
    expect(new Date(res.body.generatedAt).toString()).not.toBe('Invalid Date');
  });

  test('reports counts, oldest undelivered work, stale leases, and recent terminal failures', async () => {
    const now = Date.now();
    const oldest = await VerifyOutbox.create(operation({
      operationId: `verify:release:${new mongoose.Types.ObjectId()}`,
      state: 'PENDING',
    }));
    await VerifyOutbox.collection.updateOne(
      { _id: oldest._id },
      { $set: { createdAt: new Date(now - 60_000), updatedAt: new Date(now - 60_000) } }
    );

    const expiredLease = await VerifyOutbox.create(operation({
      operationId: `verify:revoke:${new mongoose.Types.ObjectId()}`,
      state: 'PROCESSING',
      lockOwner: 'host:pid:private-owner',
      lockedUntil: new Date(now - 5_000),
    }));
    const missingLease = await VerifyOutbox.create(operation({
      operationId: `verify:expire:${new mongoose.Types.ObjectId()}`,
      state: 'PROCESSING',
      lockOwner: 'host:pid:other-private-owner',
    }));
    const activeLease = await VerifyOutbox.create(operation({
      operationId: `verify:issue:${new mongoose.Types.ObjectId()}`,
      state: 'PROCESSING',
      lockOwner: 'active-owner',
      lockedUntil: new Date(now + 60_000),
    }));
    const failed = await VerifyOutbox.create(operation({
      operationId: `verify:anchor_receipt:${new mongoose.Types.ObjectId()}:tx-safe`,
      state: 'FAILED',
      attempts: 4,
      lastError: 'code=VERIFY_SYNC_REJECTED remoteCode=EQUAL_REVISION_DIGEST_CONFLICT status=409',
    }));
    await VerifyOutbox.create(operation({ state: 'SENT' }));

    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/verification-sync/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ PENDING: 1, PROCESSING: 3, FAILED: 1, SENT: 1 });
    expect(res.body.undeliveredCount).toBe(5);
    expect(res.body.oldestUndelivered).toMatchObject({
      operationRef: oldest._id.toString(),
      event: 'RELEASE',
      state: 'PENDING',
    });
    expect(res.body.oldestUndelivered.ageMs).toBeGreaterThanOrEqual(50_000);

    expect(res.body.staleProcessing.count).toBe(2);
    expect(res.body.staleProcessing.items).toHaveLength(2);
    expect(res.body.staleProcessing.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationRef: expiredLease._id.toString(),
        lease: expect.objectContaining({ state: 'EXPIRED' }),
      }),
      expect.objectContaining({
        operationRef: missingLease._id.toString(),
        lease: { state: 'MISSING', lockedUntil: null },
      }),
    ]));
    expect(res.body.staleProcessing.items.some((row) => row.operationRef === activeLease._id.toString())).toBe(false);

    expect(res.body.recentFailures).toMatchObject({ count: 1 });
    expect(res.body.recentFailures.items[0]).toMatchObject({
      operationRef: failed._id.toString(),
      event: 'ANCHOR_RECEIPT',
      state: 'FAILED',
      attempts: 4,
      failure: {
        code: 'VERIFY_SYNC_REJECTED',
        remoteCode: 'EQUAL_REVISION_DIGEST_CONFLICT',
        status: 409,
      },
    });

    assertPrivateFieldsAbsent(res.body.oldestUndelivered);
    for (const row of res.body.staleProcessing.items) assertPrivateFieldsAbsent(row);
    for (const row of res.body.recentFailures.items) assertPrivateFieldsAbsent(row);
    expect(JSON.stringify(res.body)).not.toContain('private-owner');
    expect(JSON.stringify(res.body)).not.toContain('S****, M****');
  });

  test('bounds detail rows while preserving total counts', async () => {
    const rows = [];
    for (let index = 0; index < 30; index += 1) {
      rows.push(operation({
        state: 'FAILED',
        attempts: index + 1,
        lastError: 'code=VERIFY_SYNC_REJECTED status=409',
      }));
    }
    await VerifyOutbox.create(rows);

    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/verification-sync/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.counts.FAILED).toBe(30);
    expect(res.body.recentFailures.count).toBe(30);
    expect(res.body.recentFailures.items).toHaveLength(25);
  });
});
