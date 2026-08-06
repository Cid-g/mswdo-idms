'use strict';

const crypto = require('node:crypto');

const JobLease = require('../models/JobLease');
const VerifyOutbox = require('../models/VerifyOutbox');

const JOB_NAME = 'verification-heartbeat';
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_LEASE_MS = 5 * 60_000;

let startupTimer = null;
let intervalTimer = null;
let inFlightTick = null;
let activeOwner = null;

function requireDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${name} must be a valid Date.`);
  }
}

function requireOwner(owner) {
  if (typeof owner !== 'string' || owner.trim() === '' || owner.length > 256) {
    throw new TypeError('Verification heartbeat owner must be a non-empty string.');
  }
}

function requireEpoch(epoch) {
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    throw new TypeError('Verification heartbeat epoch must be a positive safe integer.');
  }
}

function requireSyncClient(syncClient) {
  if (!syncClient || typeof syncClient.sendHealth !== 'function') {
    throw new TypeError('Verification heartbeat requires a sync client with sendHealth().');
  }
}

async function acquireHeartbeatLease({ owner, now, leaseMs = DEFAULT_LEASE_MS }) {
  requireOwner(owner);
  requireDate(now, 'now');
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 60 * 60_000) {
    throw new TypeError('Verification heartbeat leaseMs must be between 1 and 3600000.');
  }

  const lockedUntil = new Date(now.getTime() + leaseMs);
  try {
    const lease = await JobLease.findOneAndUpdate(
      {
        name: JOB_NAME,
        lockedUntil: { $lte: now },
      },
      {
        $set: { lockOwner: owner, lockedUntil },
        $setOnInsert: { name: JOB_NAME },
      },
      { new: true, upsert: true }
    );
    return lease?.lockOwner === owner;
  } catch (error) {
    // An unexpired lease makes the upsert predicate miss, so MongoDB attempts
    // to insert the same unique job name. The duplicate is the atomic
    // "another sender owns the lease" result.
    if (error?.code === 11000) return false;
    throw error;
  }
}

async function releaseHeartbeatLease({ owner, now }) {
  requireOwner(owner);
  requireDate(now, 'now');
  await JobLease.updateOne(
    { name: JOB_NAME, lockOwner: owner },
    { $set: { lockOwner: null, lockedUntil: now } }
  );
}

async function hasUndeliveredVerificationRows() {
  return Boolean(await VerifyOutbox.exists({ state: { $ne: 'SENT' } }));
}

async function runVerificationHeartbeatOnce({
  owner,
  epoch,
  syncClient,
  now = new Date(),
  leaseMs = DEFAULT_LEASE_MS,
  queueHasUndelivered = hasUndeliveredVerificationRows,
} = {}) {
  requireOwner(owner);
  requireEpoch(epoch);
  requireSyncClient(syncClient);
  requireDate(now, 'now');
  if (typeof queueHasUndelivered !== 'function') {
    throw new TypeError('queueHasUndelivered must be a function.');
  }

  const acquired = await acquireHeartbeatLease({ owner, now, leaseMs });
  if (!acquired) {
    return Object.freeze({ acquired: false, sent: false, state: 'LEASE_HELD' });
  }

  // Capture the signed health instant before inspecting the queue. A business
  // event committed after this instant is newer than the heartbeat and will be
  // delivered by the outbox sender; an event already visible here suppresses
  // the heartbeat so stale ACTIVE data cannot be presented as current.
  const sourceLastHealthyAt = now.getTime();
  try {
    if (await queueHasUndelivered()) {
      return Object.freeze({
        acquired: true,
        sent: false,
        state: 'QUEUE_NOT_DRAINED',
      });
    }

    const acknowledgement = await syncClient.sendHealth({
      epoch,
      sourceLastHealthyAt,
    });
    return Object.freeze({
      acknowledgement,
      acquired: true,
      sent: true,
      state: 'SENT',
    });
  } finally {
    await releaseHeartbeatLease({ owner, now });
  }
}

function defaultOwner() {
  return `verification-heartbeat:${process.pid}:${crypto.randomUUID()}`;
}

function safeErrorContext(error) {
  return Object.freeze({
    code: typeof error?.code === 'string' ? error.code : 'VERIFY_HEARTBEAT_UNKNOWN_FAILURE',
    remoteCode: typeof error?.remoteCode === 'string' ? error.remoteCode : null,
    status: Number.isSafeInteger(error?.status) ? error.status : null,
  });
}

function defaultErrorReporter(error) {
  console.error('[Verification Heartbeat] Send failed:', safeErrorContext(error));
}

function startVerificationHeartbeatWorker({
  epoch,
  syncClient,
  intervalMs = DEFAULT_INTERVAL_MS,
  owner = defaultOwner(),
  runOnce = runVerificationHeartbeatOnce,
  now = () => new Date(),
  onError = defaultErrorReporter,
} = {}) {
  requireOwner(owner);
  requireEpoch(epoch);
  requireSyncClient(syncClient);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new TypeError('Verification heartbeat intervalMs must be at least 1000.');
  }
  if (typeof runOnce !== 'function' || typeof now !== 'function' || typeof onError !== 'function') {
    throw new TypeError('Verification heartbeat worker dependencies are invalid.');
  }
  if (startupTimer || intervalTimer || inFlightTick) {
    return { started: false, owner: activeOwner };
  }

  const tick = () => {
    if (inFlightTick) return inFlightTick;
    const running = Promise.resolve()
      .then(() => runOnce({ epoch, owner, syncClient, now: now() }))
      .catch((error) => {
        try {
          onError(error, safeErrorContext(error));
        } catch (_) {
          // Observability hooks must not terminate the scheduler.
        }
      })
      .finally(() => {
        if (inFlightTick === running) inFlightTick = null;
      });
    inFlightTick = running;
    return running;
  };

  activeOwner = owner;
  startupTimer = setTimeout(() => {
    startupTimer = null;
    void tick();
  }, 0);
  intervalTimer = setInterval(() => {
    void tick();
  }, intervalMs);
  if (typeof startupTimer.unref === 'function') startupTimer.unref();
  if (typeof intervalTimer.unref === 'function') intervalTimer.unref();

  return { started: true, owner };
}

async function stopVerificationHeartbeatWorker() {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = null;
  intervalTimer = null;

  const running = inFlightTick;
  if (running) await running;
  activeOwner = null;
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  DEFAULT_LEASE_MS,
  JOB_NAME,
  acquireHeartbeatLease,
  hasUndeliveredVerificationRows,
  releaseHeartbeatLease,
  runVerificationHeartbeatOnce,
  safeErrorContext,
  startVerificationHeartbeatWorker,
  stopVerificationHeartbeatWorker,
};
