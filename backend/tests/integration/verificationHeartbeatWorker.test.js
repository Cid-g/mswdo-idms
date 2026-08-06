'use strict';

const mongoose = require('mongoose');

const db = require('../dbHelpers');
const JobLease = require('../../src/models/JobLease');
const VerifyOutbox = require('../../src/models/VerifyOutbox');
const { digestVerificationPayload } = require('../../src/lib/verificationPayload');
const {
  JOB_NAME,
  runVerificationHeartbeatOnce,
  startVerificationHeartbeatWorker,
  stopVerificationHeartbeatWorker,
} = require('../../src/workers/verificationHeartbeatWorker');

const NOW = new Date('2026-08-06T07:00:00.000Z');

beforeAll(async () => {
  await db.connect();
  await Promise.all([
    JobLease.syncIndexes(),
    VerifyOutbox.syncIndexes(),
  ]);
});
afterAll(async () => {
  const stopping = stopVerificationHeartbeatWorker();
  jest.useRealTimers();
  await stopping;
  await db.disconnect();
});
afterEach(async () => {
  // Restore real timers before any Mongoose cleanup. MongoDB drivers depend on
  // real timer progression, so clearing the database while modern Jest fake
  // timers are still active can deadlock the hook even after the worker stops.
  const stopping = stopVerificationHeartbeatWorker();
  jest.useRealTimers();
  await stopping;
  await db.clear();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function payload(overrides = {}) {
  return {
    anchoredAt: null,
    anchoredHash: null,
    blockNumber: null,
    expiryDate: '2031-08-05',
    idNumber: 'PWD-2026-0000400',
    idType: 'PWD',
    issuedDate: '2026-08-05',
    maskedName: 'S****, M****',
    releasedAt: null,
    status: 'ACTIVE',
    txId: null,
    ...overrides,
  };
}

async function createOperation(overrides = {}) {
  const recordPayload = overrides.payload ?? payload();
  const idRecordId = overrides.idRecordId ?? new mongoose.Types.ObjectId();
  const epoch = overrides.epoch ?? 1;
  const revision = overrides.revision ?? 1;
  return VerifyOutbox.create({
    operationId: overrides.operationId ?? `verify:heartbeat-test:${idRecordId}:${epoch}:${revision}`,
    idRecordId,
    tokenHash: overrides.tokenHash ?? 'a'.repeat(64),
    payload: recordPayload,
    payloadDigest: overrides.payloadDigest ?? digestVerificationPayload(recordPayload),
    epoch,
    revision,
    nextAttempt: overrides.nextAttempt ?? NOW,
    ...overrides,
  });
}

function acknowledgement(sourceLastHealthyAt = NOW.getTime()) {
  return {
    applied: true,
    epoch: 1,
    outcome: 'UPDATED',
    sourceLastHealthyAt: new Date(sourceLastHealthyAt).toISOString(),
  };
}

describe('signed source-health heartbeat', () => {
  test('sends the exact captured health instant only when the queue is drained', async () => {
    const syncClient = {
      sendHealth: jest.fn(async ({ sourceLastHealthyAt }) => acknowledgement(sourceLastHealthyAt)),
    };

    const result = await runVerificationHeartbeatOnce({
      epoch: 1,
      now: NOW,
      owner: 'heartbeat-a',
      syncClient,
    });

    expect(result).toMatchObject({ acquired: true, sent: true, state: 'SENT' });
    expect(syncClient.sendHealth).toHaveBeenCalledWith({
      epoch: 1,
      sourceLastHealthyAt: NOW.getTime(),
    });
    expect(await JobLease.findOne({ name: JOB_NAME }).lean()).toMatchObject({
      lockOwner: null,
      lockedUntil: NOW,
    });
  });

  test.each(['PENDING', 'PROCESSING', 'FAILED'])(
    'suppresses health while a %s verification row is undelivered',
    async (state) => {
      await createOperation({
        state,
        ...(state === 'PROCESSING' ? {
          lockOwner: 'sender',
          lockedUntil: new Date(NOW.getTime() + 60_000),
        } : {}),
      });
      const syncClient = { sendHealth: jest.fn() };

      await expect(runVerificationHeartbeatOnce({
        epoch: 1,
        now: NOW,
        owner: `heartbeat-${state.toLowerCase()}`,
        syncClient,
      })).resolves.toEqual({
        acquired: true,
        sent: false,
        state: 'QUEUE_NOT_DRAINED',
      });
      expect(syncClient.sendHealth).not.toHaveBeenCalled();
    }
  );

  test('SENT verification history does not block a current heartbeat', async () => {
    await createOperation({ state: 'SENT' });
    const syncClient = { sendHealth: jest.fn(async () => acknowledgement()) };

    const result = await runVerificationHeartbeatOnce({
      epoch: 1,
      now: NOW,
      owner: 'heartbeat-sent-history',
      syncClient,
    });

    expect(result.state).toBe('SENT');
    expect(syncClient.sendHealth).toHaveBeenCalledTimes(1);
  });

  test('a distributed lease allows only one concurrent heartbeat sender', async () => {
    const entered = deferred();
    const release = deferred();
    const syncClient = {
      sendHealth: jest.fn(async () => {
        entered.resolve();
        await release.promise;
        return acknowledgement();
      }),
    };

    const first = runVerificationHeartbeatOnce({
      epoch: 1,
      now: NOW,
      owner: 'heartbeat-a',
      syncClient,
    });
    await entered.promise;

    await expect(runVerificationHeartbeatOnce({
      epoch: 1,
      now: NOW,
      owner: 'heartbeat-b',
      syncClient,
    })).resolves.toEqual({
      acquired: false,
      sent: false,
      state: 'LEASE_HELD',
    });

    release.resolve();
    await expect(first).resolves.toMatchObject({ state: 'SENT' });
    expect(syncClient.sendHealth).toHaveBeenCalledTimes(1);
  });

  test('transport failure releases the lease so a later heartbeat can recover', async () => {
    const failingClient = {
      sendHealth: jest.fn(async () => {
        const error = new Error('private cloud detail');
        error.code = 'VERIFY_HEALTH_UNAVAILABLE';
        throw error;
      }),
    };

    await expect(runVerificationHeartbeatOnce({
      epoch: 1,
      now: NOW,
      owner: 'heartbeat-failure',
      syncClient: failingClient,
    })).rejects.toMatchObject({ code: 'VERIFY_HEALTH_UNAVAILABLE' });

    const healthyClient = { sendHealth: jest.fn(async () => acknowledgement()) };
    await expect(runVerificationHeartbeatOnce({
      epoch: 1,
      now: new Date(NOW.getTime() + 1),
      owner: 'heartbeat-recovery',
      syncClient: healthyClient,
    })).resolves.toMatchObject({ state: 'SENT' });
  });

  test('the scheduler runs immediately, never overlaps, and stop waits for the active send', async () => {
    jest.useFakeTimers();
    const inFlight = deferred();
    const completed = { acquired: true, sent: true, state: 'SENT' };
    const runOnce = jest.fn(() => inFlight.promise);
    let stopping = null;

    try {
      startVerificationHeartbeatWorker({
        epoch: 1,
        intervalMs: 1_000,
        now: () => NOW,
        onError: jest.fn(),
        owner: 'scheduler-test',
        runOnce,
        syncClient: { sendHealth: jest.fn() },
      });

      // Use synchronous timer advancement while the active tick intentionally
      // awaits an unresolved promise. Async timer helpers wait for that promise
      // and cannot return until the test releases it.
      jest.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
      expect(runOnce).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(3_000);
      await Promise.resolve();
      expect(runOnce).toHaveBeenCalledTimes(1);

      let stopped = false;
      stopping = stopVerificationHeartbeatWorker().then(() => { stopped = true; });
      await Promise.resolve();
      expect(stopped).toBe(false);

      inFlight.resolve(completed);
      await stopping;
      stopping = null;
      expect(stopped).toBe(true);
    } finally {
      // Never leave the module-global worker waiting on the deliberately
      // unresolved test promise. Otherwise an assertion failure is masked by
      // afterEach/afterAll timeouts while they wait for worker shutdown.
      inFlight.resolve(completed);
      if (stopping) await stopping;
      await stopVerificationHeartbeatWorker();
    }
  });
});
