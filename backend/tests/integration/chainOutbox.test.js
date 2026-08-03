'use strict';

const mongoose = require('mongoose');
const db = require('../dbHelpers');
const ChainOutbox = require('../../src/models/ChainOutbox');
const IDRecord = require('../../src/models/IDRecord');
const Sequence = require('../../src/models/Sequence');
const { withMongoTransaction } = require('../../src/lib/transactions');

beforeAll(async () => {
  await db.connect();
  await ChainOutbox.syncIndexes();
});
afterAll(async () => { await db.disconnect(); });
afterEach(async () => { await db.clear(); });

function operation(overrides = {}) {
  return {
    operationId: 'anchor:507f1f77bcf86cd799439011',
    operation: 'ANCHOR',
    idRecordId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
    recordRef: 'PWD-2026-0000001',
    sequence: 1,
    payload: {
      canonicalHash: 'a'.repeat(64),
      idType: 'PWD',
      soloParentIdType: '',
      issuingOffice: 'MSWDO-GERONA-TARLAC',
    },
    ...overrides,
  };
}

describe('ChainOutbox schema', () => {
  test('rejects unsupported operation and state values', () => {
    const invalidOperation = new ChainOutbox(operation({ operation: 'DELETE' }));
    const invalidState = new ChainOutbox(operation({ state: 'DONE' }));

    expect(invalidOperation.validateSync().errors.operation.kind).toBe('enum');
    expect(invalidState.validateSync().errors.state.kind).toBe('enum');
    expect(ChainOutbox.schema.path('operation').enumValues)
      .toEqual(['ANCHOR', 'REVOKE', 'EXPIRE']);
    expect(ChainOutbox.schema.path('state').enumValues)
      .toEqual(['PENDING', 'PROCESSING', 'SENT', 'BLOCKED', 'FAILED']);
  });

  test('applies durable queue defaults', async () => {
    const created = await ChainOutbox.create(operation());

    expect(created.state).toBe('PENDING');
    expect(created.attempts).toBe(0);
    expect(created.reconciled).toBe(false);
    expect(created.nextAttempt).toBeInstanceOf(Date);
  });

  test('defines due-row and deterministic-order indexes', () => {
    const indexes = ChainOutbox.schema.indexes();
    const dueRows = indexes.find(([keys]) => (
      keys.state === 1 && keys.nextAttempt === 1 && Object.keys(keys).length === 2
    ));
    const recordOrder = indexes.find(([keys]) => (
      keys.recordRef === 1 && keys.sequence === 1 && Object.keys(keys).length === 2
    ));

    expect(dueRows).toBeDefined();
    expect(recordOrder[1]).toMatchObject({ unique: true });
  });

  test('rejects a duplicate operation identity', async () => {
    await ChainOutbox.create(operation());

    await expect(ChainOutbox.create(operation({
      recordRef: 'PWD-2026-0000002',
      sequence: 2,
    }))).rejects.toMatchObject({ code: 11000 });
  });

  test('rejects a duplicate sequence for the same record', async () => {
    await ChainOutbox.create(operation());

    await expect(ChainOutbox.create(operation({
      operationId: 'revoke:507f1f77bcf86cd799439011',
      operation: 'REVOKE',
      payload: { reason: 'Duplicate record' },
    }))).rejects.toMatchObject({ code: 11000 });
  });

  test('does not allow command identity or payload to change after insertion', async () => {
    const created = await ChainOutbox.create(operation());
    created.operationId = 'anchor:changed';
    created.payload = { canonicalHash: 'b'.repeat(64) };
    await created.save();

    const persisted = await ChainOutbox.findById(created._id).lean();
    expect(persisted.operationId).toBe('anchor:507f1f77bcf86cd799439011');
    expect(persisted.payload).toEqual({
      canonicalHash: 'a'.repeat(64),
      idType: 'PWD',
      soloParentIdType: '',
      issuingOffice: 'MSWDO-GERONA-TARLAC',
    });
  });

  test('rejects a marked nested payload mutation after insertion', async () => {
    const created = await ChainOutbox.create(operation());
    created.payload.canonicalHash = 'b'.repeat(64);
    created.markModified('payload');

    await expect(created.save()).rejects.toThrow('ChainOutbox payload is immutable');

    const persisted = await ChainOutbox.findById(created._id).lean();
    expect(persisted.payload.canonicalHash).toBe('a'.repeat(64));
  });
});

describe('IDRecord chain sequence', () => {
  test('starts at zero', async () => {
    const record = await IDRecord.create({
      applicantId: new mongoose.Types.ObjectId(),
      department: 'PWD',
      idNumber: 'PWD-2026-0000001',
      qrToken: 'task-2-2-chain-sequence',
    });

    expect(record.chainSequence).toBe(0);
  });
});

describe('BlockchainAnchor receipt state', () => {
  test('defaults a new receipt to CURRENT and accepts STALE', async () => {
    const BlockchainAnchor = require('../../src/models/BlockchainAnchor');
    const current = await BlockchainAnchor.create({
      idRecordId: new mongoose.Types.ObjectId(),
      recordRef: 'PWD-2026-0000001',
      canonicalHash: 'a'.repeat(64),
      ledgerEpoch: 'epoch-a',
    });
    const stale = new BlockchainAnchor({ receiptState: 'STALE' });

    expect(current.receiptState).toBe('CURRENT');
    expect(stale.validateSync()).toBeUndefined();
  });
});

describe('withMongoTransaction', () => {
  test('commits and returns the callback result', async () => {
    let usedSession;
    const result = await withMongoTransaction(async (session) => {
      usedSession = session;
      await Sequence.create([{ name: 'tx-helper-commit', value: 1 }], { session });
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(await Sequence.countDocuments({ name: 'tx-helper-commit' })).toBe(1);
    expect(usedSession.hasEnded).toBe(true);
  });

  test('rolls back and ends the session when the callback throws', async () => {
    let usedSession;

    await expect(withMongoTransaction(async (session) => {
      usedSession = session;
      await Sequence.create([{ name: 'tx-helper-rollback', value: 1 }], { session });
      throw new Error('force rollback');
    })).rejects.toThrow('force rollback');

    expect(await Sequence.countDocuments({ name: 'tx-helper-rollback' })).toBe(0);
    expect(usedSession.hasEnded).toBe(true);
  });
});
