'use strict';

const VerifyOutbox = require('../models/VerifyOutbox');

const DEFAULT_LEASE_MS = 2 * 60_000;
const RETRY_DELAYS_MS = Object.freeze([
  30_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
]);

function requireOwner(owner) {
  if (typeof owner !== 'string' || owner.trim() === '' || owner.length > 256) {
    throw new TypeError('Verification outbox owner must be a non-empty string up to 256 characters.');
  }
}

function requireDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${name} must be a valid Date.`);
  }
}

function requireLeaseMs(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60 * 60_000) {
    throw new TypeError('Verification outbox leaseMs must be between 1 and 3600000.');
  }
}

function predecessorQuery(candidate) {
  return {
    _id: { $ne: candidate._id },
    tokenHash: candidate.tokenHash,
    state: { $ne: 'SENT' },
    $or: [
      { epoch: { $lt: candidate.epoch } },
      { epoch: candidate.epoch, revision: { $lt: candidate.revision } },
    ],
  };
}

async function recoverExpiredLeases(now) {
  requireDate(now, 'now');
  const result = await VerifyOutbox.updateMany(
    {
      state: 'PROCESSING',
      lockedUntil: { $lte: now },
    },
    {
      $set: {
        state: 'PENDING',
        nextAttempt: now,
      },
      $unset: {
        lockOwner: '',
        lockedUntil: '',
      },
    }
  );
  return result.modifiedCount;
}

async function claimNextOperation({
  owner,
  now,
  leaseMs = DEFAULT_LEASE_MS,
  operationId,
}) {
  requireOwner(owner);
  requireDate(now, 'now');
  requireLeaseMs(leaseMs);
  if (
    operationId !== undefined
    && (typeof operationId !== 'string' || operationId.trim() === '')
  ) {
    throw new TypeError('Verification outbox operationId must be a non-empty string.');
  }

  const skippedIds = [];
  while (true) {
    const dueQuery = {
      state: 'PENDING',
      nextAttempt: { $lte: now },
    };
    if (operationId !== undefined) dueQuery.operationId = operationId;
    if (skippedIds.length > 0) dueQuery._id = { $nin: skippedIds };

    const candidate = await VerifyOutbox.findOne(dueQuery)
      .sort({ createdAt: 1, epoch: 1, revision: 1, _id: 1 })
      .lean();
    if (!candidate) return null;

    const predecessor = await VerifyOutbox.exists(predecessorQuery(candidate));
    if (predecessor) {
      if (operationId !== undefined) return null;
      skippedIds.push(candidate._id);
      continue;
    }

    const claimed = await VerifyOutbox.findOneAndUpdate(
      {
        _id: candidate._id,
        state: 'PENDING',
        nextAttempt: { $lte: now },
      },
      {
        $set: {
          state: 'PROCESSING',
          lockOwner: owner,
          lockedUntil: new Date(now.getTime() + leaseMs),
        },
      },
      { new: true }
    );
    if (claimed) return claimed;
    if (operationId !== undefined) return null;
    skippedIds.push(candidate._id);
  }
}

function retryDelayMs(attempts) {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new TypeError('Verification outbox attempts must be a positive safe integer.');
  }
  return RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS.at(-1);
}

function safeFailureSummary(error) {
  const parts = [];
  if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)) {
    parts.push(`code=${error.code}`);
  }
  if (
    typeof error?.remoteCode === 'string'
    && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.remoteCode)
  ) {
    parts.push(`remoteCode=${error.remoteCode}`);
  }
  if (Number.isSafeInteger(error?.status) && error.status >= 100 && error.status <= 599) {
    parts.push(`status=${error.status}`);
  }
  if (parts.length === 0) parts.push('code=VERIFY_SYNC_UNKNOWN_FAILURE');
  return parts.join(' ');
}

async function failOperation(outbox, { owner, now, error }) {
  requireOwner(owner);
  requireDate(now, 'now');
  if (!outbox || !outbox._id) throw new TypeError('Claimed verification operation is required.');

  const attempts = (Number.isSafeInteger(outbox.attempts) ? outbox.attempts : 0) + 1;
  const retryable = error?.retryable !== false;
  const update = {
    $set: {
      state: retryable ? 'PENDING' : 'FAILED',
      attempts,
      lastError: safeFailureSummary(error),
      nextAttempt: retryable
        ? new Date(now.getTime() + retryDelayMs(attempts))
        : now,
    },
    $unset: {
      lockOwner: '',
      lockedUntil: '',
    },
  };

  const result = await VerifyOutbox.updateOne(
    {
      _id: outbox._id,
      state: 'PROCESSING',
      lockOwner: owner,
    },
    update
  );
  return result.modifiedCount === 1;
}

async function completeOperation(outbox, { owner, now }) {
  requireOwner(owner);
  requireDate(now, 'now');
  if (!outbox || !outbox._id) throw new TypeError('Claimed verification operation is required.');

  const result = await VerifyOutbox.updateOne(
    {
      _id: outbox._id,
      state: 'PROCESSING',
      lockOwner: owner,
    },
    {
      $set: {
        state: 'SENT',
        nextAttempt: now,
      },
      $unset: {
        lockOwner: '',
        lockedUntil: '',
        lastError: '',
      },
    }
  );
  return result.modifiedCount === 1;
}

module.exports = {
  DEFAULT_LEASE_MS,
  RETRY_DELAYS_MS,
  claimNextOperation,
  completeOperation,
  failOperation,
  predecessorQuery,
  recoverExpiredLeases,
  retryDelayMs,
  safeFailureSummary,
};
