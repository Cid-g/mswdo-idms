'use strict';

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { common } = require('@hyperledger/fabric-protos');

const Applicant = require('../models/Applicant');
const AuditLog = require('../models/AuditLog');
const BlockchainAnchor = require('../models/BlockchainAnchor');
const ChainOutbox = require('../models/ChainOutbox');
const FabricLedgerState = require('../models/FabricLedgerState');
const IDRecord = require('../models/IDRecord');
const {
  getFabricGeneration,
  getQsccContract,
  markFabricDisconnected,
} = require('../fabric/connect');
const { verifyIDOnChain } = require('./blockchain');
const {
  buildAnchorPayload,
  enqueueChainOp,
  operationIdFor,
} = require('./chainOutbox');
const { withMongoTransaction } = require('../lib/transactions');

const PRIMARY_LEDGER_KEY = 'primary';
const CHANNEL_NAME = process.env.FABRIC_CHANNEL_NAME || 'mychannel';

class LedgerEpochMismatchError extends Error {
  constructor({ acceptedEpoch, observedEpoch }) {
    super(`Fabric ledger epoch mismatch: accepted ${acceptedEpoch}, observed ${observedEpoch}`);
    this.name = 'LedgerEpochMismatchError';
    this.code = 'FABRIC_LEDGER_EPOCH_MISMATCH';
    this.acceptedEpoch = acceptedEpoch;
    this.observedEpoch = observedEpoch;
  }
}

class ReconciliationConflictError extends Error {
  constructor(message, code = 'BLOCKCHAIN_RECONCILIATION_CONFLICT') {
    super(message);
    this.name = 'ReconciliationConflictError';
    this.code = code;
  }
}

function asDate(value) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function decodeGenesis(bytes) {
  const serialized = Buffer.from(bytes);
  if (serialized.length === 0) throw new Error('QSCC returned an empty genesis block');

  const block = common.Block.deserializeBinary(serialized);
  const header = block.getHeader();
  if (!header) throw new Error('QSCC genesis block has no header');
  const number = Number(header.getNumber());
  if (number !== 0) throw new Error(`QSCC returned block ${number}, expected genesis block 0`);
  return serialized;
}

async function getLedgerEpoch() {
  const generation = getFabricGeneration();
  const qscc = getQsccContract();
  try {
    const bytes = await qscc.evaluateTransaction('GetBlockByNumber', CHANNEL_NAME, '0');
    return crypto.createHash('sha256').update(decodeGenesis(bytes)).digest('hex');
  } catch (error) {
    markFabricDisconnected(error, generation);
    throw error;
  }
}

const defaultFabricClient = { getLedgerEpoch, verifyIDOnChain };

function requireFabricClient(fabricClient) {
  if (!fabricClient || typeof fabricClient.getLedgerEpoch !== 'function') {
    throw new TypeError('A Fabric client with getLedgerEpoch() is required');
  }
}

async function observeLedgerEpoch({ fabricClient = defaultFabricClient, now = new Date() } = {}) {
  requireFabricClient(fabricClient);
  const observedEpoch = await fabricClient.getLedgerEpoch();
  if (typeof observedEpoch !== 'string' || observedEpoch.length === 0) {
    throw new Error('Fabric ledger epoch must be a non-empty string');
  }

  let state = await FabricLedgerState.findOne({ key: PRIMARY_LEDGER_KEY });
  if (!state) {
    try {
      state = await FabricLedgerState.create({
        key: PRIMARY_LEDGER_KEY,
        acceptedEpoch: observedEpoch,
        observedEpoch,
        status: 'ACTIVE',
        acceptedAt: now,
      });
      return state;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      state = await FabricLedgerState.findOne({ key: PRIMARY_LEDGER_KEY });
    }
  }

  if (state.acceptedEpoch === observedEpoch) {
    return FabricLedgerState.findOneAndUpdate(
      { _id: state._id },
      {
        $set: { observedEpoch, status: 'ACTIVE' },
        $unset: { detectedAt: '' },
      },
      { new: true }
    );
  }

  const update = {
    $set: {
      observedEpoch,
      status: 'MISMATCH',
    },
  };
  if (state.observedEpoch !== observedEpoch || state.status !== 'MISMATCH') {
    update.$set.detectedAt = now;
  }

  return FabricLedgerState.findOneAndUpdate(
    { _id: state._id },
    update,
    { new: true }
  );
}

