'use strict';

const mongoose = require('mongoose');
const db = require('../dbHelpers');
const IDRecord = require('../../src/models/IDRecord');
const VerifyOutbox = require('../../src/models/VerifyOutbox');
const {
  digestVerificationPayload,
  validateVerificationPayload,
} = require('../../src/lib/verificationPayload');

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
    idNumber: 'PWD-2026-0000001',
    idType: 'PWD',
    issuedDate: '2026-08-05',
    maskedName: 'S****, M****',
    releasedAt: null,
    status: 'ACTIVE',
    txId: null,
    ...overrides,
  };
}

function operation(overrides = {}) {
  const idRecordId = overrides.idRecordId
    ?? new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const epoch = overrides.epoch ?? 1;
  const revision = overrides.revision ?? 1;
  const recordPayload = overrides.payload ?? payload();

  return {
    operationId: overrides.operationId ?? `verify:${idRecordId}:${epoch}:${revision}`,
    idRecordId,
    tokenHash: overrides.tokenHash ?? 'a'.repeat(64),
    payload: recordPayload,
    payloadDigest: overrides.payloadDigest ?? digestVerificationPayload(recordPayload),
    epoch,
    revision,
    ...overrides,
  };
}

describe('verification payload contract', () => {
  test('accepts only the exact minimized cloud payload', () => {
    expect(validateVerificationPayload(payload())).toEqual(payload());

    expect(() => validateVerificationPayload(payload({
      rawToken: 'must-never-leave-local-storage',
    }))).toThrow('fields do not match');

    expect(() => validateVerificationPayload(payload({
      fullName: 'Maria Santos',
    }))).toThrow('fields do not match');
  });

  test('requires a complete issuance-receipt tuple', () => {
    expect(() => validateVerificationPayload(payload({
      anchoredHash: 'b'.repeat(64),
    }))).toThrow('all present or all null');

    expect(validateVerificationPayload(payload({
      anchoredAt: '2026-08-05T01:02:03.004Z',
      anchoredHash: 'b'.repeat(64),
      blockNumber: 42,
      txId: 'c'.repeat(64),
    }))).toBeDefined();
  });

  test('hashes the exact canonical payload deterministically', () => {
    const first = payload();
    const second = Object.fromEntries(Object.entries(first).reverse());

    expect(digestVerificationPayload(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(digestVerificationPayload(second)).toBe(digestVerificationPayload(first));
  });
});

describe('VerifyOutbox schema', () => {
  test('uses only durable local synchronization states', () => {
    expect(VerifyOutbox.schema.path('state').enumValues)
      .toEqual(['PENDING', 'PROCESSING', 'SENT', 'FAILED']);

    const invalidState = new VerifyOutbox(operation({ state: 'BLOCKED' }));
    expect(invalidState.validateSync().errors.state.kind).toBe('enum');
  });

  test('rejects payloads that contain raw-token or full-applicant fields', () => {
    const invalid = new VerifyOutbox({
      ...operation(),
      payload: { ...payload(), qrToken: 'must-never-enter-the-outbox' },
      payloadDigest: 'f'.repeat(64),
    });

    expect(invalid.validateSync().errors.payload).toBeDefined();
  });

  test('applies queue defaults without storing a raw QR token', async () => {
    const created = await VerifyOutbox.create(operation());
    const stored = await VerifyOutbox.findById(created._id).lean();

    expect(created.state).toBe('PENDING');
    expect(created.attempts).toBe(0);
    expect(created.nextAttempt).toBeInstanceOf(Date);
    expect(stored.tokenHash).toBe('a'.repeat(64));
    expect(stored).not.toHaveProperty('qrToken');
    expect(stored).not.toHaveProperty('rawToken');
    expect(stored.payload).not.toHaveProperty('qrToken');
    expect(stored.payload).not.toHaveProperty('rawToken');
  });

  test('defines due-row, identity, and token-history indexes', () => {
    const indexes = VerifyOutbox.schema.indexes();
    const dueRows = indexes.find(([keys]) => (
      keys.state === 1 && keys.nextAttempt === 1 && Object.keys(keys).length === 2
    ));
    const recordRevision = indexes.find(([keys]) => (
      keys.idRecordId === 1 && keys.epoch === 1 && keys.revision === 1
    ));
    const tokenRevision = indexes.find(([keys]) => (
      keys.tokenHash === 1 && keys.epoch === 1 && keys.revision === 1
    ));

    expect(dueRows).toBeDefined();
    expect(recordRevision[1]).toMatchObject({
      name: 'uniq_verify_record_revision',
      unique: true,
    });
    expect(tokenRevision[1]).toMatchObject({
      name: 'uniq_verify_token_revision',
      unique: true,
    });
  });

  test('rejects duplicate operation identity', async () => {
    await VerifyOutbox.create(operation());

    await expect(VerifyOutbox.create(operation({
      operationId: operation().operationId,
      idRecordId: new mongoose.Types.ObjectId(),
      tokenHash: 'b'.repeat(64),
      epoch: 2,
      revision: 2,
    }))).rejects.toMatchObject({ code: 11000 });
  });

  test('rejects two commands for the same local record revision', async () => {
    const first = operation();
    await VerifyOutbox.create(first);

    await expect(VerifyOutbox.create(operation({
      operationId: 'verify:alternate-operation-id',
      tokenHash: 'b'.repeat(64),
    }))).rejects.toMatchObject({ code: 11000 });
  });

  test('rejects two commands for the same token revision', async () => {
    const first = operation();
    await VerifyOutbox.create(first);

    await expect(VerifyOutbox.create(operation({
      operationId: 'verify:alternate-token-operation-id',
      idRecordId: new mongoose.Types.ObjectId(),
    }))).rejects.toMatchObject({ code: 11000 });
  });

  test('rejects malformed hash, epoch, revision, and attempt metadata', () => {
    const malformed = new VerifyOutbox(operation({
      tokenHash: 'raw-token',
      epoch: 0,
      revision: 1.5,
      attempts: -1,
    }));
    const errors = malformed.validateSync().errors;

    expect(errors.tokenHash).toBeDefined();
    expect(errors.epoch).toBeDefined();
    expect(errors.revision).toBeDefined();
    expect(errors.attempts).toBeDefined();
  });

  test('rejects a payload digest that does not match the immutable payload', async () => {
    await expect(VerifyOutbox.create(operation({
      payloadDigest: 'f'.repeat(64),
    }))).rejects.toThrow('payloadDigest does not match payload');
  });

  test('does not allow command identity or payload replacement after insertion', async () => {
    const created = await VerifyOutbox.create(operation());
    const originalIdRecordId = created.idRecordId.toString();
    const originalDigest = created.payloadDigest;
    created.operationId = 'verify:changed';
    created.idRecordId = new mongoose.Types.ObjectId();
    created.tokenHash = 'b'.repeat(64);
    created.payloadDigest = 'f'.repeat(64);
    created.epoch = 2;
    created.revision = 2;
    created.payload = payload({ status: 'REVOKED' });
    await created.save();

    const stored = await VerifyOutbox.findById(created._id).lean();
    expect(stored.operationId).toBe(operation().operationId);
    expect(stored.idRecordId.toString()).toBe(originalIdRecordId);
    expect(stored.tokenHash).toBe('a'.repeat(64));
    expect(stored.payloadDigest).toBe(originalDigest);
    expect(stored.epoch).toBe(1);
    expect(stored.revision).toBe(1);
    expect(stored.payload.status).toBe('ACTIVE');
  });

  test('rejects a marked nested payload mutation after insertion', async () => {
    const created = await VerifyOutbox.create(operation());
    created.payload.status = 'REVOKED';
    created.markModified('payload');

    await expect(created.save()).rejects.toThrow('VerifyOutbox payload is immutable');
    expect((await VerifyOutbox.findById(created._id).lean()).payload.status).toBe('ACTIVE');
  });
});

describe('IDRecord verification revision', () => {
  test('starts at zero independently of the Fabric sequence', async () => {
    const record = await IDRecord.create({
      applicantId: new mongoose.Types.ObjectId(),
      department: 'PWD',
      idNumber: 'PWD-2026-0000001',
      qrToken: 'phase-2b-verify-revision',
      chainSequence: 7,
    });

    expect(record.verifyRevision).toBe(0);
    expect(record.chainSequence).toBe(7);
  });
});
