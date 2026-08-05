'use strict';

const mongoose = require('mongoose');

const db = require('../dbHelpers');
const IDRecord = require('../../src/models/IDRecord');
const VerifyOutbox = require('../../src/models/VerifyOutbox');
const { withMongoTransaction } = require('../../src/lib/transactions');
const {
  enqueueVerificationSync,
  hashQrToken,
  immutablePayloadSnapshot,
  verificationOperationIdFor,
} = require('../../src/services/verifyOutbox');

beforeAll(async () => {
  await db.connect();
  await Promise.all([
    IDRecord.syncIndexes(),
    VerifyOutbox.syncIndexes(),
  ]);
});
afterAll(async () => { await db.disconnect(); });
afterEach(async () => { await db.clear(); });

function payload(overrides = {}) {
  return {
    anchoredAt: null,
    anchoredHash: null,
    blockNumber: null,
    expiryDate: '2031-08-05',
    idNumber: 'PWD-2026-0000200',
    idType: 'PWD',
    issuedDate: '2026-08-05',
    maskedName: 'S****, M****',
    releasedAt: null,
    status: 'ACTIVE',
    txId: null,
    ...overrides,
  };
}

async function createRecord(overrides = {}) {
  const suffix = new mongoose.Types.ObjectId().toString();
  return IDRecord.create({
    applicantId: new mongoose.Types.ObjectId(),
    department: 'PWD',
    idNumber: `PWD-${suffix}`,
    qrToken: `49feec7e-90f5-420a-be3e-${suffix.slice(-12)}`,
    issuedDate: new Date('2026-08-05T00:00:00.000Z'),
    expiryDate: new Date('2031-08-05T00:00:00.000Z'),
    status: 'ACTIVE',
    ...overrides,
  });
}

function command(record, overrides = {}) {
  const event = overrides.event ?? 'ISSUE';
  return {
    operationId: overrides.operationId
      ?? verificationOperationIdFor(event, record._id, overrides.qualifier),
    idRecordId: record._id,
    payload: overrides.payload ?? payload({
      idNumber: record.idNumber,
      idType: record.department,
    }),
    epoch: overrides.epoch ?? 1,
  };
}

