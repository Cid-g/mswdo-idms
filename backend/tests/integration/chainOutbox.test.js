'use strict';

const mongoose = require('mongoose');
const db = require('../dbHelpers');
const Applicant = require('../../src/models/Applicant');
const ChainOutbox = require('../../src/models/ChainOutbox');
const IDRecord = require('../../src/models/IDRecord');
const Sequence = require('../../src/models/Sequence');
const { withMongoTransaction } = require('../../src/lib/transactions');
const {
  buildAnchorPayload,
  enqueueChainOp,
  operationIdFor,
} = require('../../src/services/chainOutbox');

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

async function createApplicantAndRecord() {
  const applicant = await Applicant.create({
    department: 'PWD',
    encodedById: new mongoose.Types.ObjectId(),
    lastName: 'Santos',
    firstName: 'Maria',
    middleName: 'Reyes',
    birthdate: new Date('1980-01-02T00:00:00.000Z'),
    sex: 'Female',
    status: 'COMPLETE',
  });
  const idRecord = await IDRecord.create({
    applicantId: applicant._id,
    department: 'PWD',
    idNumber: 'PWD-2026-0000100',
    qrToken: 'task-2-3-enqueue',
    issuedDate: new Date('2026-08-03T00:00:00.000Z'),
    expiryDate: new Date('2031-08-03T00:00:00.000Z'),
  });

  return { applicant, idRecord };
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

describe('chain operation enqueue', () => {
  test('builds the immutable ANCHOR command from the event snapshot', async () => {
    const { applicant, idRecord } = await createApplicantAndRecord();

    const payload = buildAnchorPayload(applicant, idRecord);

    expect(payload).toEqual({
      canonicalHash: '4db9eb350e440fd818e1532ae1843e6b91680f03c7da1ae7503a6dc3ce0eb025',
      idType: 'PWD',
      soloParentIdType: '',
      issuingOffice: 'MSWDO-GERONA-TARLAC',
    });
    expect(Object.isFrozen(payload)).toBe(true);
    expect(operationIdFor('ANCHOR', idRecord._id)).toBe(`anchor:${idRecord._id}`);
  });

  test('keeps the queued ANCHOR payload unchanged after applicant edits', async () => {
    const { applicant, idRecord } = await createApplicantAndRecord();
    const payload = buildAnchorPayload(applicant, idRecord);

    await withMongoTransaction((session) => enqueueChainOp({
      session,
      operationId: operationIdFor('ANCHOR', idRecord._id),
      operation: 'ANCHOR',
      idRecordId: idRecord._id,
      payload,
    }));

    applicant.firstName = 'Marissa';
    await applicant.save();

    const queued = await ChainOutbox.findOne({ idRecordId: idRecord._id }).lean();
    expect(queued.payload).toEqual({
      canonicalHash: '4db9eb350e440fd818e1532ae1843e6b91680f03c7da1ae7503a6dc3ce0eb025',
      idType: 'PWD',
      soloParentIdType: '',
      issuingOffice: 'MSWDO-GERONA-TARLAC',
    });
    expect(buildAnchorPayload(applicant, idRecord).canonicalHash)
      .not.toBe(queued.payload.canonicalHash);
  });

  test('returns one command and consumes one sequence for a duplicate operation ID', async () => {
    const { applicant, idRecord } = await createApplicantAndRecord();
    const command = {
      operationId: operationIdFor('ANCHOR', idRecord._id),
      operation: 'ANCHOR',
      idRecordId: idRecord._id,
      payload: buildAnchorPayload(applicant, idRecord),
    };
    let first;
    let duplicate;

    await withMongoTransaction(async (session) => {
      first = await enqueueChainOp({ session, ...command });
      duplicate = await enqueueChainOp({ session, ...command });
    });

    expect(duplicate._id.toString()).toBe(first._id.toString());
    expect(await ChainOutbox.countDocuments()).toBe(1);
    expect((await IDRecord.findById(idRecord._id)).chainSequence).toBe(1);
  });

  test('converges concurrent identical commands from independent transactions', async () => {
    const { applicant, idRecord } = await createApplicantAndRecord();
    const command = {
      operationId: operationIdFor('ANCHOR', idRecord._id),
      operation: 'ANCHOR',
      idRecordId: idRecord._id,
      payload: buildAnchorPayload(applicant, idRecord),
    };

    const [first, duplicate] = await Promise.all([
      withMongoTransaction((session) => enqueueChainOp({ session, ...command })),
      withMongoTransaction((session) => enqueueChainOp({ session, ...command })),
    ]);

    expect(duplicate._id.toString()).toBe(first._id.toString());
    expect(await ChainOutbox.countDocuments()).toBe(1);
    expect((await IDRecord.findById(idRecord._id)).chainSequence).toBe(1);
  });

  test('rejects a concurrent operation ID collision from independent transactions', async () => {
    const { applicant, idRecord } = await createApplicantAndRecord();
    const operationId = operationIdFor('ANCHOR', idRecord._id);
    const baseCommand = {
      operationId,
      operation: 'ANCHOR',
      idRecordId: idRecord._id,
      payload: buildAnchorPayload(applicant, idRecord),
    };
    const conflictingCommand = {
      ...baseCommand,
      payload: { ...baseCommand.payload, canonicalHash: 'b'.repeat(64) },
    };

    const results = await Promise.allSettled([
      withMongoTransaction((session) => enqueueChainOp({ session, ...baseCommand })),
      withMongoTransaction((session) => enqueueChainOp({ session, ...conflictingCommand })),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'CHAIN_OPERATION_ID_COLLISION' });
    expect(await ChainOutbox.countDocuments()).toBe(1);
    expect((await IDRecord.findById(idRecord._id)).chainSequence).toBe(1);
  });

  test('rejects an operation ID collision without consuming another sequence', async () => {
    const { applicant, idRecord } = await createApplicantAndRecord();
    const operationId = operationIdFor('ANCHOR', idRecord._id);

    await withMongoTransaction((session) => enqueueChainOp({
      session,
      operationId,
      operation: 'ANCHOR',
      idRecordId: idRecord._id,
      payload: buildAnchorPayload(applicant, idRecord),
    }));

    await expect(withMongoTransaction((session) => enqueueChainOp({
      session,
      operationId,
      operation: 'ANCHOR',
      idRecordId: idRecord._id,
      payload: {
        canonicalHash: 'b'.repeat(64),
        idType: 'PWD',
        soloParentIdType: '',
        issuingOffice: 'MSWDO-GERONA-TARLAC',
      },
    }))).rejects.toMatchObject({ code: 'CHAIN_OPERATION_ID_COLLISION' });

    expect(await ChainOutbox.countDocuments()).toBe(1);
    expect((await IDRecord.findById(idRecord._id)).chainSequence).toBe(1);
  });

  test('rolls back business state and sequence when outbox validation fails', async () => {
    const { idRecord } = await createApplicantAndRecord();

    await expect(withMongoTransaction(async (session) => {
      await IDRecord.updateOne(
        { _id: idRecord._id },
        { $set: { status: 'REVOKED' } },
        { session }
      );
      await enqueueChainOp({
        session,
        operationId: operationIdFor('REVOKE', idRecord._id),
        operation: 'INVALID',
        idRecordId: idRecord._id,
        payload: { reason: 'test' },
      });
    })).rejects.toThrow();

    const persisted = await IDRecord.findById(idRecord._id).lean();
    expect(persisted.status).toBe('ACTIVE');
    expect(persisted.chainSequence).toBe(0);
    expect(await ChainOutbox.countDocuments()).toBe(0);
  });

  test('allocates strictly increasing sequences for different operations', async () => {
    const { applicant, idRecord } = await createApplicantAndRecord();
    let anchor;
    let revoke;

    await withMongoTransaction(async (session) => {
      anchor = await enqueueChainOp({
        session,
        operationId: operationIdFor('ANCHOR', idRecord._id),
        operation: 'ANCHOR',
        idRecordId: idRecord._id,
        payload: buildAnchorPayload(applicant, idRecord),
      });
      revoke = await enqueueChainOp({
        session,
        operationId: operationIdFor('REVOKE', idRecord._id),
        operation: 'REVOKE',
        idRecordId: idRecord._id,
        payload: { reason: 'Duplicate record' },
      });
    });

    expect(anchor.sequence).toBe(1);
    expect(revoke.sequence).toBe(2);
    expect((await IDRecord.findById(idRecord._id)).chainSequence).toBe(2);
  });

  test('rejects enqueue outside an active MongoDB transaction', async () => {
    const { applicant, idRecord } = await createApplicantAndRecord();
    const session = await mongoose.startSession();

    try {
      await expect(enqueueChainOp({
        session,
        operationId: operationIdFor('ANCHOR', idRecord._id),
        operation: 'ANCHOR',
        idRecordId: idRecord._id,
        payload: buildAnchorPayload(applicant, idRecord),
      })).rejects.toThrow('active MongoDB transaction');
    } finally {
      await session.endSession();
    }

    expect(await ChainOutbox.countDocuments()).toBe(0);
    expect((await IDRecord.findById(idRecord._id)).chainSequence).toBe(0);
  });
});
