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
const ChainOutbox       = require('../../src/models/ChainOutbox');
const FabricLedgerState = require('../../src/models/FabricLedgerState');
const AuditLog          = require('../../src/models/AuditLog');
const User              = require('../../src/models/User');
const fabricConnection  = require('../../src/fabric/connect');
const chainWorker       = require('../../src/workers/chainOutboxWorker');
const ledgerReconciliation = require('../../src/services/ledgerReconciliation');
const blockchainService = require('../../src/services/blockchain');
const { computeHash } = blockchainService;

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.disconnect(); });
afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of ['applicants', 'idrecords', 'users', 'blockchainanchors', 'chainoutboxes', 'fabricledgerstates', 'auditlogs']) {
    if (collections[key]) await collections[key].deleteMany({});
  }
  delete process.env.FABRIC_ENABLED;
  jest.restoreAllMocks();
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
  test('reports disabled and disconnected separately', async () => {
    delete process.env.FABRIC_ENABLED;
    jest.spyOn(fabricConnection, 'isFabricConnected').mockReturnValue(false);
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fabricEnabled: false,
      connected: false,
      ready: false,
      ledger: { status: 'UNOBSERVED', paused: false },
    });
  });

  test('does not claim connectivity from FABRIC_ENABLED alone', async () => {
    process.env.FABRIC_ENABLED = 'true';
    jest.spyOn(fabricConnection, 'isFabricConnected').mockReturnValue(false);
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.fabricEnabled).toBe(true);
    expect(res.body.connected).toBe(false);
    expect(res.body.ready).toBe(false);
  });

  test('reports a live gateway and accepted epoch as ready', async () => {
    process.env.FABRIC_ENABLED = 'true';
    jest.spyOn(fabricConnection, 'isFabricConnected').mockReturnValue(true);
    await FabricLedgerState.create({
      key: 'primary',
      acceptedEpoch: 'epoch-a',
      observedEpoch: 'epoch-a',
      status: 'ACTIVE',
      acceptedAt: new Date('2026-08-05T00:00:00Z'),
    });
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fabricEnabled: true,
      connected: true,
      ready: true,
      ledger: {
        status: 'ACTIVE',
        paused: false,
        acceptedEpoch: 'epoch-a',
        observedEpoch: 'epoch-a',
      },
    });
  });

  test('surfaces ledger mismatch as an execution pause even with a live gateway', async () => {
    process.env.FABRIC_ENABLED = 'true';
    jest.spyOn(fabricConnection, 'isFabricConnected').mockReturnValue(true);
    await FabricLedgerState.create({
      key: 'primary',
      acceptedEpoch: 'epoch-old',
      observedEpoch: 'epoch-new',
      status: 'MISMATCH',
      detectedAt: new Date('2026-08-05T01:00:00Z'),
    });
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.ready).toBe(false);
    expect(res.body.ledger).toMatchObject({
      status: 'MISMATCH',
      paused: true,
      acceptedEpoch: 'epoch-old',
      observedEpoch: 'epoch-new',
    });
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


async function seedCompleteUnanchoredRecord({ idNumber = 'PWD-2026-MANUAL-001', status = 'ACTIVE' } = {}) {
  const encoder = await createTestUser({ username: `enc_${idNumber.slice(-6)}`, role: 'ENCODER' });
  const applicant = await Applicant.create({
    firstName: 'Manual', lastName: 'Anchor', middleName: '',
    birthdate: new Date('1980-01-02'), sex: 'Female',
    barangay: 'Poblacion 2', department: 'PWD',
    encodedById: encoder._id, status: 'COMPLETE',
  });
  const idRecord = await IDRecord.create({
    applicantId: applicant._id,
    department: 'PWD',
    idNumber,
    qrToken: uuidv4(),
    status,
    issuedDate: new Date('2026-08-01'),
    expiryDate: new Date('2031-08-01'),
    idImagePath: 'uploads/ids/manual.png',
  });
  return { applicant, idRecord };
}

function outboxInput({ idRecord, operationId, operation, sequence, state, attempts = 0, alertedAt, nextAttempt, lastError }) {
  return {
    operationId,
    operation,
    idRecordId: idRecord._id,
    recordRef: idRecord.idNumber,
    sequence,
    payload: operation === 'ANCHOR'
      ? { canonicalHash: `hash-${sequence}`, idType: idRecord.department, soloParentIdType: '', issuingOffice: 'MSWDO-GERONA-TARLAC' }
      : operation === 'REVOKE' ? { reason: 'fraud' } : {},
    state,
    attempts,
    alertedAt,
    nextAttempt: nextAttempt || new Date('2026-08-05T00:00:00Z'),
    lastError,
  };
}

describe('POST /api/blockchain/anchor/:idRecordId', () => {
  test('creates or reuses one deterministic ANCHOR and returns its actual queued state', async () => {
    process.env.FABRIC_ENABLED = 'false';
    const { idRecord } = await seedCompleteUnanchoredRecord();
    const token = await superadminToken();
    const processSpy = jest.spyOn(chainWorker, 'processOperationById')
      .mockResolvedValue({ processed: false, state: 'FABRIC_UNAVAILABLE' });

    const first = await supertest(app)
      .post(`/api/blockchain/anchor/${idRecord._id}`)
      .set('Authorization', `Bearer ${token}`);
    const second = await supertest(app)
      .post(`/api/blockchain/anchor/${idRecord._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({
      operationId: `anchor:${idRecord._id}`,
      operation: 'ANCHOR',
      state: 'PENDING',
      queued: true,
      processingState: 'FABRIC_UNAVAILABLE',
    });
    expect(second.status).toBe(202);
    expect(await ChainOutbox.countDocuments({ idRecordId: idRecord._id, operation: 'ANCHOR' })).toBe(1);
    expect((await IDRecord.findById(idRecord._id)).chainSequence).toBe(1);
    expect(processSpy).toHaveBeenCalledWith(
      `anchor:${idRecord._id}`,
      expect.objectContaining({ owner: expect.stringContaining(`manual-anchor:${idRecord._id}:`) })
    );
  });

  test('returns 200 with a verified receipt when the queued operation reaches SENT', async () => {
    const { idRecord } = await seedCompleteUnanchoredRecord({ idNumber: 'PWD-2026-MANUAL-002' });
    await FabricLedgerState.create({
      key: 'primary',
      acceptedEpoch: 'epoch-manual',
      observedEpoch: 'epoch-manual',
      status: 'ACTIVE',
      acceptedAt: new Date('2026-08-05T01:00:00Z'),
    });
    const token = await superadminToken();
    jest.spyOn(chainWorker, 'processOperationById').mockImplementation(async (operationId) => {
      const operation = await ChainOutbox.findOneAndUpdate(
        { operationId },
        { $set: {
          state: 'SENT',
          txId: 'tx-manual',
          blockNumber: 81,
          ledgerEpoch: 'epoch-manual',
          completedAt: new Date('2026-08-05T02:00:00Z'),
        } },
        { new: true }
      );
      await BlockchainAnchor.create({
        idRecordId: operation.idRecordId,
        recordRef: operation.recordRef,
        canonicalHash: operation.payload.canonicalHash,
        txId: 'tx-manual',
        blockNumber: 81,
        ledgerEpoch: 'epoch-manual',
        receiptState: 'CURRENT',
        anchoredAt: new Date('2026-08-05T02:00:00Z'),
      });
      return { processed: true, state: 'SENT' };
    });

    const res = await supertest(app)
      .post(`/api/blockchain/anchor/${idRecord._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      operationId: `anchor:${idRecord._id}`,
      state: 'SENT',
      queued: false,
      receiptVerified: true,
      receipt: {
        txId: 'tx-manual',
        blockNumber: 81,
        ledgerEpoch: 'epoch-manual',
      },
    });
  });

  test('routes a legacy anchor receipt through the deterministic queue instead of trusting MongoDB alone', async () => {
    const { idRecord } = await seedCompleteUnanchoredRecord({ idNumber: 'PWD-2026-MANUAL-003' });
    await BlockchainAnchor.create({
      idRecordId: idRecord._id,
      recordRef: idRecord.idNumber,
      canonicalHash: 'existing-hash',
      txId: 'tx-existing',
      blockNumber: 12,
      ledgerEpoch: 'epoch-existing',
      receiptState: 'CURRENT',
      anchoredAt: new Date('2026-08-04T00:00:00Z'),
    });
    const processSpy = jest.spyOn(chainWorker, 'processOperationById')
      .mockResolvedValue({ processed: false, state: 'FABRIC_UNAVAILABLE' });
    const token = await superadminToken();

    const res = await supertest(app)
      .post(`/api/blockchain/anchor/${idRecord._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      operationId: `anchor:${idRecord._id}`,
      operation: 'ANCHOR',
      state: 'PENDING',
      queued: true,
      receiptVerified: false,
    });
    expect(await ChainOutbox.countDocuments({ idRecordId: idRecord._id, operation: 'ANCHOR' })).toBe(1);
    expect(processSpy).toHaveBeenCalledTimes(1);
  });

  test('rejects manual anchoring while the applicant is still PARTIAL', async () => {
    const { applicant, idRecord } = await seedCompleteUnanchoredRecord({ idNumber: 'PWD-2026-MANUAL-004' });
    applicant.status = 'PARTIAL';
    await applicant.save();
    const processSpy = jest.spyOn(chainWorker, 'processOperationById');
    const token = await superadminToken();

    const res = await supertest(app)
      .post(`/api/blockchain/anchor/${idRecord._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('APPLICANT_NOT_COMPLETE');
    expect(await ChainOutbox.countDocuments({ idRecordId: idRecord._id })).toBe(0);
    expect((await IDRecord.findById(idRecord._id)).chainSequence).toBe(0);
    expect(processSpy).not.toHaveBeenCalled();
  });

});

describe('GET /api/blockchain/sync-status', () => {
  test('returns queue counts, oldest age, problem rows, blocked predecessor, alerts, and never-anchored terminal IDs', async () => {
    const { idRecord: blockedRecord } = await seedCompleteUnanchoredRecord({ idNumber: 'PWD-2026-BLOCKED' });
    const [failedAnchor] = await ChainOutbox.create([
      outboxInput({
        idRecord: blockedRecord,
        operationId: `anchor:${blockedRecord._id}`,
        operation: 'ANCHOR',
        sequence: 1,
        state: 'FAILED',
        attempts: 20,
        lastError: 'wrong hash',
      }),
      outboxInput({
        idRecord: blockedRecord,
        operationId: `revoke:${blockedRecord._id}`,
        operation: 'REVOKE',
        sequence: 2,
        state: 'BLOCKED',
      }),
    ]);

    const { idRecord: alertRecord } = await seedCompleteUnanchoredRecord({ idNumber: 'PWD-2026-ALERT' });
    await ChainOutbox.create(outboxInput({
      idRecord: alertRecord,
      operationId: `revoke:${alertRecord._id}`,
      operation: 'REVOKE',
      sequence: 1,
      state: 'PENDING',
      attempts: 20,
      alertedAt: new Date('2026-08-05T01:00:00Z'),
      nextAttempt: new Date('2026-08-05T01:30:00Z'),
      lastError: 'gateway unavailable',
    }));

    const { idRecord: terminal } = await seedCompleteUnanchoredRecord({
      idNumber: 'PWD-2026-NEVER-CHAIN',
      status: 'REVOKED',
    });
    terminal.revokedReason = 'local-only';
    terminal.revokedAt = new Date('2026-08-05T01:00:00Z');
    await terminal.save();

    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/sync-status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ PENDING: 1, PROCESSING: 0, BLOCKED: 1, FAILED: 1 });
    expect(res.body.oldest).toEqual(expect.objectContaining({ operationId: failedAnchor.operationId }));
    expect(res.body.oldest.ageMs).toBeGreaterThanOrEqual(0);
    expect(res.body.failed[0]).toMatchObject({ operationId: failedAnchor.operationId, lastError: 'wrong hash' });
    expect(res.body.blocked[0]).toMatchObject({
      operation: 'REVOKE',
      predecessor: { operation: 'ANCHOR', state: 'FAILED', sequence: 1 },
    });
    expect(res.body.alertedRevokes[0]).toMatchObject({ recordRef: alertRecord.idNumber, attempts: 20 });
    expect(res.body.unanchoredTerminalIds).toContainEqual(expect.objectContaining({
      idRecordId: terminal._id.toString(),
      recordRef: terminal.idNumber,
      status: 'REVOKED',
      reason: 'NEVER_ANCHORED',
    }));
  });
});

describe('POST /api/blockchain/sync/:operationId/retry', () => {
  test('resets only the selected operation and cannot skip a failed predecessor', async () => {
    const { idRecord } = await seedCompleteUnanchoredRecord({ idNumber: 'PWD-2026-RETRY' });
    const anchor = await ChainOutbox.create(outboxInput({
      idRecord,
      operationId: `anchor:${idRecord._id}`,
      operation: 'ANCHOR',
      sequence: 1,
      state: 'FAILED',
      attempts: 20,
      lastError: 'anchor failed',
    }));
    const revoke = await ChainOutbox.create(outboxInput({
      idRecord,
      operationId: `revoke:${idRecord._id}`,
      operation: 'REVOKE',
      sequence: 2,
      state: 'BLOCKED',
      attempts: 7,
      alertedAt: new Date('2026-08-05T01:00:00Z'),
      lastError: 'blocked',
    }));
    const immutableBefore = {
      operationId: revoke.operationId,
      recordRef: revoke.recordRef,
      sequence: revoke.sequence,
      payload: revoke.payload,
    };
    const token = await superadminToken();

    const blockedRes = await supertest(app)
      .post(`/api/blockchain/sync/${encodeURIComponent(revoke.operationId)}/retry`)
      .set('Authorization', `Bearer ${token}`);

    expect(blockedRes.status).toBe(200);
    expect(blockedRes.body).toMatchObject({
      operationId: revoke.operationId,
      state: 'BLOCKED',
      attempts: 0,
      predecessor: { operationId: anchor.operationId, state: 'FAILED' },
    });
    const revokeAfter = await ChainOutbox.findById(revoke._id).lean();
    expect(revokeAfter).toMatchObject({ ...immutableBefore, state: 'BLOCKED', attempts: 0 });
    expect(revokeAfter.lastError).toBeUndefined();
    expect(revokeAfter.alertedAt).toBeUndefined();

    const anchorRes = await supertest(app)
      .post(`/api/blockchain/sync/${encodeURIComponent(anchor.operationId)}/retry`)
      .set('Authorization', `Bearer ${token}`);
    expect(anchorRes.status).toBe(200);
    expect(anchorRes.body).toMatchObject({ operationId: anchor.operationId, state: 'PENDING', attempts: 0 });
    expect((await ChainOutbox.findById(revoke._id)).state).toBe('BLOCKED');
  });

  test('rejects retry of an operation that is not FAILED or BLOCKED', async () => {
    const { idRecord } = await seedCompleteUnanchoredRecord({ idNumber: 'PWD-2026-RETRY-2' });
    const pending = await ChainOutbox.create(outboxInput({
      idRecord,
      operationId: `anchor:${idRecord._id}`,
      operation: 'ANCHOR',
      sequence: 1,
      state: 'PENDING',
    }));
    const token = await superadminToken();

    const res = await supertest(app)
      .post(`/api/blockchain/sync/${encodeURIComponent(pending.operationId)}/retry`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHAIN_OPERATION_NOT_RETRYABLE');
  });
});

describe('POST /api/blockchain/reconcile', () => {
  async function seedMismatch() {
    process.env.FABRIC_ENABLED = 'true';
    jest.spyOn(fabricConnection, 'isFabricConnected').mockReturnValue(true);
    return FabricLedgerState.create({
      key: 'primary',
      acceptedEpoch: 'epoch-old',
      observedEpoch: 'epoch-new',
      status: 'MISMATCH',
      detectedAt: new Date('2026-08-05T01:00:00Z'),
    });
  }

  test('SCAN is read-only', async () => {
    await seedMismatch();
    jest.spyOn(ledgerReconciliation, 'getLedgerEpoch').mockResolvedValue('epoch-new');
    jest.spyOn(blockchainService, 'verifyIDOnChain').mockResolvedValue({ found: false });
    const token = await superadminToken();

    const res = await supertest(app)
      .post('/api/blockchain/reconcile')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'SCAN' });

    expect(res.status).toBe(200);
    expect(res.body.ledger).toMatchObject({
      acceptedEpoch: 'epoch-old',
      observedEpoch: 'epoch-new',
      status: 'MISMATCH',
    });
    expect((await FabricLedgerState.findOne({ key: 'primary' })).status).toBe('MISMATCH');
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  test('APPLY rejects stale confirmation and exact confirmation activates the epoch with an audit event', async () => {
    await seedMismatch();
    jest.spyOn(ledgerReconciliation, 'getLedgerEpoch').mockResolvedValue('epoch-new');
    jest.spyOn(blockchainService, 'verifyIDOnChain').mockResolvedValue({ found: false });
    const token = await superadminToken();

    const stale = await supertest(app)
      .post('/api/blockchain/reconcile')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'APPLY', expectedObservedEpoch: 'epoch-stale' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('BLOCKCHAIN_RECONCILIATION_STALE_CONFIRMATION');
    expect(await AuditLog.countDocuments()).toBe(0);

    const applied = await supertest(app)
      .post('/api/blockchain/reconcile')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'APPLY', expectedObservedEpoch: 'epoch-new' });
    expect(applied.status).toBe(200);
    expect(applied.body.ledger).toMatchObject({ status: 'ACTIVE', acceptedEpoch: 'epoch-new' });
    const state = await FabricLedgerState.findOne({ key: 'primary' }).lean();
    expect(state).toMatchObject({ status: 'ACTIVE', acceptedEpoch: 'epoch-new', observedEpoch: 'epoch-new' });
    const audit = await AuditLog.findOne({ action: 'BLOCKCHAIN_RECONCILIATION_APPLIED' }).lean();
    const actor = await User.findOne({ username: 'super_bc' }).lean();
    expect(audit).toBeTruthy();
    expect(audit.userId.toString()).toBe(actor._id.toString());
  });
});

describe('blockchain management RBAC', () => {
  test('rejects a non-SuperAdmin from every management action', async () => {
    const { idRecord } = await seedCompleteUnanchoredRecord({ idNumber: 'PWD-2026-RBAC' });
    const operation = await ChainOutbox.create(outboxInput({
      idRecord,
      operationId: `anchor:${idRecord._id}`,
      operation: 'ANCHOR',
      sequence: 1,
      state: 'FAILED',
    }));
    await createTestUser({ username: 'admin_bc_ops', role: 'ADMIN', department: 'PWD' });
    const token = await getToken(app, 'admin_bc_ops');

    const requests = [
      supertest(app).get('/api/blockchain/health'),
      supertest(app).get('/api/blockchain/sync-status'),
      supertest(app).post(`/api/blockchain/sync/${encodeURIComponent(operation.operationId)}/retry`),
      supertest(app).post('/api/blockchain/reconcile').send({ mode: 'SCAN' }),
      supertest(app).post(`/api/blockchain/anchor/${idRecord._id}`),
    ];

    const responses = await Promise.all(requests.map((request) => request.set('Authorization', `Bearer ${token}`)));
    for (const response of responses) expect(response.status).toBe(403);
  });
});
