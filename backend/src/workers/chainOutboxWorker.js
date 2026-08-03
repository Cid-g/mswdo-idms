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

async function executeClaimed(outbox, { owner, now, fabricClient }) {
  let receipt;
  try {
    receipt = await fabricClient.executeChainCommand(outbox);
  } catch (error) {
    const updated = await chainOutbox.failOperation(outbox, { owner, now, error });
    return { processed: updated, state: updated ? 'RETRY_SCHEDULED' : 'OWNER_LOST' };
  }

  try {
    await chainOutbox.completeOperation(outbox, { owner, now, receipt });
    return { processed: true, state: 'SENT' };
  } catch (error) {
    return { processed: false, state: 'PERSISTENCE_FAILED', error };
  }
}

async function processOnce({
  owner,
  now = new Date(),
  fabricClient = defaultFabricClient,
  leaseMs = chainOutbox.DEFAULT_LEASE_MS,
  operationId,
}) {
  requireOwner(owner);
  const claimTime = now instanceof Date ? now : new Date(now);

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
    now: claimTime,
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

function startChainOutboxWorker({ intervalMs = 30_000 } = {}) {
  if (timer) return timer;

  const tick = () => {
    if (inFlightTick) return;
    const running = runChainOutboxOnce({ owner: schedulerOwner })
      .catch(() => {})
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
