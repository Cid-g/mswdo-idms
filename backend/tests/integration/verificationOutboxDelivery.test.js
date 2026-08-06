'use strict';

const mongoose = require('mongoose');

const db = require('../dbHelpers');
const VerifyOutbox = require('../../src/models/VerifyOutbox');
const { digestVerificationPayload } = require('../../src/lib/verificationPayload');
const {
  DEFAULT_LEASE_MS,
  claimNextOperation,
  completeOperation,
  failOperation,
  recoverExpiredLeases,
  retryDelayMs,
} = require('../../src/services/verificationOutboxDelivery');

beforeAll(async () => {
  await db.connect();
  await VerifyOutbox.syncIndexes();
});
afterAll(async () => { await db.disconnect(); });
afterEach(async () => { await db.clear(); });

const NOW = new Date('2026-08-06T04:00:00.000Z');

function payload(overrides = {}) {
  return {
    anchoredAt: null,
    anchoredHash: null,
    blockNumber: null,
    expiryDate: '2031-08-05',
    idNumber: 'PWD-2026-0000300',
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
  const recordPayload = overrides.payload ?? payload();
  const idRecordId = overrides.idRecordId ?? new mongoose.Types.ObjectId();
  const tokenHash = overrides.tokenHash ?? 'a'.repeat(64);
  const epoch = overrides.epoch ?? 1;
  const revision = overrides.revision ?? 1;
  return {
    operationId: overrides.operationId ?? `verify:test:${idRecordId}:${epoch}:${revision}`,
    idRecordId,
    tokenHash,
    payload: recordPayload,
    payloadDigest: overrides.payloadDigest ?? digestVerificationPayload(recordPayload),
    epoch,
    revision,
    nextAttempt: overrides.nextAttempt ?? NOW,
    ...overrides,
  };
}

async function createOperation(overrides = {}) {
  return VerifyOutbox.create(operation(overrides));
}

describe('verification outbox delivery state machine', () => {
  test('two workers racing for one row claim it exactly once', async () => {
    await createOperation();

    const [first, second] = await Promise.all([
      claimNextOperation({ owner: 'worker-a', now: NOW }),
      claimNextOperation({ owner: 'worker-b', now: NOW }),
    ]);

    const claimed = [first, second].filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].state).toBe('PROCESSING');
    expect(['worker-a', 'worker-b']).toContain(claimed[0].lockOwner);
    expect((await VerifyOutbox.findOne()).attempts).toBe(0);
  });

  test('recovers an expired lease without consuming a delivery attempt', async () => {
    const row = await createOperation({
      state: 'PROCESSING',
      attempts: 3,
      lockOwner: 'dead-worker',
      lockedUntil: new Date(NOW.getTime() - 1),
    });

    expect(await recoverExpiredLeases(NOW)).toBe(1);
    const recovered = await VerifyOutbox.findById(row._id).lean();
    expect(recovered).toMatchObject({ state: 'PENDING', attempts: 3 });
    expect(recovered.nextAttempt).toEqual(NOW);
    expect(recovered).not.toHaveProperty('lockOwner');
    expect(recovered).not.toHaveProperty('lockedUntil');
  });

  test('blocks a later token revision while allowing an unrelated token to progress', async () => {
    const tokenA = 'a'.repeat(64);
    const tokenB = 'b'.repeat(64);
    await createOperation({ tokenHash: tokenA, revision: 1, state: 'FAILED' });
    await createOperation({ tokenHash: tokenA, revision: 2 });
    const unrelated = await createOperation({ tokenHash: tokenB, revision: 1 });

    const claimed = await claimNextOperation({ owner: 'worker-a', now: NOW });

    expect(claimed._id.toString()).toBe(unrelated._id.toString());
    expect((await VerifyOutbox.findOne({ tokenHash: tokenA, revision: 2 })).state)
      .toBe('PENDING');
  });

  test('unblocks the next token revision only after its predecessor is SENT', async () => {
    const tokenHash = 'c'.repeat(64);
    const first = await createOperation({ tokenHash, revision: 1 });
    const second = await createOperation({ tokenHash, revision: 2 });

    const claimedFirst = await claimNextOperation({ owner: 'worker-a', now: NOW });
    expect(claimedFirst._id.toString()).toBe(first._id.toString());
    expect(await claimNextOperation({ owner: 'worker-b', now: NOW })).toBeNull();

    expect(await completeOperation(claimedFirst, { owner: 'worker-a', now: NOW })).toBe(true);
    const claimedSecond = await claimNextOperation({ owner: 'worker-b', now: NOW });
    expect(claimedSecond._id.toString()).toBe(second._id.toString());
  });

  test('orders different epochs before allowing a newer epoch to send', async () => {
    const tokenHash = 'd'.repeat(64);
    const oldEpoch = await createOperation({ tokenHash, epoch: 1, revision: 9 });
    await createOperation({ tokenHash, epoch: 2, revision: 1 });

    const claimed = await claimNextOperation({ owner: 'worker-a', now: NOW });
    expect(claimed._id.toString()).toBe(oldEpoch._id.toString());
  });

  test('completes only for the current lease owner and clears local failure metadata', async () => {
    const row = await createOperation({
      state: 'PROCESSING',
      lockOwner: 'worker-a',
      lockedUntil: new Date(NOW.getTime() + DEFAULT_LEASE_MS),
      lastError: 'code=VERIFY_SYNC_TIMEOUT',
    });

    expect(await completeOperation(row, { owner: 'worker-b', now: NOW })).toBe(false);
    expect(await completeOperation(row, { owner: 'worker-a', now: NOW })).toBe(true);

    const sent = await VerifyOutbox.findById(row._id).lean();
    expect(sent.state).toBe('SENT');
    expect(sent.nextAttempt).toEqual(NOW);
    expect(sent).not.toHaveProperty('lockOwner');
    expect(sent).not.toHaveProperty('lockedUntil');
    expect(sent).not.toHaveProperty('lastError');
  });

  test('schedules retryable failures with capped backoff and stores no remote message', async () => {
    const row = await createOperation({
      state: 'PROCESSING',
      attempts: 4,
      lockOwner: 'worker-a',
      lockedUntil: new Date(NOW.getTime() + DEFAULT_LEASE_MS),
    });
    const error = Object.assign(new Error('mongodb://secret-user:secret-pass@cloud'), {
      code: 'VERIFY_SYNC_UNAVAILABLE',
      retryable: true,
      status: 503,
    });

    expect(await failOperation(row, { owner: 'worker-a', now: NOW, error })).toBe(true);
    const failed = await VerifyOutbox.findById(row._id).lean();
    expect(failed.state).toBe('PENDING');
    expect(failed.attempts).toBe(5);
    expect(failed.nextAttempt).toEqual(new Date(NOW.getTime() + retryDelayMs(5)));
    expect(failed.lastError).toBe('code=VERIFY_SYNC_UNAVAILABLE status=503');
    expect(JSON.stringify(failed)).not.toContain('secret-pass');
  });

  test('marks a non-retryable rejection FAILED and blocks newer revisions', async () => {
    const tokenHash = 'e'.repeat(64);
    const row = await createOperation({
      tokenHash,
      revision: 1,
      state: 'PROCESSING',
      lockOwner: 'worker-a',
      lockedUntil: new Date(NOW.getTime() + DEFAULT_LEASE_MS),
    });
    await createOperation({ tokenHash, revision: 2 });
    const error = Object.assign(new Error('untrusted remote detail'), {
      code: 'VERIFY_SYNC_REJECTED',
      remoteCode: 'EQUAL_REVISION_DIGEST_CONFLICT',
      retryable: false,
      status: 409,
    });

    expect(await failOperation(row, { owner: 'worker-a', now: NOW, error })).toBe(true);
    const failed = await VerifyOutbox.findById(row._id).lean();
    expect(failed).toMatchObject({ state: 'FAILED', attempts: 1 });
    expect(failed.lastError).toBe(
      'code=VERIFY_SYNC_REJECTED remoteCode=EQUAL_REVISION_DIGEST_CONFLICT status=409'
    );
    expect(await claimNextOperation({ owner: 'worker-b', now: NOW })).toBeNull();
  });

  test('a targeted claim does not bypass an unsent predecessor', async () => {
    const tokenHash = 'f'.repeat(64);
    await createOperation({ tokenHash, revision: 1, state: 'FAILED' });
    const second = await createOperation({ tokenHash, revision: 2 });

    await expect(claimNextOperation({
      owner: 'worker-a',
      now: NOW,
      operationId: second.operationId,
    })).resolves.toBeNull();
  });
});
