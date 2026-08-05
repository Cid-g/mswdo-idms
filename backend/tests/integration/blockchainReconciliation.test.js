'use strict';

const mongoose = require('mongoose');

const db = require('../dbHelpers');
const Applicant = require('../../src/models/Applicant');
const AuditLog = require('../../src/models/AuditLog');
const BlockchainAnchor = require('../../src/models/BlockchainAnchor');
const ChainOutbox = require('../../src/models/ChainOutbox');
const FabricLedgerState = require('../../src/models/FabricLedgerState');
const IDRecord = require('../../src/models/IDRecord');
const {
  applyBlockchainReconciliation,
  assertLedgerEpochActive,
  observeLedgerEpoch,
  scanBlockchainConsistency,
} = require('../../src/services/ledgerReconciliation');
const { runChainOutboxOnce } = require('../../src/workers/chainOutboxWorker');

function fabricClient({ epoch = 'epoch-a', ledger = {} } = {}) {
  let currentEpoch = epoch;
  const records = new Map(Object.entries(ledger));
  return {
    ensureFabricConnected: jest.fn().mockResolvedValue({ available: true }),
    executeChainCommand: jest.fn().mockResolvedValue({
      txId: 'tx-unused',
      blockNumber: 1,
      ledgerEpoch: currentEpoch,
      reconciled: false,
    }),
    getLedgerEpoch: jest.fn(async () => currentEpoch),
    verifyIDOnChain: jest.fn(async (recordRef) => records.get(recordRef) || {
      found: false,
      recordRef,
    }),
    setEpoch(value) { currentEpoch = value; },
    setLedger(recordRef, value) { records.set(recordRef, value); },
  };
}

async function createApplicant({ status = 'COMPLETE', suffix = '1' } = {}) {
  return Applicant.create({
    department: 'PWD',
    status,
    encodedById: new mongoose.Types.ObjectId(),
    firstName: `Citizen${suffix}`,
    lastName: 'Restore',
    birthdate: new Date('1980-01-02T00:00:00.000Z'),
    sex: 'Male',
  });
}

