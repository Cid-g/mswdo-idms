'use strict';

const { randomUUID } = require('node:crypto');
const os = require('node:os');

const chainOutbox = require('../services/chainOutbox');
const { ensureFabricConnected } = require('../fabric/connect');
const { executeChainCommand } = require('../services/blockchain');

const defaultFabricClient = { ensureFabricConnected, executeChainCommand };
const schedulerOwner = `${os.hostname()}:${process.pid}:${randomUUID()}`;

let timer = null;
let inFlightTick = null;

function systemClock() {
  return new Date();
}

function requireOwner(owner) {
  if (typeof owner !== 'string' || owner.trim() === '') {
    throw new TypeError('Chain outbox worker owner must be a non-empty string');
  }
}

async function prepareForClaim({ now, fabricClient }) {
  await chainOutbox.recoverExpiredLeases(now);
  await chainOutbox.reevaluateBlockedOperations(now);

  try {
    const availability = await fabricClient.ensureFabricConnected();
    return availability?.available === true;
  } catch (_) {
    return false;
  }
}

function isInfrastructureError(error) {
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    const code = current.code;
    const normalized = typeof code === 'string' ? code.toUpperCase() : code;
    if (
      normalized === 'FABRIC_DISABLED'
      || normalized === 'FABRIC_CONNECTION_SUPERSEDED'
      || normalized === 'UNAVAILABLE'
      || normalized === 'DEADLINE_EXCEEDED'
      || normalized === 14
      || normalized === 4
      || normalized === '14'
      || normalized === '4'
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

function timeFrom(clock) {
  const value = clock();
  return value instanceof Date ? value : new Date(value);
}

async function executeClaimed(outbox, { owner, clock, fabricClient }) {
  let receipt;
  try {
    receipt = await fabricClient.executeChainCommand(outbox);
  } catch (error) {
    const settledAt = timeFrom(clock);
    if (isInfrastructureError(error)) {
      const released = await chainOutbox.releaseOperation(outbox, {
        owner,
        now: settledAt,
      });
      return {
        processed: false,
        state: released ? 'FABRIC_UNAVAILABLE' : 'OWNER_LOST',
      };
    }
    const updated = await chainOutbox.failOperation(outbox, {
      owner,
      now: settledAt,
      error,
    });
    return { processed: updated, state: updated ? 'RETRY_SCHEDULED' : 'OWNER_LOST' };
  }

  const settledAt = timeFrom(clock);
  try {
    await chainOutbox.completeOperation(outbox, { owner, now: settledAt, receipt });
    return { processed: true, state: 'SENT' };
  } catch (error) {
    return { processed: false, state: 'PERSISTENCE_FAILED', error };
  }
}

async function processOnce({
  owner,
  now,
  clock = systemClock,
  fabricClient = defaultFabricClient,
  leaseMs = chainOutbox.DEFAULT_LEASE_MS,
  operationId,
}) {
  requireOwner(owner);
  const claimTime = now === undefined
    ? timeFrom(clock)
    : (now instanceof Date ? now : new Date(now));

  const available = await prepareForClaim({ now: claimTime, fabricClient });
  if (!available) return { processed: false, state: 'FABRIC_UNAVAILABLE' };

  const claimed = await chainOutbox.claimNextOperation({
    owner,
    now: claimTime,
    leaseMs,
    operationId,
  });
  if (!claimed) return { processed: false, state: 'NO_ELIGIBLE_OPERATION' };

  return executeClaimed(claimed, {
    owner,
    clock,
    fabricClient,
  });
}

function runChainOutboxOnce(options) {
  return processOnce(options);
}

function processOperationById(operationId, options) {
  if (typeof operationId !== 'string' || operationId.trim() === '') {
    throw new TypeError('Chain outbox operationId must be a non-empty string');
  }
  return processOnce({ ...options, operationId });
}

function defaultErrorReporter(error, context) {
  console.error('Chain outbox worker error', context, error);
}

function reportError(errorReporter, error, context) {
  try {
    errorReporter(error, context);
  } catch (_) {
    // Reporter failures must not escape a background tick.
  }
}

function startChainOutboxWorker({
  intervalMs = 30_000,
  errorReporter = defaultErrorReporter,
} = {}) {
  if (timer) return timer;

  const tick = () => {
    if (inFlightTick) return;
    const running = runChainOutboxOnce({ owner: schedulerOwner })
      .then((result) => {
        if (result.state === 'PERSISTENCE_FAILED') {
          reportError(errorReporter, result.error, { state: result.state });
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

async function stopChainOutboxWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const running = inFlightTick;
  if (running) await running;
}

module.exports = {
  processOperationById,
  runChainOutboxOnce,
  startChainOutboxWorker,
  stopChainOutboxWorker,
};
