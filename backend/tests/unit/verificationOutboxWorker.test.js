'use strict';

jest.mock('../../src/services/verificationOutboxDelivery', () => ({
  DEFAULT_LEASE_MS: 120_000,
  claimNextOperation: jest.fn(),
  completeOperation: jest.fn(),
  failOperation: jest.fn(),
  recoverExpiredLeases: jest.fn(),
}));

const delivery = require('../../src/services/verificationOutboxDelivery');
const {
  processVerificationOperationById,
  runVerificationOutboxOnce,
  startVerificationOutboxWorker,
  stopVerificationOutboxWorker,
} = require('../../src/workers/verificationOutboxWorker');

const CLAIM_TIME = new Date('2026-08-06T04:00:00.000Z');
const SETTLE_TIME = new Date('2026-08-06T04:00:03.000Z');

function claimed(overrides = {}) {
  return {
    _id: 'outbox-1',
    operationId: 'verify:issue:507f1f77bcf86cd799439011',
    tokenHash: 'a'.repeat(64),
    epoch: 1,
    revision: 1,
    attempts: 0,
    ...overrides,
  };
}

function clockSequence(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

describe('verification outbox worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delivery.recoverExpiredLeases.mockResolvedValue(0);
  });

  afterEach(async () => {
    await stopVerificationOutboxWorker();
    jest.useRealTimers();
  });

  test('returns NO_ELIGIBLE_OPERATION without calling the network', async () => {
    delivery.claimNextOperation.mockResolvedValue(null);
    const syncClient = { sendRecord: jest.fn() };

    await expect(runVerificationOutboxOnce({
      owner: 'worker-a',
      now: CLAIM_TIME,
      clock: () => SETTLE_TIME,
      syncClient,
    })).resolves.toEqual({ processed: false, state: 'NO_ELIGIBLE_OPERATION' });

    expect(delivery.recoverExpiredLeases).toHaveBeenCalledWith(CLAIM_TIME);
    expect(syncClient.sendRecord).not.toHaveBeenCalled();
  });

  test('marks SENT only after a matching client acknowledgement succeeds', async () => {
    const row = claimed();
    const acknowledgement = {
      applied: true,
      epoch: 1,
      outcome: 'INSERTED',
      payloadDigest: 'b'.repeat(64),
      revision: 1,
    };
    delivery.claimNextOperation.mockResolvedValue(row);
    delivery.completeOperation.mockResolvedValue(true);
    const syncClient = { sendRecord: jest.fn().mockResolvedValue(acknowledgement) };

    const result = await runVerificationOutboxOnce({
      owner: 'worker-a',
      now: CLAIM_TIME,
      clock: () => SETTLE_TIME,
      syncClient,
    });

    expect(syncClient.sendRecord).toHaveBeenCalledWith(row);
    expect(delivery.completeOperation).toHaveBeenCalledWith(row, {
      owner: 'worker-a',
      now: SETTLE_TIME,
    });
    expect(result).toEqual({ acknowledgement, processed: true, state: 'SENT' });
    expect(delivery.failOperation).not.toHaveBeenCalled();
  });

  test.each([
    [true, 'RETRY_SCHEDULED'],
    [false, 'FAILED'],
  ])('classifies client failure retryable=%s as %s', async (retryable, expectedState) => {
    const row = claimed();
    const error = Object.assign(new Error('safe client error'), {
      code: 'VERIFY_SYNC_REJECTED',
      retryable,
    });
    delivery.claimNextOperation.mockResolvedValue(row);
    delivery.failOperation.mockResolvedValue(true);
    const syncClient = { sendRecord: jest.fn().mockRejectedValue(error) };

    const result = await runVerificationOutboxOnce({
      owner: 'worker-a',
      now: CLAIM_TIME,
      clock: () => SETTLE_TIME,
      syncClient,
    });

    expect(delivery.failOperation).toHaveBeenCalledWith(row, {
      owner: 'worker-a',
      now: SETTLE_TIME,
      error,
    });
    expect(result).toEqual({ error, processed: true, state: expectedState });
  });

  test('reports OWNER_LOST when the guarded completion cannot update the row', async () => {
    const row = claimed();
    delivery.claimNextOperation.mockResolvedValue(row);
    delivery.completeOperation.mockResolvedValue(false);
    const syncClient = { sendRecord: jest.fn().mockResolvedValue({ outcome: 'IDEMPOTENT' }) };

    await expect(runVerificationOutboxOnce({
      owner: 'worker-a',
      now: CLAIM_TIME,
      clock: () => SETTLE_TIME,
      syncClient,
    })).resolves.toMatchObject({ processed: false, state: 'OWNER_LOST' });
  });

  test('targeted processing uses the same atomic claim path', async () => {
    delivery.claimNextOperation.mockResolvedValue(null);
    const syncClient = { sendRecord: jest.fn() };

    await processVerificationOperationById('verify:issue:record', {
      owner: 'worker-a',
      now: CLAIM_TIME,
      clock: () => SETTLE_TIME,
      syncClient,
    });

    expect(delivery.claimNextOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'verify:issue:record',
      owner: 'worker-a',
    }));
  });

  test('scheduler prevents overlapping ticks and stop waits for the active delivery', async () => {
    jest.useFakeTimers();
    let resolveSend;
    const sendPromise = new Promise((resolve) => { resolveSend = resolve; });
    delivery.claimNextOperation.mockResolvedValue(claimed());
    delivery.completeOperation.mockResolvedValue(true);
    const syncClient = { sendRecord: jest.fn(() => sendPromise) };

    startVerificationOutboxWorker({ syncClient, intervalMs: 1_000 });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(syncClient.sendRecord).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5_000);
    expect(syncClient.sendRecord).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = stopVerificationOutboxWorker().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(jest.getTimerCount()).toBe(0);

    resolveSend({ outcome: 'INSERTED' });
    await stopping;
    expect(stopped).toBe(true);
  });

  test('validates owner, client, and operation identity before processing', async () => {
    await expect(runVerificationOutboxOnce({
      owner: '',
      syncClient: { sendRecord: jest.fn() },
    })).rejects.toThrow('owner');
    await expect(runVerificationOutboxOnce({ owner: 'worker-a' }))
      .rejects.toThrow('sync client');
    expect(() => processVerificationOperationById('', {
      owner: 'worker-a',
      syncClient: { sendRecord: jest.fn() },
    })).toThrow('operationId');
  });
});