async function assertLedgerEpochActive(options = {}) {
  const state = await observeLedgerEpoch(options);
  if (state.status !== 'ACTIVE') {
    throw new LedgerEpochMismatchError({
      acceptedEpoch: state.acceptedEpoch,
      observedEpoch: state.observedEpoch,
    });
  }
  return state;
}

function ledgerTerminalStatus(ledger) {
  if (!ledger?.found) return null;
  if (ledger.status === 'REVOKED' || ledger.status === 'EXPIRED') return ledger.status;
  return null;
}

function outboxSummary(operation) {
  if (!operation) return null;
  return {
    operationId: operation.operationId,
    operation: operation.operation,
    sequence: operation.sequence,
    state: operation.state,
  };
}

async function scanBlockchainConsistency({ fabricClient = defaultFabricClient } = {}) {
  requireFabricClient(fabricClient);
  if (typeof fabricClient.verifyIDOnChain !== 'function') {
    throw new TypeError('A Fabric client with verifyIDOnChain() is required');
  }

  const observedEpoch = await fabricClient.getLedgerEpoch();
  const ledgerState = await FabricLedgerState.findOne({ key: PRIMARY_LEDGER_KEY }).lean();
  const records = await IDRecord.find({}).sort({ _id: 1 }).lean();

  const report = {
    generatedAt: new Date(),
    ledger: {
      acceptedEpoch: ledgerState?.acceptedEpoch ?? null,
      observedEpoch,
      status: ledgerState && ledgerState.acceptedEpoch !== observedEpoch
        ? 'MISMATCH'
        : 'ACTIVE',
    },
    ledgerTerminalAhead: [],
    missingTerminalIntents: [],
    missingAnchorIntents: [],
    partialUnanchored: [],
    staleAnchors: [],
    ledgerMissingKnownRecords: [],
  };

  for (const record of records) {
    const [applicant, anchor, operations, ledger] = await Promise.all([
      Applicant.findById(record.applicantId).lean(),
      BlockchainAnchor.findOne({ idRecordId: record._id }).lean(),
      ChainOutbox.find({ idRecordId: record._id }).sort({ sequence: 1 }).lean(),
      fabricClient.verifyIDOnChain(record.idNumber),
    ]);

    const anchorOperation = operations.find((item) => item.operation === 'ANCHOR');
    const terminalOperationName = record.status === 'REVOKED'
      ? 'REVOKE'
      : (record.status === 'EXPIRED' ? 'EXPIRE' : null);
    const terminalOperation = terminalOperationName
      ? operations.find((item) => item.operation === terminalOperationName)
      : null;
    const anchorCurrentForObserved = Boolean(
      anchor
      && anchor.receiptState === 'CURRENT'
      && anchor.ledgerEpoch === observedEpoch
    );
    const hasAnchorPrerequisite = anchorCurrentForObserved || Boolean(anchorOperation);
    const canRecreateAnchor = applicant?.status === 'COMPLETE';

    if (anchor && !anchorCurrentForObserved) {
      report.staleAnchors.push({
        idRecordId: record._id,
        recordRef: record.idNumber,
        receiptEpoch: anchor.ledgerEpoch ?? null,
        observedEpoch,
      });
    }

    if (!hasAnchorPrerequisite) {
      if (canRecreateAnchor) {
        report.missingAnchorIntents.push({
          idRecordId: record._id,
          recordRef: record.idNumber,
          applicantId: record.applicantId,
        });
      } else {
        report.partialUnanchored.push({
          idRecordId: record._id,
          recordRef: record.idNumber,
          applicantId: record.applicantId,
        });
      }
    }

    const terminal = ledgerTerminalStatus(ledger);
    if (record.status === 'ACTIVE' && terminal) {
      report.ledgerTerminalAhead.push({
        idRecordId: record._id,
        recordRef: record.idNumber,
        localStatus: record.status,
        ledgerStatus: terminal,
        ledgerRecord: ledger,
      });
    }

    if (
      (record.status === 'REVOKED' || record.status === 'EXPIRED')
      && ledger?.status !== record.status
      && !terminalOperation
      && (hasAnchorPrerequisite || canRecreateAnchor)
    ) {
      report.missingTerminalIntents.push({
        idRecordId: record._id,
        recordRef: record.idNumber,
        localStatus: record.status,
        anchorPrerequisite: hasAnchorPrerequisite ? 'EXISTING' : 'RECREATE',
      });
    }

    if (!ledger?.found && (anchorCurrentForObserved || operations.some((op) => op.state === 'SENT'))) {
      report.ledgerMissingKnownRecords.push({
        idRecordId: record._id,
        recordRef: record.idNumber,
        operations: operations.map(outboxSummary),
      });
    }
  }

  report.counts = {
    ledgerTerminalAhead: report.ledgerTerminalAhead.length,
    missingTerminalIntents: report.missingTerminalIntents.length,
    missingAnchorIntents: report.missingAnchorIntents.length,
    partialUnanchored: report.partialUnanchored.length,
    staleAnchors: report.staleAnchors.length,
    ledgerMissingKnownRecords: report.ledgerMissingKnownRecords.length,
  };
  return report;
}