async function createRecord(applicant, {
  suffix = '1',
  status = 'ACTIVE',
  chainSequence = 0,
  revokedReason,
} = {}) {
  return IDRecord.create({
    applicantId: applicant._id,
    department: applicant.department,
    idNumber: `PWD-RESTORE-${suffix}`,
    qrToken: `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
    issuedDate: new Date('2026-01-01T00:00:00.000Z'),
    expiryDate: new Date('2031-01-01T00:00:00.000Z'),
    status,
    chainSequence,
    revokedReason,
  });
}

function anchorPayload(hash = 'a'.repeat(64)) {
  return {
    canonicalHash: hash,
    idType: 'PWD',
    soloParentIdType: '',
    issuingOffice: 'MSWDO-GERONA-TARLAC',
  };
}

async function createOperation(record, {
  operation = 'ANCHOR',
  sequence = 1,
  state = 'SENT',
  payload = operation === 'REVOKE' ? { reason: 'fraud' } : {},
  ledgerEpoch = state === 'SENT' ? 'epoch-a' : undefined,
} = {}) {
  return ChainOutbox.create({
    operationId: `${operation.toLowerCase()}:${record._id}`,
    operation,
    idRecordId: record._id,
    recordRef: record.idNumber,
    sequence,
    payload: operation === 'ANCHOR' ? anchorPayload() : payload,
    state,
    attempts: 0,
    nextAttempt: new Date('2026-08-05T00:00:00.000Z'),
    txId: state === 'SENT' ? `tx-${operation.toLowerCase()}-${sequence}` : undefined,
    blockNumber: state === 'SENT' ? sequence : undefined,
    ledgerEpoch,
    completedAt: state === 'SENT' ? new Date('2026-08-05T00:00:00.000Z') : undefined,
  });
}

beforeAll(async () => {
  await db.connect();
  await Promise.all([
    ChainOutbox.syncIndexes(),
    FabricLedgerState.syncIndexes(),
  ]);
});

afterEach(async () => {
  await db.clear();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await db.disconnect();
});

describe('Fabric ledger epoch guard', () => {
  test('accepts the first epoch, keeps the same epoch active, and records a mismatch', async () => {
    const client = fabricClient({ epoch: 'epoch-a' });
    const firstAt = new Date('2026-08-05T01:00:00.000Z');

    const first = await observeLedgerEpoch({ fabricClient: client, now: firstAt });
    expect(first.toObject()).toMatchObject({
      key: 'primary',
      acceptedEpoch: 'epoch-a',
      observedEpoch: 'epoch-a',
      status: 'ACTIVE',
      acceptedAt: firstAt,
    });

    await expect(assertLedgerEpochActive({ fabricClient: client }))
      .resolves.toMatchObject({ status: 'ACTIVE', observedEpoch: 'epoch-a' });

    client.setEpoch('epoch-b');
    await expect(assertLedgerEpochActive({
      fabricClient: client,
      now: new Date('2026-08-05T02:00:00.000Z'),
    })).rejects.toMatchObject({
      code: 'FABRIC_LEDGER_EPOCH_MISMATCH',
      acceptedEpoch: 'epoch-a',
      observedEpoch: 'epoch-b',
    });

    expect(await FabricLedgerState.findOne({ key: 'primary' }).lean()).toMatchObject({
      acceptedEpoch: 'epoch-a',
      observedEpoch: 'epoch-b',
      status: 'MISMATCH',
      detectedAt: new Date('2026-08-05T02:00:00.000Z'),
    });
  });

  test('pauses the worker before claim without consuming an outbox attempt', async () => {
    const applicant = await createApplicant({ suffix: '2' });
    const record = await createRecord(applicant, { suffix: '2', chainSequence: 1 });
    await createOperation(record, { state: 'PENDING', ledgerEpoch: undefined });
    await FabricLedgerState.create({
      key: 'primary',
      acceptedEpoch: 'epoch-a',
      observedEpoch: 'epoch-a',
      status: 'ACTIVE',
    });
    const client = fabricClient({ epoch: 'epoch-b' });

    await expect(runChainOutboxOnce({
      owner: 'epoch-worker',
      now: new Date('2026-08-05T03:00:00.000Z'),
      fabricClient: client,
    })).resolves.toEqual({ processed: false, state: 'LEDGER_EPOCH_MISMATCH' });

    const operation = await ChainOutbox.findOne({ idRecordId: record._id }).lean();
    expect(operation).toMatchObject({ state: 'PENDING', attempts: 0 });
    expect(operation.lockOwner).toBeUndefined();
    expect(client.executeChainCommand).not.toHaveBeenCalled();
  });

  test('rejects a stale recovery confirmation when the live epoch changed again', async () => {
    await FabricLedgerState.create({
      key: 'primary',
      acceptedEpoch: 'epoch-a',
      observedEpoch: 'epoch-b',
      status: 'MISMATCH',
    });
    const client = fabricClient({ epoch: 'epoch-c' });

    await expect(applyBlockchainReconciliation({
      actorId: new mongoose.Types.ObjectId(),
      expectedObservedEpoch: 'epoch-b',
      fabricClient: client,
    })).rejects.toMatchObject({
      code: 'BLOCKCHAIN_RECONCILIATION_STALE_CONFIRMATION',
    });

    expect(await AuditLog.countDocuments()).toBe(0);
    expect(await FabricLedgerState.findOne({ key: 'primary' }).lean()).toMatchObject({
      acceptedEpoch: 'epoch-a',
      observedEpoch: 'epoch-b',
      status: 'MISMATCH',
    });
  });
});

describe('explicit restore reconciliation', () => {
  test('accepts a Fabric reset by replaying immutable operations in order and staling old receipts', async () => {
    const applicant = await createApplicant({ suffix: '3' });
    const record = await createRecord(applicant, {
      suffix: '3',
      status: 'REVOKED',
      chainSequence: 2,
      revokedReason: 'Duplicate registration',
    });
    await createOperation(record, { operation: 'ANCHOR', sequence: 1, state: 'SENT' });
    await createOperation(record, {
      operation: 'REVOKE',
      sequence: 2,
      state: 'SENT',
      payload: { reason: 'Duplicate registration' },
    });
    await BlockchainAnchor.create({
      idRecordId: record._id,
      recordRef: record.idNumber,
      canonicalHash: 'a'.repeat(64),
      txId: 'tx-old-anchor',
      blockNumber: 4,
      ledgerEpoch: 'epoch-a',
      receiptState: 'CURRENT',
    });
    await FabricLedgerState.create({
      key: 'primary',
      acceptedEpoch: 'epoch-a',
      observedEpoch: 'epoch-b',
      status: 'MISMATCH',
    });
    const actorId = new mongoose.Types.ObjectId();
    const client = fabricClient({ epoch: 'epoch-b' });

    const result = await applyBlockchainReconciliation({
      actorId,
      expectedObservedEpoch: 'epoch-b',
      fabricClient: client,
      now: new Date('2026-08-05T04:00:00.000Z'),
    });

    expect(result.counts.replayedOperations).toBe(2);
    expect(await FabricLedgerState.findOne({ key: 'primary' }).lean()).toMatchObject({
      acceptedEpoch: 'epoch-b',
      observedEpoch: 'epoch-b',
      status: 'ACTIVE',
      acceptedById: actorId,
    });

    const operations = await ChainOutbox.find({ idRecordId: record._id })
      .sort({ sequence: 1 })
      .lean();
    expect(operations.map((item) => ({
      operation: item.operation,
      state: item.state,
      attempts: item.attempts,
      txId: item.txId,
      ledgerEpoch: item.ledgerEpoch,
    }))).toEqual([
      { operation: 'ANCHOR', state: 'PENDING', attempts: 0, txId: undefined, ledgerEpoch: undefined },
      { operation: 'REVOKE', state: 'BLOCKED', attempts: 0, txId: undefined, ledgerEpoch: undefined },
    ]);

    expect(await BlockchainAnchor.findOne({ idRecordId: record._id }).lean()).toMatchObject({
      txId: 'tx-old-anchor',
      ledgerEpoch: 'epoch-a',
      receiptState: 'STALE',
      reconciledAt: new Date('2026-08-05T04:00:00.000Z'),
    });
    expect(await AuditLog.findOne({ action: 'BLOCKCHAIN_RECONCILIATION_APPLIED' }).lean())
      .toMatchObject({ userId: actorId });
  });

  test('keeps scan read-only, then adopts a ledger revocation without inventing a local actor', async () => {
    const applicant = await createApplicant({ suffix: '4' });
    const record = await createRecord(applicant, { suffix: '4', status: 'ACTIVE', chainSequence: 1 });
    await createOperation(record, { operation: 'ANCHOR', sequence: 1, state: 'SENT' });
    await BlockchainAnchor.create({
      idRecordId: record._id,
      recordRef: record.idNumber,
      canonicalHash: 'a'.repeat(64),
      txId: 'tx-anchor',
      blockNumber: 1,
      ledgerEpoch: 'epoch-a',
      receiptState: 'CURRENT',
    });
    await FabricLedgerState.create({
      key: 'primary',
      acceptedEpoch: 'epoch-a',
      observedEpoch: 'epoch-a',
      status: 'ACTIVE',
    });
    const client = fabricClient({
      epoch: 'epoch-a',
      ledger: {
        [record.idNumber]: {
          found: true,
          recordRef: record.idNumber,
          status: 'REVOKED',
          revokedReason: 'Revoked before Mongo restore',
          revokedAt: '2026-07-30T10:11:12.000Z',
        },
      },
    });

    const before = await IDRecord.findById(record._id).lean();
    const report = await scanBlockchainConsistency({ fabricClient: client });
    expect(report.counts.ledgerTerminalAhead).toBe(1);
    expect(await IDRecord.findById(record._id).lean()).toMatchObject({
      status: before.status,
      chainSequence: before.chainSequence,
    });
    expect(await AuditLog.countDocuments()).toBe(0);

    const actorId = new mongoose.Types.ObjectId();
    await applyBlockchainReconciliation({
      actorId,
      expectedObservedEpoch: 'epoch-a',
      fabricClient: client,
    });

    const restored = await IDRecord.findById(record._id).lean();
    expect(restored).toMatchObject({
      status: 'REVOKED',
      revokedReason: 'Revoked before Mongo restore',
      revokedAt: new Date('2026-07-30T10:11:12.000Z'),
    });
    expect(restored.revokedById).toBeUndefined();
    expect(await AuditLog.findOne({ action: 'BLOCKCHAIN_RECONCILIATION_APPLIED' }).lean())
      .toMatchObject({ userId: actorId });
  });

  test('adopts ledger EXPIRED over local ACTIVE', async () => {
    const applicant = await createApplicant({ suffix: '5' });
    const record = await createRecord(applicant, { suffix: '5', status: 'ACTIVE' });
    await FabricLedgerState.create({
      key: 'primary', acceptedEpoch: 'epoch-a', observedEpoch: 'epoch-a', status: 'ACTIVE',
    });
    const client = fabricClient({
      epoch: 'epoch-a',
      ledger: {
        [record.idNumber]: { found: true, recordRef: record.idNumber, status: 'EXPIRED' },
      },
    });

    await applyBlockchainReconciliation({
      actorId: new mongoose.Types.ObjectId(),
      expectedObservedEpoch: 'epoch-a',
      fabricClient: client,
    });

    expect(await IDRecord.findById(record._id).lean()).toMatchObject({ status: 'EXPIRED' });
  });

  test('recreates only safe missing lifecycle intents and leaves PARTIAL records unanchored', async () => {
    await FabricLedgerState.create({
      key: 'primary', acceptedEpoch: 'epoch-a', observedEpoch: 'epoch-a', status: 'ACTIVE',
    });

    const revokedApplicant = await createApplicant({ suffix: '6' });
    const revoked = await createRecord(revokedApplicant, {
      suffix: '6', status: 'REVOKED', revokedReason: 'Restored local revoke',
    });
    await BlockchainAnchor.create({
      idRecordId: revoked._id,
      recordRef: revoked.idNumber,
      canonicalHash: 'a'.repeat(64),
      txId: 'tx-current',
      blockNumber: 2,
      ledgerEpoch: 'epoch-a',
      receiptState: 'CURRENT',
    });

    const expiredApplicant = await createApplicant({ suffix: '7' });
    const expired = await createRecord(expiredApplicant, {
      suffix: '7', status: 'EXPIRED', chainSequence: 1,
    });
    await createOperation(expired, { operation: 'ANCHOR', sequence: 1, state: 'PENDING' });

    const completeApplicant = await createApplicant({ suffix: '8' });
    const complete = await createRecord(completeApplicant, { suffix: '8', status: 'ACTIVE' });

    const partialApplicant = await createApplicant({ status: 'PARTIAL', suffix: '9' });
    const partial = await createRecord(partialApplicant, { suffix: '9', status: 'ACTIVE' });

    const client = fabricClient({
      epoch: 'epoch-a',
      ledger: {
        [revoked.idNumber]: { found: true, recordRef: revoked.idNumber, status: 'ACTIVE' },
      },
    });

    const report = await scanBlockchainConsistency({ fabricClient: client });
    expect(report.counts).toMatchObject({
      missingTerminalIntents: 2,
      missingAnchorIntents: 1,
      partialUnanchored: 1,
    });
    expect(await ChainOutbox.countDocuments()).toBe(1);

    await applyBlockchainReconciliation({
      actorId: new mongoose.Types.ObjectId(),
      expectedObservedEpoch: 'epoch-a',
      fabricClient: client,
    });

    const revokedOps = await ChainOutbox.find({ idRecordId: revoked._id }).lean();
    expect(revokedOps).toHaveLength(1);
    expect(revokedOps[0]).toMatchObject({ operation: 'REVOKE', sequence: 1, state: 'PENDING' });

    const expiredOps = await ChainOutbox.find({ idRecordId: expired._id }).sort({ sequence: 1 }).lean();
    expect(expiredOps.map((item) => [item.operation, item.sequence, item.state])).toEqual([
      ['ANCHOR', 1, 'PENDING'],
      ['EXPIRE', 2, 'BLOCKED'],
    ]);

    expect(await ChainOutbox.findOne({ idRecordId: complete._id }).lean())
      .toMatchObject({ operation: 'ANCHOR', sequence: 1, state: 'PENDING' });
    expect(await ChainOutbox.countDocuments({ idRecordId: partial._id })).toBe(0);
  });
});
