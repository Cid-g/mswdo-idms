'use strict';

const crypto = require('node:crypto');

const BlockchainAnchor = require('../models/BlockchainAnchor');
const ChainOutbox = require('../models/ChainOutbox');
const IDRecord = require('../models/IDRecord');
const JobLease = require('../models/JobLease');
const { withMongoTransaction } = require('../lib/transactions');
const { enqueueChainOp, operationIdFor } = require('../services/chainOutbox');

const JOB_NAME = 'blockchain-expiry';
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60_000;

let startupTimer = null;
let intervalTimer = null;
let tickRunning = false;
let activeOwner = null;

function assertDate(value, fieldName) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${fieldName} must be a valid Date`);
  }
}

async function acquireExpiryLease({ owner, now, leaseMs = DEFAULT_LEASE_MS }) {
  if (!owner) throw new Error('Expiry job owner is required');
  assertDate(now, 'now');

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
    // When an unexpired lease exists, the upsert predicate does not match and
    // MongoDB attempts to insert the same unique job name. That duplicate-key
    // result is the atomic "lease already held" outcome.
    if (error?.code === 11000) return false;
    throw error;
  }
}

async function releaseExpiryLease({ owner, now = new Date() }) {
  assertDate(now, 'now');
  await JobLease.updateOne(
    { name: JOB_NAME, lockOwner: owner },
    {
      $set: { lockedUntil: now, lockOwner: null },
    }
  );
}

async function expireNextDueRecord(now) {
  const candidate = await IDRecord.findOne({
    status: 'ACTIVE',
    expiryDate: { $lt: now },
  })
    .sort({ expiryDate: 1, _id: 1 })
    .select({ _id: 1 })
    .lean();

  if (!candidate) return null;

  return withMongoTransaction(async (session) => {
    const expired = await IDRecord.findOneAndUpdate(
      {
        _id: candidate._id,
        status: 'ACTIVE',
        expiryDate: { $lt: now },
      },
      { $set: { status: 'EXPIRED' } },
      { new: true, session }
    );

    // Revocation or another expiry worker may have won after candidate
    // discovery. The conditional update is the race boundary.
    if (!expired) return { processed: false, raced: true };

    const anchorReceipt = await BlockchainAnchor
      .exists({ idRecordId: expired._id })
      .session(session);
    const anchorIntent = anchorReceipt
      ? null
      : await ChainOutbox
        .exists({ idRecordId: expired._id, operation: 'ANCHOR' })
        .session(session);

    if (anchorReceipt || anchorIntent) {
      const outbox = await enqueueChainOp({
        session,
        operationId: operationIdFor('EXPIRE', expired._id),
        operation: 'EXPIRE',
        idRecordId: expired._id,
        payload: Object.freeze({}),
      });
      return { processed: true, queued: true, idRecordId: expired._id, outboxId: outbox._id };
    }

    // A card that never entered Fabric cannot receive a valid EXPIRE command.
    // Its local status is still authoritative and is committed.
    return { processed: true, queued: false, idRecordId: expired._id };
  });
}

async function runExpiryJobOnce({
  owner,
  now = new Date(),
  leaseMs = DEFAULT_LEASE_MS,
} = {}) {
  if (!owner) throw new Error('Expiry job owner is required');
  assertDate(now, 'now');

  const acquired = await acquireExpiryLease({ owner, now, leaseMs });
  if (!acquired) {
    return { acquired: false, skipped: 'LEASE_HELD', expired: 0, queued: 0 };
  }

  let expiredCount = 0;
  let queuedCount = 0;
  try {
    while (true) {
      const result = await expireNextDueRecord(now);
      if (result === null) break;
      if (!result.processed) continue;
      expiredCount += 1;
      if (result.queued) queuedCount += 1;
    }

    return {
      acquired: true,
      expired: expiredCount,
      queued: queuedCount,
    };
  } finally {
    await releaseExpiryLease({ owner, now });
  }
}

function defaultOwner() {
  return `expiry:${process.pid}:${crypto.randomUUID()}`;
}

function reportExpiryError(error) {
  console.error('[ExpiryJob] Run failed:', error?.message ?? error);
}

function startExpiryJob({
  intervalMs = DEFAULT_INTERVAL_MS,
  owner = defaultOwner(),
  runOnce = runExpiryJobOnce,
  now = () => new Date(),
  onError = reportExpiryError,
} = {}) {
  if (startupTimer || intervalTimer) {
    return { started: false, owner: activeOwner };
  }
  if (!owner) throw new Error('Expiry job owner is required');
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TypeError('intervalMs must be a positive number');
  }

  const tick = async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      await runOnce({ owner, now: now() });
    } catch (error) {
      onError(error);
    } finally {
      tickRunning = false;
    }
  };

  activeOwner = owner;
  startupTimer = setTimeout(() => {
    startupTimer = null;
    void tick();
  }, 0);
  intervalTimer = setInterval(() => {
    void tick();
  }, intervalMs);

  return { started: true, owner };
}

function stopExpiryJob() {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = null;
  intervalTimer = null;
  tickRunning = false;
  activeOwner = null;
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  DEFAULT_LEASE_MS,
  JOB_NAME,
  runExpiryJobOnce,
  startExpiryJob,
  stopExpiryJob,
};
