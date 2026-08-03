'use strict';

const mongoose = require('mongoose');
const db = require('../dbHelpers');
const Applicant = require('../../src/models/Applicant');
const BlockchainAnchor = require('../../src/models/BlockchainAnchor');
const ChainOutbox = require('../../src/models/ChainOutbox');
const IDRecord = require('../../src/models/IDRecord');
const Sequence = require('../../src/models/Sequence');
const { withMongoTransaction } = require('../../src/lib/transactions');
const {
  buildAnchorPayload,
  enqueueChainOp,
  operationIdFor,
} = require('../../src/services/chainOutbox');
const {
  processOperationById,
  runChainOutboxOnce,
} = require('../../src/workers/chainOutboxWorker');

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

function fabricClient(overrides = {}) {
  return {
    ensureFabricConnected: jest.fn().mockResolvedValue({ available: true }),
    executeChainCommand: jest.fn().mockResolvedValue({
      txId: 'tx-worker',
      blockNumber: 73,
      ledgerEpoch: 'ledger-epoch-worker',
      reconciled: false,
      result: { status: 'ACTIVE' },
    }),
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForCall(mock) {
  while (mock.mock.calls.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function queueOperation(overrides = {}) {
  const idRecordId = overrides.idRecordId ?? new mongoose.Types.ObjectId();
  const operationName = overrides.operation ?? 'ANCHOR';
  const sequence = overrides.sequence ?? 1;
  const recordRef = overrides.recordRef ?? `PWD-${idRecordId}`;
  const payload = overrides.payload ?? (operationName === 'ANCHOR' ? {
    canonicalHash: 'a'.repeat(64),
    idType: 'PWD',
    soloParentIdType: '',
    issuingOffice: 'MSWDO-GERONA-TARLAC',
  } : {});

  return ChainOutbox.create({
    operationId: overrides.operationId
      ?? `${operationName.toLowerCase()}:${idRecordId}:${sequence}`,
    operation: operationName,
    idRecordId,
    recordRef,
    sequence,
    payload,
    ...overrides,
  });
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

describe('leased and ordered chain outbox execution', () => {
  const now = new Date('2026-08-03T08:00:00.000Z');

  test('two workers racing for one row claim and submit it once', async () => {
    const queued = await queueOperation({ nextAttempt: now });
    const client = fabricClient();

    await Promise.all([
      runChainOutboxOnce({ owner: 'worker-a', now, fabricClient: client }),
      runChainOutboxOnce({ owner: 'worker-b', now, fabricClient: client }),
    ]);

    expect(client.executeChainCommand).toHaveBeenCalledTimes(1);
    const persisted = await ChainOutbox.findById(queued._id).lean();
    expect(persisted).toMatchObject({ state: 'SENT', attempts: 0, txId: 'tx-worker' });
  });

  test.each([
    ['the five-minute default', undefined, 5 * 60_000],
    ['an injected duration', 12_000, 12_000],
  ])('holds %s lease while Fabric execution is in flight', async (_label, leaseMs, expectedMs) => {
    const queued = await queueOperation({ nextAttempt: now });
    const execution = deferred();
    const client = fabricClient({ executeChainCommand: jest.fn(() => execution.promise) });

    const run = runChainOutboxOnce({
      owner: 'lease-worker',
      now,
      fabricClient: client,
      ...(leaseMs === undefined ? {} : { leaseMs }),
    });
    await waitForCall(client.executeChainCommand);

    expect(await ChainOutbox.findById(queued._id).lean()).toMatchObject({
      state: 'PROCESSING',
      lockOwner: 'lease-worker',
      lockedUntil: new Date(now.getTime() + expectedMs),
      attempts: 0,
    });

    execution.resolve({
      txId: `tx-lease-${expectedMs}`,
      blockNumber: 74,
      ledgerEpoch: 'lease-epoch',
      reconciled: false,
    });
    await run;
  });

  test('recovers an expired lease without consuming a business attempt when Fabric is unavailable', async () => {
    const queued = await queueOperation({
      state: 'PROCESSING',
      attempts: 4,
      lockOwner: 'dead-worker',
      lockedUntil: new Date(now.getTime() - 1),
      nextAttempt: now,
    });
    const client = fabricClient({
      ensureFabricConnected: jest.fn().mockResolvedValue({ available: false, reason: 'DISABLED' }),
    });

    await runChainOutboxOnce({ owner: 'replacement', now, fabricClient: client });

    const persisted = await ChainOutbox.findById(queued._id).lean();
    expect(persisted).toMatchObject({ state: 'PENDING', attempts: 4 });
    expect(persisted.lockOwner).toBeUndefined();
    expect(persisted.lockedUntil).toBeUndefined();
    expect(client.executeChainCommand).not.toHaveBeenCalled();
  });

  test.each(['PENDING', 'PROCESSING', 'BLOCKED', 'FAILED'])(
    'blocks sequence 2 while a lower %s predecessor is not SENT',
    async (predecessorState) => {
      const idRecordId = new mongoose.Types.ObjectId();
      const recordRef = `PWD-${predecessorState}`;
      if (predecessorState === 'BLOCKED') {
        await queueOperation({
          idRecordId,
          recordRef,
          sequence: 0,
          state: 'FAILED',
          nextAttempt: new Date(now.getTime() + 60_000),
        });
      }
      await queueOperation({
        idRecordId,
        recordRef,
        sequence: 1,
        operationId: `anchor:${idRecordId}:predecessor`,
        state: predecessorState,
        lockOwner: predecessorState === 'PROCESSING' ? 'active-worker' : undefined,
        lockedUntil: predecessorState === 'PROCESSING'
          ? new Date(now.getTime() + 60_000)
          : undefined,
        nextAttempt: new Date(now.getTime() + 60_000),
      });
      const dependent = await queueOperation({
        idRecordId,
        recordRef,
        sequence: 2,
        operation: 'REVOKE',
        payload: { reason: 'Duplicate record' },
        nextAttempt: now,
      });
      const client = fabricClient();

      await runChainOutboxOnce({ owner: 'ordering-worker', now, fabricClient: client });

      expect((await ChainOutbox.findById(dependent._id)).state).toBe('BLOCKED');
      expect(client.executeChainCommand).not.toHaveBeenCalled();
    }
  );

  test('unblocks and sends a dependent after its predecessor is SENT', async () => {
    const idRecordId = new mongoose.Types.ObjectId();
    const recordRef = 'PWD-SENT-PREDECESSOR';
    await queueOperation({ idRecordId, recordRef, sequence: 1, state: 'SENT' });
    const dependent = await queueOperation({
      idRecordId,
      recordRef,
      sequence: 2,
      operation: 'REVOKE',
      payload: { reason: 'Superseded' },
      state: 'BLOCKED',
      nextAttempt: now,
    });
    const client = fabricClient();

    await runChainOutboxOnce({ owner: 'unblock-worker', now, fabricClient: client });

    expect((await ChainOutbox.findById(dependent._id)).state).toBe('SENT');
    expect(client.executeChainCommand).toHaveBeenCalledTimes(1);
  });

  test('skips a blocked record and progresses an unrelated record in the same run', async () => {
    const blockedId = new mongoose.Types.ObjectId();
    await queueOperation({
      idRecordId: blockedId,
      recordRef: 'PWD-BLOCKED',
      sequence: 1,
      state: 'FAILED',
      nextAttempt: new Date(now.getTime() + 60_000),
      createdAt: new Date(now.getTime() - 3_000),
    });
    const dependent = await queueOperation({
      idRecordId: blockedId,
      recordRef: 'PWD-BLOCKED',
      sequence: 2,
      operation: 'REVOKE',
      payload: { reason: 'Blocked behind failure' },
      nextAttempt: now,
      createdAt: new Date(now.getTime() - 2_000),
    });
    const unrelated = await queueOperation({
      recordRef: 'PWD-UNRELATED',
      nextAttempt: now,
      createdAt: new Date(now.getTime() - 1_000),
    });
    const client = fabricClient();

    await runChainOutboxOnce({ owner: 'independent-worker', now, fabricClient: client });

    expect((await ChainOutbox.findById(dependent._id)).state).toBe('BLOCKED');
    expect((await ChainOutbox.findById(unrelated._id)).state).toBe('SENT');
    expect(client.executeChainCommand).toHaveBeenCalledWith(expect.objectContaining({
      recordRef: 'PWD-UNRELATED',
    }));
  });

  test.each([
    ['disabled', jest.fn().mockResolvedValue({ available: false, reason: 'DISABLED' })],
    ['disconnected', jest.fn().mockRejectedValue(new Error('gateway unavailable'))],
  ])('leaves attempts and leases unchanged when Fabric is %s', async (_label, ensure) => {
    const queued = await queueOperation({ attempts: 7, nextAttempt: now });
    const client = fabricClient({ ensureFabricConnected: ensure });

    await runChainOutboxOnce({ owner: 'availability-worker', now, fabricClient: client });

    const persisted = await ChainOutbox.findById(queued._id).lean();
    expect(persisted).toMatchObject({ state: 'PENDING', attempts: 7 });
    expect(persisted.lockOwner).toBeUndefined();
    expect(client.executeChainCommand).not.toHaveBeenCalled();
  });

  test.each([
    ['disabled race', 'FABRIC_DISABLED', undefined],
    ['superseded connection', 'FABRIC_CONNECTION_SUPERSEDED', undefined],
    ['numeric unavailable', 14, undefined],
    ['numeric deadline', 4, undefined],
    ['string unavailable', 'UNAVAILABLE', undefined],
    ['string deadline', 'DEADLINE_EXCEEDED', undefined],
    ['wrapped unavailable', 'CHAIN_RECEIPT_RECOVERY_FAILED', 14],
  ])('releases a claimed command without consuming attempts after %s', async (
    _label,
    code,
    causeCode
  ) => {
    const settleTime = new Date('2026-08-03T08:07:00.000Z');
    const queued = await queueOperation({ attempts: 7, nextAttempt: now });
    const execution = deferred();
    const client = fabricClient({ executeChainCommand: jest.fn(() => execution.promise) });

    const run = runChainOutboxOnce({
      owner: 'transport-worker',
      now,
      clock: () => settleTime,
      fabricClient: client,
    });
    await waitForCall(client.executeChainCommand);
    const error = Object.assign(new Error('Fabric infrastructure changed'), { code });
    if (causeCode !== undefined) {
      error.cause = Object.assign(new Error('wrapped transport failure'), { code: causeCode });
    }
    execution.reject(error);
    await run;

    const persisted = await ChainOutbox.findById(queued._id).lean();
    expect(persisted).toMatchObject({
      state: 'PENDING',
      attempts: 7,
      nextAttempt: settleTime,
    });
    expect(persisted.lockOwner).toBeUndefined();
    expect(persisted.lockedUntil).toBeUndefined();
  });

  test('uses settlement time, not claim time, to schedule a slow business failure', async () => {
    const settleTime = new Date('2026-08-03T08:11:00.000Z');
    const queued = await queueOperation({ nextAttempt: now });
    const execution = deferred();
    const client = fabricClient({ executeChainCommand: jest.fn(() => execution.promise) });

    const run = runChainOutboxOnce({
      owner: 'slow-failure-worker',
      now,
      clock: () => settleTime,
      fabricClient: client,
    });
    await waitForCall(client.executeChainCommand);
    execution.reject(new Error('deterministic endorsement conflict'));
    await run;

    expect(await ChainOutbox.findById(queued._id).lean()).toMatchObject({
      state: 'PENDING',
      attempts: 1,
      nextAttempt: new Date(settleTime.getTime() + 30_000),
    });
  });

  test.each([
    [0, 30_000],
    [1, 60_000],
    [2, 5 * 60_000],
    [3, 15 * 60_000],
    [4, 60 * 60_000],
    [8, 60 * 60_000],
  ])('schedules failure from attempt %i with the exact capped backoff', async (
    attempts,
    delayMs
  ) => {
    const queued = await queueOperation({ attempts, nextAttempt: now });
    const conflict = Object.assign(new Error('deterministic conflict'), {
      code: 'CHAIN_STATE_CONFLICT',
    });
    const client = fabricClient({
      executeChainCommand: jest.fn().mockRejectedValue(conflict),
    });

    await runChainOutboxOnce({
      owner: 'retry-worker', now, clock: () => now, fabricClient: client,
    });

    const persisted = await ChainOutbox.findById(queued._id).lean();
    expect(persisted).toMatchObject({ state: 'PENDING', attempts: attempts + 1 });
    expect(persisted.nextAttempt).toEqual(new Date(now.getTime() + delayMs));
    expect(persisted.lastError).toBe('deterministic conflict');
    expect(persisted.lockOwner).toBeUndefined();
  });

  test.each(['ANCHOR', 'EXPIRE'])(
    'moves %s to FAILED on the twentieth failed attempt',
    async (operationName) => {
      const queued = await queueOperation({
        operation: operationName,
        ...(operationName === 'EXPIRE' ? { payload: {} } : {}),
        attempts: 19,
        nextAttempt: now,
      });
      const client = fabricClient({
        executeChainCommand: jest.fn().mockRejectedValue(new Error('command rejected')),
      });

      await runChainOutboxOnce({
        owner: 'terminal-worker', now, clock: () => now, fabricClient: client,
      });

      expect(await ChainOutbox.findById(queued._id).lean()).toMatchObject({
        state: 'FAILED',
        attempts: 20,
        lastError: 'command rejected',
      });
    }
  );

  test('keeps REVOKE pending forever and sets alertedAt only on attempt 20', async () => {
    const queued = await queueOperation({
      operation: 'REVOKE',
      payload: { reason: 'Confirmed duplicate' },
      attempts: 19,
      nextAttempt: now,
    });
    const client = fabricClient({
      executeChainCommand: jest.fn().mockRejectedValue(new Error('endorsement rejected')),
    });

    await runChainOutboxOnce({
      owner: 'revoke-worker', now, clock: () => now, fabricClient: client,
    });
    const afterTwenty = await ChainOutbox.findById(queued._id).lean();
    expect(afterTwenty).toMatchObject({ state: 'PENDING', attempts: 20 });
    expect(afterTwenty.alertedAt).toEqual(now);
    expect(afterTwenty.nextAttempt).toEqual(new Date(now.getTime() + 60 * 60_000));

    const nextRun = new Date(now.getTime() + 60 * 60_000);
    await runChainOutboxOnce({
      owner: 'revoke-worker',
      now: nextRun,
      clock: () => nextRun,
      fabricClient: client,
    });
    const afterTwentyOne = await ChainOutbox.findById(queued._id).lean();
    expect(afterTwentyOne).toMatchObject({ state: 'PENDING', attempts: 21 });
    expect(afterTwentyOne.alertedAt).toEqual(now);
    expect(afterTwentyOne.nextAttempt).toEqual(new Date(nextRun.getTime() + 60 * 60_000));
  });

  test.each([false, true])(
    'commits ANCHOR receipt and SENT together (reconciled: %s)',
    async (reconciled) => {
      const idRecordId = new mongoose.Types.ObjectId();
      const queued = await queueOperation({
        idRecordId,
        recordRef: `PWD-ANCHOR-${reconciled}`,
        nextAttempt: now,
      });
      const client = fabricClient({
        executeChainCommand: jest.fn().mockResolvedValue({
          txId: `tx-anchor-${reconciled}`,
          blockNumber: 91,
          ledgerEpoch: 'ledger-epoch-anchor',
          reconciled,
          result: { status: 'ACTIVE' },
        }),
      });

      await runChainOutboxOnce({
        owner: 'anchor-worker', now, clock: () => now, fabricClient: client,
      });

      const [outbox, anchor] = await Promise.all([
        ChainOutbox.findById(queued._id).lean(),
        BlockchainAnchor.findOne({ idRecordId }).lean(),
      ]);
      expect(outbox).toMatchObject({
        state: 'SENT',
        txId: `tx-anchor-${reconciled}`,
        blockNumber: 91,
        ledgerEpoch: 'ledger-epoch-anchor',
        reconciled,
        completedAt: now,
      });
      expect(outbox.lockOwner).toBeUndefined();
      expect(outbox.lastError).toBeUndefined();
      expect(anchor).toMatchObject({
        idRecordId,
        recordRef: `PWD-ANCHOR-${reconciled}`,
        canonicalHash: 'a'.repeat(64),
        txId: `tx-anchor-${reconciled}`,
        blockNumber: 91,
        ledgerEpoch: 'ledger-epoch-anchor',
        receiptState: 'CURRENT',
      });
      if (reconciled) expect(anchor.reconciledAt).toEqual(now);
      else expect(anchor.reconciledAt).toBeUndefined();
    }
  );

  test('persists anchoredAt and completedAt from a fresh post-Fabric settlement time', async () => {
    const settleTime = new Date('2026-08-03T08:13:00.000Z');
    const idRecordId = new mongoose.Types.ObjectId();
    const queued = await queueOperation({
      idRecordId,
      recordRef: 'PWD-SLOW-ANCHOR',
      nextAttempt: now,
    });
    const execution = deferred();
    const client = fabricClient({ executeChainCommand: jest.fn(() => execution.promise) });
    const clock = jest.fn(() => settleTime);

    const run = runChainOutboxOnce({
      owner: 'slow-anchor-worker', now, clock, fabricClient: client,
    });
    await waitForCall(client.executeChainCommand);
    expect(clock).not.toHaveBeenCalled();
    execution.resolve({
      txId: 'tx-slow-anchor',
      blockNumber: 101,
      ledgerEpoch: 'slow-anchor-epoch',
      reconciled: true,
    });
    await run;

    const [outbox, anchor] = await Promise.all([
      ChainOutbox.findById(queued._id).lean(),
      BlockchainAnchor.findOne({ idRecordId }).lean(),
    ]);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(outbox.completedAt).toEqual(settleTime);
    expect(anchor.anchoredAt).toEqual(settleTime);
    expect(anchor.reconciledAt).toEqual(settleTime);
  });

  test('rolls back the ANCHOR update when the guarded SENT transition cannot commit', async () => {
    const idRecordId = new mongoose.Types.ObjectId();
    const queued = await queueOperation({ idRecordId, recordRef: 'PWD-OWNER-LOSS', nextAttempt: now });
    const execution = deferred();
    const client = fabricClient({ executeChainCommand: jest.fn(() => execution.promise) });

    const run = runChainOutboxOnce({ owner: 'original-owner', now, fabricClient: client });
    await waitForCall(client.executeChainCommand);
    await ChainOutbox.updateOne(
      { _id: queued._id, state: 'PROCESSING' },
      { $set: { lockOwner: 'replacement-owner' } }
    );
    execution.resolve({
      txId: 'tx-owner-loss',
      blockNumber: 99,
      ledgerEpoch: 'owner-loss-epoch',
      reconciled: false,
    });
    await run;

    expect(await BlockchainAnchor.countDocuments({ idRecordId })).toBe(0);
    expect(await ChainOutbox.findById(queued._id).lean()).toMatchObject({
      state: 'PROCESSING',
      lockOwner: 'replacement-owner',
    });
  });

  test('guards a failure transition when lease ownership changes during execution', async () => {
    const queued = await queueOperation({ nextAttempt: now });
    const execution = deferred();
    const client = fabricClient({ executeChainCommand: jest.fn(() => execution.promise) });

    const run = runChainOutboxOnce({ owner: 'failure-owner', now, fabricClient: client });
    await waitForCall(client.executeChainCommand);
    await ChainOutbox.updateOne(
      { _id: queued._id, state: 'PROCESSING' },
      { $set: { lockOwner: 'replacement-owner' } }
    );
    execution.reject(new Error('late failure'));
    await run;

    expect(await ChainOutbox.findById(queued._id).lean()).toMatchObject({
      state: 'PROCESSING',
      lockOwner: 'replacement-owner',
      attempts: 0,
    });
  });

  test('processOperationById and the background scan share one atomic claim path', async () => {
    const queued = await queueOperation({ nextAttempt: now });
    const client = fabricClient();

    await Promise.all([
      processOperationById(queued.operationId, {
        owner: 'manual-owner', now, fabricClient: client, leaseMs: 12_000,
      }),
      runChainOutboxOnce({
        owner: 'background-owner', now, fabricClient: client, leaseMs: 12_000,
      }),
    ]);

    expect(client.executeChainCommand).toHaveBeenCalledTimes(1);
    expect((await ChainOutbox.findById(queued._id)).state).toBe('SENT');
  });

  test.each(['', '   ', null])('requires a non-empty lease owner: %p', async (owner) => {
    await expect(runChainOutboxOnce({ owner, now, fabricClient: fabricClient() }))
      .rejects.toThrow('owner');
  });
});