describe('verification synchronization enqueue', () => {
  test('builds deterministic event identities and rejects unsafe identity parts', () => {
    const id = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');

    expect(verificationOperationIdFor('ISSUE', id))
      .toBe(`verify:issue:${id}`);
    expect(verificationOperationIdFor('REGENERATE', id, 'token-2'))
      .toBe(`verify:regenerate:${id}:token-2`);
    expect(() => verificationOperationIdFor('bad event', id)).toThrow('event is invalid');
    expect(() => verificationOperationIdFor('ISSUE', id, 'raw token value'))
      .toThrow('qualifier is invalid');
  });

  test('hashes the exact local QR token without retaining the raw value', async () => {
    const record = await createRecord();
    const rawToken = record.qrToken;

    const queued = await withMongoTransaction((session) => enqueueVerificationSync({
      session,
      ...command(record),
    }));
    const stored = await VerifyOutbox.findById(queued._id).lean();

    expect(stored.tokenHash).toBe(hashQrToken(rawToken));
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(rawToken);
    expect(stored).not.toHaveProperty('qrToken');
    expect(stored.payload).not.toHaveProperty('qrToken');
  });

  test('requires an active MongoDB transaction', async () => {
    const record = await createRecord();
    const session = await mongoose.startSession();

    try {
      await expect(enqueueVerificationSync({
        session,
        ...command(record),
      })).rejects.toThrow('active MongoDB transaction');
    } finally {
      await session.endSession();
    }

    expect(await VerifyOutbox.countDocuments()).toBe(0);
    expect((await IDRecord.findById(record._id)).verifyRevision).toBe(0);
  });

  test('captures an immutable minimized payload and allocates revision one', async () => {
    const record = await createRecord();
    const sourcePayload = command(record).payload;

    const queued = await withMongoTransaction((session) => enqueueVerificationSync({
      session,
      ...command(record, { payload: sourcePayload }),
    }));

    sourcePayload.maskedName = 'CHANGED AFTER ENQUEUE';
    const stored = await VerifyOutbox.findById(queued._id).lean();
    const persistedRecord = await IDRecord.findById(record._id).lean();

    expect(stored.revision).toBe(1);
    expect(stored.epoch).toBe(1);
    expect(stored.payload.maskedName).toBe('S****, M****');
    expect(stored.state).toBe('PENDING');
    expect(persistedRecord.verifyRevision).toBe(1);
    expect(Object.isFrozen(immutablePayloadSnapshot(payload()))).toBe(true);
  });

  test('returns one command and consumes one revision for an exact duplicate', async () => {
    const record = await createRecord();
    const sameCommand = command(record);
    let first;
    let duplicate;

    await withMongoTransaction(async (session) => {
      first = await enqueueVerificationSync({ session, ...sameCommand });
      duplicate = await enqueueVerificationSync({ session, ...sameCommand });
    });

    expect(duplicate._id.toString()).toBe(first._id.toString());
    expect(await VerifyOutbox.countDocuments()).toBe(1);
    expect((await IDRecord.findById(record._id)).verifyRevision).toBe(1);
  });

  test('rejects an operation ID collision without consuming another revision', async () => {
    const record = await createRecord();
    const operationId = verificationOperationIdFor('ISSUE', record._id);

    await withMongoTransaction((session) => enqueueVerificationSync({
      session,
      ...command(record, { operationId }),
    }));

    await expect(withMongoTransaction((session) => enqueueVerificationSync({
      session,
      ...command(record, {
        operationId,
        payload: payload({
          idNumber: record.idNumber,
          maskedName: 'D****, P****',
        }),
      }),
    }))).rejects.toMatchObject({ code: 'VERIFY_OPERATION_ID_COLLISION' });

    expect(await VerifyOutbox.countDocuments()).toBe(1);
    expect((await IDRecord.findById(record._id)).verifyRevision).toBe(1);
  });

  test('allocates strictly increasing revisions for different events', async () => {
    const record = await createRecord();
    let issued;
    let released;

    await withMongoTransaction(async (session) => {
      issued = await enqueueVerificationSync({
        session,
        ...command(record, { event: 'ISSUE' }),
      });
      released = await enqueueVerificationSync({
        session,
        ...command(record, {
          event: 'RELEASE',
          payload: payload({
            idNumber: record.idNumber,
            releasedAt: '2026-08-06T01:00:00.000Z',
          }),
        }),
      });
    });

    expect([issued.revision, released.revision]).toEqual([1, 2]);
    expect((await IDRecord.findById(record._id)).verifyRevision).toBe(2);
  });

  test('rolls back caller business state and revision when enqueue validation fails', async () => {
    const record = await createRecord();

    await expect(withMongoTransaction(async (session) => {
      await IDRecord.updateOne(
        { _id: record._id },
        { $set: { status: 'REVOKED' } },
        { session }
      );
      await enqueueVerificationSync({
        session,
        ...command(record, { operationId: ' '.repeat(2) }),
      });
    })).rejects.toThrow('operationId is invalid');

    const persisted = await IDRecord.findById(record._id).lean();
    expect(persisted.status).toBe('ACTIVE');
    expect(persisted.verifyRevision).toBe(0);
    expect(await VerifyOutbox.countDocuments()).toBe(0);
  });

  test('converges concurrent identical commands from independent transactions', async () => {
    const record = await createRecord();
    const sameCommand = command(record);

    const [first, duplicate] = await Promise.all([
      withMongoTransaction((session) => enqueueVerificationSync({ session, ...sameCommand })),
      withMongoTransaction((session) => enqueueVerificationSync({ session, ...sameCommand })),
    ]);

    expect(duplicate._id.toString()).toBe(first._id.toString());
    expect(await VerifyOutbox.countDocuments()).toBe(1);
    expect((await IDRecord.findById(record._id)).verifyRevision).toBe(1);
  });

  test('rejects a concurrent operation ID collision from independent transactions', async () => {
    const record = await createRecord();
    const operationId = verificationOperationIdFor('ISSUE', record._id);
    const firstCommand = command(record, { operationId });
    const conflictingCommand = command(record, {
      operationId,
      payload: payload({
        idNumber: record.idNumber,
        maskedName: 'C****, R****',
      }),
    });

    const results = await Promise.allSettled([
      withMongoTransaction((session) => enqueueVerificationSync({
        session,
        ...firstCommand,
      })),
      withMongoTransaction((session) => enqueueVerificationSync({
        session,
        ...conflictingCommand,
      })),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'VERIFY_OPERATION_ID_COLLISION' });
    expect(await VerifyOutbox.countDocuments()).toBe(1);
    expect((await IDRecord.findById(record._id)).verifyRevision).toBe(1);
  });

  test('rejects a reused operation ID after the record QR token changes', async () => {
    const record = await createRecord();
    const sameCommand = command(record);

    await withMongoTransaction((session) => enqueueVerificationSync({
      session,
      ...sameCommand,
    }));
    await IDRecord.updateOne(
      { _id: record._id },
      { $set: { qrToken: '49feec7e-90f5-420a-be3e-000000000999' } }
    );

    await expect(withMongoTransaction((session) => enqueueVerificationSync({
      session,
      ...sameCommand,
    }))).rejects.toMatchObject({ code: 'VERIFY_OPERATION_ID_COLLISION' });

    expect(await VerifyOutbox.countDocuments()).toBe(1);
    expect((await IDRecord.findById(record._id)).verifyRevision).toBe(1);
  });

  test('does not allocate a revision for a missing ID record', async () => {
    const idRecordId = new mongoose.Types.ObjectId();

    await expect(withMongoTransaction((session) => enqueueVerificationSync({
      session,
      operationId: verificationOperationIdFor('ISSUE', idRecordId),
      idRecordId,
      payload: payload(),
      epoch: 1,
    }))).rejects.toMatchObject({ code: 'VERIFY_ID_RECORD_NOT_FOUND' });

    expect(await VerifyOutbox.countDocuments()).toBe(0);
  });
});
