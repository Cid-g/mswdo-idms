'use strict';

const mongoose = require('mongoose');
const supertest = require('supertest');

const app = require('../../src/app');
const db = require('../dbHelpers');
const Applicant = require('../../src/models/Applicant');
const AuditLog = require('../../src/models/AuditLog');
const BlockchainAnchor = require('../../src/models/BlockchainAnchor');
const IDRecord = require('../../src/models/IDRecord');
const VerifyOutbox = require('../../src/models/VerifyOutbox');
const { digestVerificationPayload } = require('../../src/lib/verificationPayload');
const { buildVerificationPayload } = require('../../src/services/verificationProjection');
const { hashQrToken } = require('../../src/services/verifyOutbox');
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


async function createResyncSource({
  historyState = 'SENT',
  verifyRevision = 1,
  withAnchor = true,
} = {}) {
  const sourceUser = await createTestUser({
    username: `resync_source_${sequence + 1}`,
    role: 'ENCODER',
    department: 'PWD',
  });
  const applicant = await Applicant.create({
    department: 'PWD',
    encodedById: sourceUser._id,
    firstName: 'Maria',
    lastName: 'Santos',
    birthdate: new Date('1990-01-02T00:00:00.000Z'),
    status: 'COMPLETE',
  });
  const idRecord = await IDRecord.create({
    applicantId: applicant._id,
    department: 'PWD',
    idNumber: `PWD-RESYNC-${new mongoose.Types.ObjectId()}`,
    qrToken: `resync-${new mongoose.Types.ObjectId()}`,
    issuedDate: new Date('2026-08-05T00:00:00.000Z'),
    expiryDate: new Date('2031-08-05T00:00:00.000Z'),
    releasedAt: new Date('2026-08-06T01:00:00.000Z'),
    status: 'ACTIVE',
    verifyRevision,
  });
  const anchor = withAnchor
    ? await BlockchainAnchor.create({
      idRecordId: idRecord._id,
      recordRef: idRecord.idNumber,
      canonicalHash: 'a'.repeat(64),
      txId: 'b'.repeat(64),
      blockNumber: 42,
      ledgerEpoch: 'c'.repeat(64),
      receiptState: 'CURRENT',
      anchoredAt: new Date('2026-08-06T01:30:00.000Z'),
    })
    : null;
  const currentPayload = buildVerificationPayload({ applicant, idRecord, anchor });
  const history = await VerifyOutbox.create(operation({
    operationId: `verify:issue:${idRecord._id}`,
    idRecordId: idRecord._id,
    tokenHash: hashQrToken(idRecord.qrToken),
    payload: currentPayload,
    epoch: 1,
    revision: verifyRevision,
    state: historyState,
  }));
  return { applicant, anchor, currentPayload, history, idRecord };
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


describe('POST /api/verification-sync/operations/:operationRef/retry', () => {
  test('requires authentication and system-wide SuperAdmin authorization', async () => {
    const operationRow = await VerifyOutbox.create(operation({
      state: 'FAILED',
      attempts: 1,
      lastError: 'code=VERIFY_SYNC_REJECTED status=409',
    }));

    const unauthenticated = await supertest(app)
      .post(`/api/verification-sync/operations/${operationRow._id}/retry`);
    expect(unauthenticated.status).toBe(401);

    await createTestUser({ username: 'admin_verify_retry', role: 'ADMIN', department: 'PWD' });
    const adminToken = await getToken(app, 'admin_verify_retry');
    const forbidden = await supertest(app)
      .post(`/api/verification-sync/operations/${operationRow._id}/retry`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect((await VerifyOutbox.findById(operationRow._id).lean()).state).toBe('FAILED');
  });

  test('atomically requeues one FAILED immutable row and writes a privacy-safe audit entry', async () => {
    const idRecordId = new mongoose.Types.ObjectId();
    const operationRow = await VerifyOutbox.create(operation({
      operationId: `verify:revoke:${idRecordId}:manual-test`,
      idRecordId,
      state: 'FAILED',
      attempts: 4,
      lastError: 'code=VERIFY_SYNC_REJECTED remoteCode=UNKNOWN_SIGNING_KEY status=401 secret=https://private.example',
      lockOwner: 'private-host:5000:owner-token',
      lockedUntil: new Date(Date.now() - 5_000),
    }));
    const before = await VerifyOutbox.findById(operationRow._id).lean();
    const token = await superadminToken();
    const startedAt = Date.now();

    const res = await supertest(app)
      .post(`/api/verification-sync/operations/${operationRow._id}/retry`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ignored: 'request bodies do not alter immutable commands' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      retried: true,
      operation: {
        operationRef: operationRow._id.toString(),
        event: 'REVOKE',
        idRecordId: idRecordId.toString(),
        epoch: 1,
        revision: 1,
        state: 'PENDING',
        attempts: 4,
        failure: null,
        lease: null,
      },
    });
    expect(new Date(res.body.operation.nextAttempt).getTime()).toBeGreaterThanOrEqual(startedAt);
    assertPrivateFieldsAbsent(res.body.operation);
    expect(JSON.stringify(res.body)).not.toContain('private.example');
    expect(JSON.stringify(res.body)).not.toContain('private-host');

    const updated = await VerifyOutbox.findById(operationRow._id).lean();
    expect(updated).toMatchObject({
      operationId: before.operationId,
      idRecordId: before.idRecordId,
      tokenHash: before.tokenHash,
      payload: before.payload,
      payloadDigest: before.payloadDigest,
      epoch: before.epoch,
      revision: before.revision,
      state: 'PENDING',
      attempts: 4,
    });
    expect(updated).not.toHaveProperty('lastError');
    expect(updated).not.toHaveProperty('lockOwner');
    expect(updated).not.toHaveProperty('lockedUntil');

    const audits = await AuditLog.find({
      action: 'VERIFICATION_SYNC_RETRY_QUEUED',
      targetId: operationRow._id.toString(),
    }).lean();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      targetType: 'VerifyOutbox',
      description: 'Verification synchronization retry queued for REVOKE revision 1.',
      metadata: {
        operationRef: operationRow._id.toString(),
        event: 'REVOKE',
        epoch: 1,
        revision: 1,
        previousState: 'FAILED',
        previousAttempts: 4,
        failure: {
          code: 'VERIFY_SYNC_REJECTED',
          remoteCode: 'UNKNOWN_SIGNING_KEY',
          status: 401,
        },
      },
    });
    expect(JSON.stringify(audits[0])).not.toContain('private.example');
    expect(JSON.stringify(audits[0])).not.toContain('private-host');
    expect(JSON.stringify(audits[0])).not.toContain(before.tokenHash);
    expect(JSON.stringify(audits[0])).not.toContain(before.operationId);
  });

  test('rejects malformed and unknown operation references without mutation or audit', async () => {
    const token = await superadminToken();

    const malformed = await supertest(app)
      .post('/api/verification-sync/operations/not-an-object-id/retry')
      .set('Authorization', `Bearer ${token}`);
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_VERIFICATION_OPERATION_REF');

    const missingRef = new mongoose.Types.ObjectId();
    const missing = await supertest(app)
      .post(`/api/verification-sync/operations/${missingRef}/retry`)
      .set('Authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('VERIFICATION_OPERATION_NOT_FOUND');
    expect(await AuditLog.countDocuments({ action: 'VERIFICATION_SYNC_RETRY_QUEUED' })).toBe(0);
  });

  test.each(['PENDING', 'PROCESSING', 'SENT'])(
    'refuses to retry a %s row',
    async (state) => {
      const operationRow = await VerifyOutbox.create(operation({
        state,
        ...(state === 'PROCESSING' && {
          lockOwner: 'active-owner',
          lockedUntil: new Date(Date.now() + 60_000),
        }),
      }));
      const token = await superadminToken();

      const res = await supertest(app)
        .post(`/api/verification-sync/operations/${operationRow._id}/retry`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERIFICATION_OPERATION_NOT_RETRYABLE');
      expect((await VerifyOutbox.findById(operationRow._id).lean()).state).toBe(state);
      expect(await AuditLog.countDocuments({ action: 'VERIFICATION_SYNC_RETRY_QUEUED' })).toBe(0);
    }
  );

  test('allows only one concurrent retry transition and one audit record', async () => {
    const operationRow = await VerifyOutbox.create(operation({
      state: 'FAILED',
      attempts: 2,
      lastError: 'code=VERIFY_SYNC_REJECTED status=409',
    }));
    const token = await superadminToken();
    const path = `/api/verification-sync/operations/${operationRow._id}/retry`;

    const responses = await Promise.all([
      supertest(app).post(path).set('Authorization', `Bearer ${token}`),
      supertest(app).post(path).set('Authorization', `Bearer ${token}`),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const conflict = responses.find((response) => response.status === 409);
    expect([
      'VERIFICATION_OPERATION_NOT_RETRYABLE',
      'VERIFICATION_OPERATION_STATE_CHANGED',
    ]).toContain(conflict.body.error.code);
    expect((await VerifyOutbox.findById(operationRow._id).lean()).state).toBe('PENDING');
    expect(await AuditLog.countDocuments({
      action: 'VERIFICATION_SYNC_RETRY_QUEUED',
      targetId: operationRow._id.toString(),
    })).toBe(1);
  });
});


describe('POST /api/verification-sync/records/:idRecordRef/resync', () => {
  test('requires authentication and system-wide SuperAdmin authorization', async () => {
    const idRecordRef = new mongoose.Types.ObjectId();
    const unauthenticated = await supertest(app)
      .post(`/api/verification-sync/records/${idRecordRef}/resync`)
      .send({ requestId: 'recovery-request-001' });
    expect(unauthenticated.status).toBe(401);

    await createTestUser({ username: 'admin_verify_resync', role: 'ADMIN', department: 'PWD' });
    const adminToken = await getToken(app, 'admin_verify_resync');
    const forbidden = await supertest(app)
      .post(`/api/verification-sync/records/${idRecordRef}/resync`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ requestId: 'recovery-request-001' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });

  test('queues a new authoritative revision without mutating prior history or exposing private data', async () => {
    const source = await createResyncSource();
    const priorSnapshot = source.history.toObject();
    const actor = await createTestUser({
      username: 'super_verify_resync_success',
      role: 'SUPERADMIN',
      department: null,
    });
    const token = await getToken(app, 'super_verify_resync_success');

    const res = await supertest(app)
      .post(`/api/verification-sync/records/${source.idRecord._id}/resync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ requestId: 'recovery-request-002' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      queued: true,
      idempotent: false,
      operation: {
        event: 'RESYNC',
        idRecordId: source.idRecord._id.toString(),
        epoch: 1,
        revision: 2,
        state: 'PENDING',
        attempts: 0,
      },
    });
    assertPrivateFieldsAbsent(res.body.operation);

    const rows = await VerifyOutbox.find({ idRecordId: source.idRecord._id })
      .sort({ revision: 1 })
      .lean();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      _id: priorSnapshot._id,
      operationId: priorSnapshot.operationId,
      revision: 1,
      state: 'SENT',
      payloadDigest: priorSnapshot.payloadDigest,
    });
    expect(rows[1]).toMatchObject({
      operationId: `verify:resync:${source.idRecord._id}:recovery-request-002`,
      revision: 2,
      state: 'PENDING',
      tokenHash: hashQrToken(source.idRecord.qrToken),
      payload: source.currentPayload,
    });
    expect(JSON.stringify(rows[1])).not.toContain(source.idRecord.qrToken);
    expect((await IDRecord.findById(source.idRecord._id).lean()).verifyRevision).toBe(2);

    const audit = await AuditLog.findOne({ action: 'VERIFICATION_SYNC_RESYNC_QUEUED' }).lean();
    expect(audit).toMatchObject({
      userId: actor._id,
      targetType: 'IDRecord',
      targetId: source.idRecord._id.toString(),
      metadata: {
        operationRef: rows[1]._id.toString(),
        event: 'RESYNC',
        requestId: 'recovery-request-002',
        epoch: 1,
        revision: 2,
        previousRevision: 1,
        sourceStatus: 'ACTIVE',
        anchorIncluded: true,
      },
    });
    const auditJson = JSON.stringify(audit);
    expect(auditJson).not.toContain(source.idRecord.qrToken);
    expect(auditJson).not.toContain('Maria');
    expect(auditJson).not.toContain('Santos');
    expect(auditJson).not.toContain(rows[1].tokenHash);
    expect(auditJson).not.toContain(rows[1].payloadDigest);
  });

  test('treats the same requestId as an idempotent concurrent request', async () => {
    const source = await createResyncSource();
    const token = await superadminToken();
    const path = `/api/verification-sync/records/${source.idRecord._id}/resync`;

    const responses = await Promise.all([
      supertest(app).post(path).set('Authorization', `Bearer ${token}`)
        .send({ requestId: 'recovery-request-003' }),
      supertest(app).post(path).set('Authorization', `Bearer ${token}`)
        .send({ requestId: 'recovery-request-003' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const operationRefs = responses.map((response) => response.body.operation.operationRef);
    expect(new Set(operationRefs).size).toBe(1);
    expect(responses.map((response) => response.body.queued).sort()).toEqual([false, true]);
    expect(await VerifyOutbox.countDocuments({ idRecordId: source.idRecord._id })).toBe(2);
    expect((await IDRecord.findById(source.idRecord._id).lean()).verifyRevision).toBe(2);
    expect(await AuditLog.countDocuments({
      action: 'VERIFICATION_SYNC_RESYNC_QUEUED',
      targetId: source.idRecord._id.toString(),
    })).toBe(1);
  });

  test('rejects malformed record references and non-exact request bodies', async () => {
    const token = await superadminToken();
    const malformedRef = await supertest(app)
      .post('/api/verification-sync/records/not-an-object-id/resync')
      .set('Authorization', `Bearer ${token}`)
      .send({ requestId: 'recovery-request-004' });
    expect(malformedRef.status).toBe(400);
    expect(malformedRef.body.error.code).toBe('INVALID_ID_RECORD_REF');

    const extraField = await supertest(app)
      .post(`/api/verification-sync/records/${new mongoose.Types.ObjectId()}/resync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ requestId: 'recovery-request-004', reason: 'do not accept free text' });
    expect(extraField.status).toBe(400);
    expect(extraField.body.error.code).toBe('INVALID_VERIFICATION_RESYNC_REQUEST');

    const invalidRequestId = await supertest(app)
      .post(`/api/verification-sync/records/${new mongoose.Types.ObjectId()}/resync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ requestId: 'UPPER CASE PRIVATE DATA' });
    expect(invalidRequestId.status).toBe(400);
    expect(invalidRequestId.body.error.code).toBe('INVALID_VERIFICATION_RESYNC_REQUEST_ID');
    expect(await AuditLog.countDocuments({ action: 'VERIFICATION_SYNC_RESYNC_QUEUED' })).toBe(0);
  });

  test('requires an existing record and prior verification history', async () => {
    const token = await superadminToken();
    const missing = await supertest(app)
      .post(`/api/verification-sync/records/${new mongoose.Types.ObjectId()}/resync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ requestId: 'recovery-request-005' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ID_RECORD_NOT_FOUND');

    const sourceUser = await createTestUser({
      username: 'resync_no_history_source',
      role: 'ENCODER',
      department: 'PWD',
    });
    const applicant = await Applicant.create({
      department: 'PWD',
      encodedById: sourceUser._id,
      firstName: 'No',
      lastName: 'History',
      birthdate: new Date('1990-01-02T00:00:00.000Z'),
      status: 'COMPLETE',
    });
    const idRecord = await IDRecord.create({
      applicantId: applicant._id,
      department: 'PWD',
      idNumber: `PWD-NO-HISTORY-${new mongoose.Types.ObjectId()}`,
      qrToken: `no-history-${new mongoose.Types.ObjectId()}`,
      issuedDate: new Date('2026-08-05T00:00:00.000Z'),
      expiryDate: new Date('2031-08-05T00:00:00.000Z'),
      status: 'ACTIVE',
      verifyRevision: 0,
    });
    const noHistory = await supertest(app)
      .post(`/api/verification-sync/records/${idRecord._id}/resync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ requestId: 'recovery-request-006' });
    expect(noHistory.status).toBe(409);
    expect(noHistory.body.error.code).toBe('VERIFICATION_RESYNC_HISTORY_REQUIRED');
    expect((await IDRecord.findById(idRecord._id).lean()).verifyRevision).toBe(0);
  });

  test.each(['PENDING', 'PROCESSING', 'FAILED'])(
    'does not bypass existing %s delivery work',
    async (state) => {
      const source = await createResyncSource({ historyState: state });
      const token = await superadminToken();

      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      let res;
      try {
        res = await supertest(app)
          .post(`/api/verification-sync/records/${source.idRecord._id}/resync`)
          .set('Authorization', `Bearer ${token}`)
          .send({ requestId: `blocked-${state.toLowerCase()}-request` });
      } finally {
        process.env.NODE_ENV = previousNodeEnv;
      }

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERIFICATION_RESYNC_BLOCKED_BY_UNDELIVERED');
      expect(res.body.error).not.toHaveProperty('stack');
      expect((await IDRecord.findById(source.idRecord._id).lean()).verifyRevision).toBe(1);
      expect(await VerifyOutbox.countDocuments({ idRecordId: source.idRecord._id })).toBe(1);
      expect(await AuditLog.countDocuments({ action: 'VERIFICATION_SYNC_RESYNC_QUEUED' })).toBe(0);
    }
  );

  test('fails closed when local revision and durable history disagree', async () => {
    const source = await createResyncSource();
    await IDRecord.updateOne({ _id: source.idRecord._id }, { $set: { verifyRevision: 2 } });
    const token = await superadminToken();

    const res = await supertest(app)
      .post(`/api/verification-sync/records/${source.idRecord._id}/resync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ requestId: 'recovery-request-007' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERIFICATION_RESYNC_HISTORY_INCONSISTENT');
    expect(await VerifyOutbox.countDocuments({ idRecordId: source.idRecord._id })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'VERIFICATION_SYNC_RESYNC_QUEUED' })).toBe(0);
  });

  test('rejects reuse of requestId when current local projection has changed', async () => {
    const source = await createResyncSource();
    const token = await superadminToken();
    const path = `/api/verification-sync/records/${source.idRecord._id}/resync`;

    const first = await supertest(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ requestId: 'recovery-request-008' });
    expect(first.status).toBe(201);
    await VerifyOutbox.updateOne(
      { _id: first.body.operation.operationRef },
      { $set: { state: 'SENT' } }
    );
    await IDRecord.updateOne(
      { _id: source.idRecord._id },
      { $set: { releasedAt: new Date('2026-08-06T02:00:00.000Z') } }
    );

    const conflict = await supertest(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ requestId: 'recovery-request-008' });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('VERIFICATION_RESYNC_REQUEST_CONFLICT');
    expect((await IDRecord.findById(source.idRecord._id).lean()).verifyRevision).toBe(2);
    expect(await VerifyOutbox.countDocuments({ idRecordId: source.idRecord._id })).toBe(2);
    expect(await AuditLog.countDocuments({
      action: 'VERIFICATION_SYNC_RESYNC_QUEUED',
      targetId: source.idRecord._id.toString(),
    })).toBe(1);
  });
});