function replayStateForIndex(index) {
  return index === 0 ? 'PENDING' : 'BLOCKED';
}

async function blockNewOperationBehindPredecessor(operation, session) {
  const predecessor = await ChainOutbox.exists({
    recordRef: operation.recordRef,
    sequence: { $lt: operation.sequence },
    state: { $ne: 'SENT' },
  }).session(session);
  if (!predecessor || operation.state !== 'PENDING') return operation;

  await ChainOutbox.updateOne(
    { _id: operation._id, state: 'PENDING' },
    { $set: { state: 'BLOCKED' } },
    { session }
  );
  operation.state = 'BLOCKED';
  return operation;
}

async function resetKnownOperationsForEpoch({ session, observedEpoch, now }) {
  const operations = await ChainOutbox.find({}).sort({ recordRef: 1, sequence: 1 }).session(session);
  const byRecord = new Map();
  for (const operation of operations) {
    const key = operation.recordRef;
    if (!byRecord.has(key)) byRecord.set(key, []);
    byRecord.get(key).push(operation);
  }

  for (const recordOperations of byRecord.values()) {
    const firstAnchorIndex = recordOperations.findIndex((item) => item.operation === 'ANCHOR');
    const firstTerminalIndex = recordOperations.findIndex((item) => item.operation !== 'ANCHOR');
    if (firstTerminalIndex !== -1 && (firstAnchorIndex === -1 || firstAnchorIndex > firstTerminalIndex)) {
      throw new ReconciliationConflictError(
        `Cannot replay ${recordOperations[0].recordRef}: terminal command has no earlier ANCHOR`,
        'BLOCKCHAIN_RECONCILIATION_UNREPLAYABLE_SEQUENCE'
      );
    }

    for (let index = 0; index < recordOperations.length; index += 1) {
      const operation = recordOperations[index];
      await ChainOutbox.updateOne(
        { _id: operation._id },
        {
          $set: {
            state: replayStateForIndex(index),
            attempts: 0,
            nextAttempt: now,
            reconciled: false,
          },
          $unset: {
            lastError: '',
            lockOwner: '',
            lockedUntil: '',
            alertedAt: '',
            txId: '',
            blockNumber: '',
            ledgerEpoch: '',
            completedAt: '',
          },
        },
        { session }
      );
    }
  }

  await BlockchainAnchor.updateMany(
    { ledgerEpoch: { $ne: observedEpoch } },
    { $set: { receiptState: 'STALE', reconciledAt: now } },
    { session }
  );

  return operations.length;
}

