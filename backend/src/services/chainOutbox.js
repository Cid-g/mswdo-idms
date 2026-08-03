const { isDeepStrictEqual } = require('node:util');

const ChainOutbox = require('../models/ChainOutbox');
const BlockchainAnchor = require('../models/BlockchainAnchor');
const IDRecord = require('../models/IDRecord');
const { withMongoTransaction } = require('../lib/transactions');
const { computeHash } = require('./blockchain');

const DEFAULT_LEASE_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000];

function operationIdFor(operation, idRecordId) {
  return `${operation.toLowerCase()}:${idRecordId}`;
}

function buildAnchorPayload(applicant, idRecord) {
  const { hash } = computeHash(applicant, idRecord);
  return Object.freeze({
    canonicalHash: hash,
    idType: applicant.department,
    soloParentIdType: applicant.soloParent?.categoryCode ?? '',
    issuingOffice: 'MSWDO-GERONA-TARLAC',
  });
}

function assertSameImmutableCommand(existing, command) {
  const sameCommand = existing.operation === command.operation
    && existing.idRecordId.toString() === command.idRecordId.toString()
    && isDeepStrictEqual(existing.payload, command.payload);

  if (!sameCommand) {
    const error = new Error(`Chain operation ID collision: ${command.operationId}`);
    error.code = 'CHAIN_OPERATION_ID_COLLISION';
    throw error;
  }

  return existing;
}

async function enqueueChainOp({
  session,
  operationId,
  operation,
  idRecordId,
  payload,
}) {
  if (!session || !session.inTransaction()) {
    throw new Error('enqueueChainOp requires an active MongoDB transaction');
  }

  const command = { operationId, operation, idRecordId, payload };
  const existing = await ChainOutbox.findOne({ operationId }).session(session);
  if (existing) return assertSameImmutableCommand(existing, command);

  const idRecord = await IDRecord.findOneAndUpdate(
    { _id: idRecordId },
    { $inc: { chainSequence: 1 } },
    { new: true, session }
  );
  if (!idRecord) {
    throw new Error('ID record not found while enqueueing chain operation');
  }

  const [created] = await ChainOutbox.create([{
    operationId,
    operation,
    idRecordId,
    recordRef: idRecord.idNumber,
    sequence: idRecord.chainSequence,
    payload,
  }], { session });

  return created;
}

async function recoverExpiredLeases(now) {
  await ChainOutbox.updateMany(
    { state: 'PROCESSING', lockedUntil: { $lte: now } },
    {
      $set: { state: 'PENDING' },
      $unset: { lockOwner: '', lockedUntil: '' },
    }
  );
}

async function reevaluateBlockedOperations() {
  const blocked = await ChainOutbox.find({ state: 'BLOCKED' })
    .sort({ createdAt: 1, sequence: 1 })
    .lean();

  for (const candidate of blocked) {
    const predecessor = await ChainOutbox.exists({
      recordRef: candidate.recordRef,
      sequence: { $lt: candidate.sequence },
      state: { $ne: 'SENT' },
    });
    if (!predecessor) {
      await ChainOutbox.updateOne(
        { _id: candidate._id, state: 'BLOCKED' },
        { $set: { state: 'PENDING' } }
      );
    }
  }
}

async function claimNextOperation({
  owner,
  now,
  leaseMs = DEFAULT_LEASE_MS,
  operationId,
}) {
  const dueQuery = { state: 'PENDING', nextAttempt: { $lte: now } };
  if (operationId !== undefined) dueQuery.operationId = operationId;

  while (true) {
    const candidate = await ChainOutbox.findOne(dueQuery)
      .sort({ createdAt: 1, sequence: 1 })
      .lean();
    if (!candidate) return null;

    const predecessor = await ChainOutbox.exists({
      recordRef: candidate.recordRef,
      sequence: { $lt: candidate.sequence },
      state: { $ne: 'SENT' },
    });
    if (predecessor) {
      await ChainOutbox.updateOne(
        {
          _id: candidate._id,
          state: 'PENDING',
          nextAttempt: { $lte: now },
        },
        {
          $set: { state: 'BLOCKED' },
          $unset: { lockOwner: '', lockedUntil: '' },
        }
      );
      if (operationId !== undefined) return null;
      continue;
    }

    const claimed = await ChainOutbox.findOneAndUpdate(
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
  }
}

function retryDelayMs(attempts) {
  return RETRY_DELAYS_MS[attempts - 1] ?? 60 * 60_000;
}

async function failOperation(outbox, { owner, now, error }) {
  const attempts = outbox.attempts + 1;
  const terminal = outbox.operation !== 'REVOKE' && attempts >= 20;
  const update = {
    $set: {
      state: terminal ? 'FAILED' : 'PENDING',
      attempts,
      lastError: error?.message ?? String(error),
      nextAttempt: new Date(now.getTime() + retryDelayMs(attempts)),
    },
    $unset: { lockOwner: '', lockedUntil: '' },
  };
  if (outbox.operation === 'REVOKE' && attempts === 20 && !outbox.alertedAt) {
    update.$set.alertedAt = now;
  }

  const result = await ChainOutbox.updateOne(
    { _id: outbox._id, state: 'PROCESSING', lockOwner: owner },
    update
  );
  return result.modifiedCount === 1;
}

async function completeOperation(outbox, { owner, now, receipt }) {
  return withMongoTransaction(async (session) => {
    if (outbox.operation === 'ANCHOR') {
      const anchorFields = {
        idRecordId: outbox.idRecordId,
        recordRef: outbox.recordRef,
        canonicalHash: outbox.payload.canonicalHash,
        txId: receipt.txId,
        blockNumber: receipt.blockNumber,
        ledgerEpoch: receipt.ledgerEpoch,
        receiptState: 'CURRENT',
        anchoredAt: now,
      };
      if (receipt.reconciled) anchorFields.reconciledAt = now;

      await BlockchainAnchor.updateOne(
        { idRecordId: outbox.idRecordId },
        { $set: anchorFields },
        { upsert: true, session }
      );
    }

    const result = await ChainOutbox.updateOne(
      { _id: outbox._id, state: 'PROCESSING', lockOwner: owner },
      {
        $set: {
          state: 'SENT',
          txId: receipt.txId,
          blockNumber: receipt.blockNumber,
          ledgerEpoch: receipt.ledgerEpoch,
          reconciled: Boolean(receipt.reconciled),
          completedAt: now,
        },
        $unset: { lockOwner: '', lockedUntil: '', lastError: '' },
      },
      { session }
    );
    if (result.modifiedCount !== 1) {
      const error = new Error('Chain outbox lease ownership was lost before completion');
      error.code = 'CHAIN_OUTBOX_LEASE_LOST';
      throw error;
    }
    return true;
  });
}

module.exports = {
  DEFAULT_LEASE_MS,
  buildAnchorPayload,
  claimNextOperation,
  completeOperation,
  enqueueChainOp,
  failOperation,
  operationIdFor,
  recoverExpiredLeases,
  reevaluateBlockedOperations,
};
