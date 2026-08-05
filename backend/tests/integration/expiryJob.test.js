'use strict';

const mongoose = require('mongoose');

const db = require('../dbHelpers');
const Applicant = require('../../src/models/Applicant');
const BlockchainAnchor = require('../../src/models/BlockchainAnchor');
const ChainOutbox = require('../../src/models/ChainOutbox');
const IDRecord = require('../../src/models/IDRecord');
const JobLease = require('../../src/models/JobLease');
const VerifyOutbox = require('../../src/models/VerifyOutbox');
const {
  runExpiryJobOnce,
  startExpiryJob,
  stopExpiryJob,
} = require('../../src/jobs/expiryJob');

const NOW = new Date('2026-08-05T10:00:00.000Z');
const PAST_DUE = new Date('2026-08-04T10:00:00.000Z');

beforeAll(async () => {
  await db.connect();
  await Promise.all([
    IDRecord.syncIndexes(),
    BlockchainAnchor.syncIndexes(),
    ChainOutbox.syncIndexes(),
    JobLease.syncIndexes(),
    VerifyOutbox.syncIndexes(),
  ]);
});

afterAll(async () => {
  await stopExpiryJob();
  await db.disconnect();
});

afterEach(async () => {
  await stopExpiryJob();
  jest.useRealTimers();
  jest.restoreAllMocks();
  await db.clear();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function createRecord({
  department = 'PWD',
  status = 'ACTIVE',
  expiryDate = PAST_DUE,
  chainSequence = 0,
  suffix = new mongoose.Types.ObjectId().toString(),
  applicantId,
} = {}) {
  let resolvedApplicantId = applicantId;
  if (!resolvedApplicantId) {
    const applicant = await Applicant.create({
      department,
      encodedById: new mongoose.Types.ObjectId(),
      firstName: 'Expiry',
      lastName: `Record ${suffix}`,
      birthdate: new Date('1990-01-01T00:00:00.000Z'),
      barangay: 'Poblacion 1',
      status: 'COMPLETE',
    });
    resolvedApplicantId = applicant._id;
  }

  return IDRecord.create({
    applicantId: resolvedApplicantId,
    department,
    idNumber: `${department}-${suffix}`,
    qrToken: `expiry-token-${suffix}`,
    issuedDate: new Date('2025-08-05T00:00:00.000Z'),
    expiryDate,
    status,
    chainSequence,
  });
}

async function addAnchorReceipt(record) {
  return BlockchainAnchor.create({
    idRecordId: record._id,
    recordRef: record.idNumber,
    canonicalHash: 'a'.repeat(64),
    txId: String(record._id).padEnd(64, '0'),
    blockNumber: 42,
    ledgerEpoch: 'expiry-ledger-epoch',
  });
}

async function addPendingAnchor(record) {
  await IDRecord.updateOne({ _id: record._id }, { $set: { chainSequence: 1 } });
  return ChainOutbox.create({
    operationId: `anchor:${record._id}`,
    operation: 'ANCHOR',
    idRecordId: record._id,
    recordRef: record.idNumber,
    sequence: 1,
    payload: {
      canonicalHash: 'b'.repeat(64),
      idType: record.department,
      soloParentIdType: '',
      issuingOffice: 'MSWDO-GERONA-TARLAC',
    },
    state: 'PENDING',
    nextAttempt: NOW,
  });
}

async function expectPendingExpire(record, expectedSequence) {
  const operation = await ChainOutbox.findOne({
    operationId: `expire:${record._id}`,
  }).lean();

  expect(operation).toMatchObject({
    operation: 'EXPIRE',
    idRecordId: record._id,
    recordRef: record.idNumber,
    sequence: expectedSequence,
    state: 'PENDING',
    attempts: 0,
    payload: {},
  });
}

async function expectPendingVerificationExpire(record, { hasReceipt }) {
  const operation = await VerifyOutbox.findOne({
    operationId: `verify:expire:${record._id}`,
  }).lean();

  expect(operation).toMatchObject({
    idRecordId: record._id,
    epoch: 1,
    revision: 1,
    state: 'PENDING',
    attempts: 0,
    payload: {
      expiryDate: '2026-08-04',
      idNumber: record.idNumber,
      idType: record.department,
      issuedDate: '2025-08-05',
      releasedAt: null,
      status: 'EXPIRED',
    },
  });
  expect(operation.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(operation)).not.toContain(record.qrToken);

  if (hasReceipt) {
    expect(operation.payload).toMatchObject({
      anchoredAt: expect.any(String),
      anchoredHash: 'a'.repeat(64),
      blockNumber: 42,
      txId: String(record._id).padEnd(64, '0'),
    });
  } else {
    expect(operation.payload).toMatchObject({
      anchoredAt: null,
      anchoredHash: null,
      blockNumber: null,
      txId: null,
    });
  }
}

describe('daily leased expiry job', () => {
  test('allows one lease owner to run while a concurrent owner skips', async () => {
    const record = await createRecord({ suffix: 'lease-race' });
    await addAnchorReceipt(record);

    const enteredExpiryUpdate = deferred();
    const releaseExpiryUpdate = deferred();
    const originalFindOneAndUpdate = IDRecord.findOneAndUpdate.bind(IDRecord);
    jest.spyOn(IDRecord, 'findOneAndUpdate').mockImplementationOnce(async (...args) => {
      enteredExpiryUpdate.resolve();
      await releaseExpiryUpdate.promise;
      return originalFindOneAndUpdate(...args);
    });

    const firstRun = runExpiryJobOnce({ owner: 'expiry-owner-a', now: NOW });
    await enteredExpiryUpdate.promise;

    const secondResult = await runExpiryJobOnce({ owner: 'expiry-owner-b', now: NOW });
    expect(secondResult).toEqual({
      acquired: false,
      skipped: 'LEASE_HELD',
      expired: 0,
      queued: 0,
    });
    expect(await JobLease.countDocuments({ name: 'blockchain-expiry' })).toBe(1);

    releaseExpiryUpdate.resolve();
    await expect(firstRun).resolves.toMatchObject({ acquired: true, expired: 1, queued: 1 });
    await expectPendingExpire(record, 1);
    await expectPendingVerificationExpire(record, { hasReceipt: true });
  });

  test('expires an anchored past-due ACTIVE ID and queues EXPIRE atomically', async () => {
    const record = await createRecord({ suffix: 'anchored' });
    await addAnchorReceipt(record);

    const result = await runExpiryJobOnce({ owner: 'expiry-anchored', now: NOW });

    expect(result).toEqual({ acquired: true, expired: 1, queued: 1 });
    const persisted = await IDRecord.findById(record._id).lean();
    expect(persisted.status).toBe('EXPIRED');
    expect(persisted.chainSequence).toBe(1);
    expect(persisted.verifyRevision).toBe(1);
    await expectPendingExpire(record, 1);
    await expectPendingVerificationExpire(record, { hasReceipt: true });
  });

  test('keeps a pending ANCHOR as sequence one and queues EXPIRE as sequence two', async () => {
    const record = await createRecord({ suffix: 'pending-anchor' });
    const anchor = await addPendingAnchor(record);

    const result = await runExpiryJobOnce({ owner: 'expiry-pending-anchor', now: NOW });

    expect(result).toEqual({ acquired: true, expired: 1, queued: 1 });
    const persisted = await IDRecord.findById(record._id).lean();
    expect(persisted.status).toBe('EXPIRED');
    expect(persisted.chainSequence).toBe(2);
    expect((await ChainOutbox.findById(anchor._id).lean()).sequence).toBe(1);
    expect(persisted.verifyRevision).toBe(1);
    await expectPendingExpire(record, 2);
    await expectPendingVerificationExpire(record, { hasReceipt: false });
  });

  test('expires an unanchored PARTIAL card locally without queueing an impossible EXPIRE', async () => {
    const applicant = await Applicant.create({
      department: 'PWD',
      encodedById: new mongoose.Types.ObjectId(),
      firstName: 'Partial',
      lastName: 'Applicant',
      birthdate: new Date('1990-01-01T00:00:00.000Z'),
      barangay: 'Poblacion 1',
      status: 'PARTIAL',
    });
    const record = await createRecord({
      suffix: 'never-anchored',
      applicantId: applicant._id,
    });

    const result = await runExpiryJobOnce({ owner: 'expiry-local-only', now: NOW });

    expect(result).toEqual({ acquired: true, expired: 1, queued: 0 });
    const persisted = await IDRecord.findById(record._id).lean();
    expect(persisted.status).toBe('EXPIRED');
    expect(persisted.chainSequence).toBe(0);
    expect(persisted.verifyRevision).toBe(1);
    expect(await ChainOutbox.countDocuments({ idRecordId: record._id })).toBe(0);
    await expectPendingVerificationExpire(record, { hasReceipt: false });
  });

  test('ignores Senior Citizen IDs whose expiryDate is null', async () => {
    const record = await createRecord({
      department: 'SENIOR_CITIZEN',
      expiryDate: null,
      suffix: 'senior-no-expiry',
    });
    await addAnchorReceipt(record);

    const result = await runExpiryJobOnce({ owner: 'expiry-senior', now: NOW });

    expect(result).toEqual({ acquired: true, expired: 0, queued: 0 });
    expect((await IDRecord.findById(record._id).lean()).status).toBe('ACTIVE');
    expect(await ChainOutbox.countDocuments({ idRecordId: record._id })).toBe(0);
    expect(await VerifyOutbox.countDocuments({ idRecordId: record._id })).toBe(0);
  });

  test('rolls back expiry when enqueue fails so a later scan can rediscover it', async () => {
    const record = await createRecord({ suffix: 'rollback' });
    await addAnchorReceipt(record);
    jest.spyOn(ChainOutbox, 'create').mockRejectedValueOnce(new Error('forced expiry enqueue failure'));

    await expect(runExpiryJobOnce({ owner: 'expiry-rollback-a', now: NOW }))
      .rejects.toThrow('forced expiry enqueue failure');

    let persisted = await IDRecord.findById(record._id).lean();
    expect(persisted.status).toBe('ACTIVE');
    expect(persisted.chainSequence).toBe(0);
    expect(persisted.verifyRevision).toBe(0);
    expect(await ChainOutbox.countDocuments({ idRecordId: record._id })).toBe(0);
    expect(await VerifyOutbox.countDocuments({ idRecordId: record._id })).toBe(0);

    jest.restoreAllMocks();
    await expect(runExpiryJobOnce({ owner: 'expiry-rollback-b', now: NOW }))
      .resolves.toEqual({ acquired: true, expired: 1, queued: 1 });

    persisted = await IDRecord.findById(record._id).lean();
    expect(persisted.status).toBe('EXPIRED');
    expect(persisted.verifyRevision).toBe(1);
    await expectPendingExpire(record, 1);
    await expectPendingVerificationExpire(record, { hasReceipt: true });
  });

  test('rolls back local and Fabric expiry intent when verification enqueue fails', async () => {
    const record = await createRecord({ suffix: 'verification-rollback' });
    await addAnchorReceipt(record);
    jest.spyOn(VerifyOutbox, 'create')
      .mockRejectedValueOnce(new Error('forced verification expiry enqueue failure'));

    await expect(runExpiryJobOnce({ owner: 'expiry-verification-rollback', now: NOW }))
      .rejects.toThrow('forced verification expiry enqueue failure');

    const persisted = await IDRecord.findById(record._id).lean();
    expect(persisted.status).toBe('ACTIVE');
    expect(persisted.chainSequence).toBe(0);
    expect(persisted.verifyRevision).toBe(0);
    expect(await ChainOutbox.countDocuments({ idRecordId: record._id })).toBe(0);
    expect(await VerifyOutbox.countDocuments({ idRecordId: record._id })).toBe(0);
  });

  test('does not overwrite REVOKED when revocation wins after candidate discovery', async () => {
    const record = await createRecord({ suffix: 'revoke-race' });
    await addAnchorReceipt(record);

    const originalFindOneAndUpdate = IDRecord.findOneAndUpdate.bind(IDRecord);
    jest.spyOn(IDRecord, 'findOneAndUpdate').mockImplementationOnce(async (...args) => {
      await IDRecord.updateOne(
        { _id: record._id, status: 'ACTIVE' },
        {
          $set: {
            status: 'REVOKED',
            revokedReason: 'Concurrent revocation wins',
            revokedAt: NOW,
            revokedById: new mongoose.Types.ObjectId(),
          },
        }
      );
      return originalFindOneAndUpdate(...args);
    });

    const result = await runExpiryJobOnce({ owner: 'expiry-revoke-race', now: NOW });

    expect(result).toEqual({ acquired: true, expired: 0, queued: 0 });
    const persisted = await IDRecord.findById(record._id).lean();
    expect(persisted.status).toBe('REVOKED');
    expect(persisted.revokedReason).toBe('Concurrent revocation wins');
    expect(await ChainOutbox.countDocuments({
      idRecordId: record._id,
      operation: 'EXPIRE',
    })).toBe(0);
    expect(await VerifyOutbox.countDocuments({ idRecordId: record._id })).toBe(0);
  });

  test('uses the same non-overlapping runner for the immediate boot run and interval runs', async () => {
    jest.useFakeTimers();
    expect(jest.getTimerCount()).toBe(0);
    const firstRun = deferred();
    const runOnce = jest.fn()
      .mockImplementationOnce(() => firstRun.promise)
      .mockResolvedValue({ acquired: true, expired: 0, queued: 0 });
    const onError = jest.fn();

    expect(startExpiryJob({
      intervalMs: 1_000,
      owner: 'expiry-scheduler',
      runOnce,
      now: () => NOW,
      onError,
    })).toEqual({ started: true, owner: 'expiry-scheduler' });

    await jest.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(runOnce).toHaveBeenLastCalledWith({ owner: 'expiry-scheduler', now: NOW });

    // The interval fires while the boot run is unresolved, but must not overlap.
    await jest.advanceTimersByTimeAsync(1_000);
    expect(runOnce).toHaveBeenCalledTimes(1);

    firstRun.resolve({ acquired: true, expired: 0, queued: 0 });
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(1_000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(runOnce).toHaveBeenLastCalledWith({ owner: 'expiry-scheduler', now: NOW });
    expect(onError).not.toHaveBeenCalled();

    await stopExpiryJob();
    expect(jest.getTimerCount()).toBe(0);
  });
});
