'use strict';

const { randomUUID } = require('node:crypto');
const os = require('node:os');

const delivery = require('../services/verificationOutboxDelivery');

const schedulerOwner = `${os.hostname()}:${process.pid}:${randomUUID()}`;

let timer = null;
let inFlightTick = null;

function systemClock() {
  return new Date();
}

function requireOwner(owner) {
  if (typeof owner !== 'string' || owner.trim() === '' || owner.length > 256) {
    throw new TypeError('Verification outbox worker owner must be a non-empty string.');
  }
}

function requireSyncClient(syncClient) {
  if (!syncClient || typeof syncClient.sendRecord !== 'function') {
    throw new TypeError('Verification outbox worker requires a sync client.');
  }
}

function timeFrom(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Verification outbox worker clock returned an invalid time.');
  }
  return date;
}

async function runVerificationOutboxOnce({
  owner,
  now,
  clock = systemClock,
  syncClient,
  leaseMs = delivery.DEFAULT_LEASE_MS,
  operationId,
}) {
  requireOwner(owner);
  requireSyncClient(syncClient);

  const claimTime = now === undefined
    ? timeFrom(clock)
    : (now instanceof Date ? now : new Date(now));
  if (Number.isNaN(claimTime.getTime())) {
    throw new TypeError('Verification outbox worker now is invalid.');
  }

  await delivery.recoverExpiredLeases(claimTime);
  const claimed = await delivery.claimNextOperation({
    owner,
    now: claimTime,
    leaseMs,
    operationId,
  });
  if (!claimed) return { processed: false, state: 'NO_ELIGIBLE_OPERATION' };

  try {
    const acknowledgement = await syncClient.sendRecord(claimed);
    const completed = await delivery.completeOperation(claimed, {
      owner,
      now: timeFrom(clock),
    });
    return {
      acknowledgement,
      processed: completed,
      state: completed ? 'SENT' : 'OWNER_LOST',
    };
  } catch (error) {
    const updated = await delivery.failOperation(claimed, {
      owner,
      now: timeFrom(clock),
      error,
    });
    return {
      error,
      processed: updated,
      state: updated
        ? (error?.retryable === false ? 'FAILED' : 'RETRY_SCHEDULED')
        : 'OWNER_LOST',
    };
  }
}

function processVerificationOperationById(operationId, options) {
  if (
    typeof operationId !== 'string'
    || operationId.trim() === ''
    || operationId.length > 256
  ) {
    throw new TypeError('Verification operationId must be a non-empty string.');
  }
  return runVerificationOutboxOnce({ ...options, operationId });
}

function defaultErrorReporter(error, context) {
  console.error('Verification outbox worker error', context, error);
}

function reportError(errorReporter, error, context) {
  try {
    errorReporter(error, context);
  } catch (_) {
    // Reporter failures must never escape a background tick.
  }
}

function startVerificationOutboxWorker({
  syncClient,
  intervalMs = 30_000,
  errorReporter = defaultErrorReporter,
} = {}) {
  requireSyncClient(syncClient);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new TypeError('Verification outbox worker intervalMs must be a positive safe integer.');
  }
  if (typeof errorReporter !== 'function') {
    throw new TypeError('Verification outbox worker errorReporter must be a function.');
  }
  if (timer) return timer;

  const tick = () => {
    if (inFlightTick) return;
    const running = runVerificationOutboxOnce({
      owner: schedulerOwner,
      syncClient,
    })
      .then((result) => {
        if (result.state === 'FAILED') {
          reportError(errorReporter, result.error, {
            code: result.error?.code ?? null,
            remoteCode: result.error?.remoteCode ?? null,
            state: result.state,
          });
        }
        return result;
      })
      .catch((error) => {
        reportError(errorReporter, error, { state: 'TICK_REJECTED' });
      })
      .finally(() => {
        if (inFlightTick === running) inFlightTick = null;
      });
    inFlightTick = running;
  };

  timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

async function stopVerificationOutboxWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const running = inFlightTick;
  if (running) await running;
}

module.exports = {
  processVerificationOperationById,
  runVerificationOutboxOnce,
  startVerificationOutboxWorker,
  stopVerificationOutboxWorker,
};