async function applyBlockchainReconciliation({
  actorId,
  expectedObservedEpoch,
  fabricClient = defaultFabricClient,
  now = new Date(),
} = {}) {
  if (!mongoose.isValidObjectId(actorId)) {
    throw new TypeError('A valid actorId is required to apply blockchain reconciliation');
  }
  if (typeof expectedObservedEpoch !== 'string' || expectedObservedEpoch.length === 0) {
    throw new TypeError('expectedObservedEpoch is required');
  }

  const report = await scanBlockchainConsistency({ fabricClient });
  if (report.ledger.observedEpoch !== expectedObservedEpoch) {
    throw new ReconciliationConflictError(
      'The observed Fabric ledger epoch changed before reconciliation approval',
      'BLOCKCHAIN_RECONCILIATION_STALE_CONFIRMATION'
    );
  }

  const confirmedEpoch = await fabricClient.getLedgerEpoch();
  if (confirmedEpoch !== expectedObservedEpoch) {
    throw new ReconciliationConflictError(
      'The Fabric ledger epoch changed while reconciliation was being prepared',
      'BLOCKCHAIN_RECONCILIATION_STALE_CONFIRMATION'
    );
  }

  return withMongoTransaction(async (session) => {
    const state = await FabricLedgerState.findOne({ key: PRIMARY_LEDGER_KEY }).session(session);
    if (!state || state.observedEpoch !== expectedObservedEpoch) {
      throw new ReconciliationConflictError(
        'The stored observed Fabric ledger epoch no longer matches the approved epoch',
        'BLOCKCHAIN_RECONCILIATION_STALE_CONFIRMATION'
      );
    }

    const acceptingReset = state.acceptedEpoch !== expectedObservedEpoch;
    let replayedOperations = 0;
    if (acceptingReset) {
      replayedOperations = await resetKnownOperationsForEpoch({
        session,
        observedEpoch: expectedObservedEpoch,
        now,
      });
    }

    let adoptedLedgerTerminal = 0;
    for (const item of report.ledgerTerminalAhead) {
      const ledger = item.ledgerRecord;
      if (item.ledgerStatus === 'REVOKED') {
        const update = {
          $set: {
            status: 'REVOKED',
            revokedReason: ledger.revokedReason || 'Restored from Fabric ledger',
          },
          $unset: { revokedById: '' },
        };
        const revokedAt = asDate(ledger.revokedAt || ledger.lastUpdatedAt);
        if (revokedAt) update.$set.revokedAt = revokedAt;
        const result = await IDRecord.updateOne(
          { _id: item.idRecordId, status: 'ACTIVE' },
          update,
          { session }
        );
        adoptedLedgerTerminal += result.modifiedCount;
      } else if (item.ledgerStatus === 'EXPIRED') {
        const result = await IDRecord.updateOne(
          { _id: item.idRecordId, status: 'ACTIVE' },
          { $set: { status: 'EXPIRED' } },
          { session }
        );
        adoptedLedgerTerminal += result.modifiedCount;
      }
    }

    let recreatedAnchors = 0;
    for (const item of report.missingAnchorIntents) {
      const idRecord = await IDRecord.findById(item.idRecordId).session(session);
      const applicant = await Applicant.findById(item.applicantId).session(session);
      if (!idRecord || !applicant || applicant.status !== 'COMPLETE') continue;

      const queuedAnchor = await enqueueChainOp({
        session,
        operationId: operationIdFor('ANCHOR', idRecord._id),
        operation: 'ANCHOR',
        idRecordId: idRecord._id,
        payload: buildAnchorPayload(applicant, idRecord),
      });
      await blockNewOperationBehindPredecessor(queuedAnchor, session);
      recreatedAnchors += 1;
    }

    let recreatedTerminalIntents = 0;
    for (const item of report.missingTerminalIntents) {
      const idRecord = await IDRecord.findById(item.idRecordId).session(session);
      if (!idRecord || idRecord.status !== item.localStatus) continue;

      const operation = item.localStatus === 'REVOKED' ? 'REVOKE' : 'EXPIRE';
      const payload = operation === 'REVOKE'
        ? Object.freeze({ reason: idRecord.revokedReason || 'Restored local revocation' })
        : Object.freeze({});
      const queuedTerminal = await enqueueChainOp({
        session,
        operationId: operationIdFor(operation, idRecord._id),
        operation,
        idRecordId: idRecord._id,
        payload,
      });
      await blockNewOperationBehindPredecessor(queuedTerminal, session);
      recreatedTerminalIntents += 1;
    }

    const previousAcceptedEpoch = state.acceptedEpoch;
    state.acceptedEpoch = expectedObservedEpoch;
    state.observedEpoch = expectedObservedEpoch;
    state.status = 'ACTIVE';
    state.acceptedAt = now;
    state.acceptedById = actorId;
    state.detectedAt = undefined;
    await state.save({ session });

    const counts = {
      replayedOperations,
      adoptedLedgerTerminal,
      recreatedAnchors,
      recreatedTerminalIntents,
      partialUnanchored: report.partialUnanchored.length,
    };

    await AuditLog.create([{
      userId: actorId,
      action: 'BLOCKCHAIN_RECONCILIATION_APPLIED',
      targetType: 'FabricLedgerState',
      targetId: PRIMARY_LEDGER_KEY,
      description: `Accepted Fabric ledger epoch ${expectedObservedEpoch} and applied reconciliation`,
      metadata: {
        previousAcceptedEpoch,
        acceptedEpoch: expectedObservedEpoch,
        counts,
      },
    }], { session });

    return {
      ledger: {
        acceptedEpoch: expectedObservedEpoch,
        observedEpoch: expectedObservedEpoch,
        status: 'ACTIVE',
      },
      counts,
      report,
    };
  });
}

module.exports = {
  LedgerEpochMismatchError,
  ReconciliationConflictError,
  applyBlockchainReconciliation,
  assertLedgerEpochActive,
  getLedgerEpoch,
  observeLedgerEpoch,
  scanBlockchainConsistency,
};
