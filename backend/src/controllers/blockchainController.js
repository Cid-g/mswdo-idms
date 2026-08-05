'use strict';

const { randomUUID } = require('node:crypto');

const Applicant        = require('../models/Applicant');
const IDRecord         = require('../models/IDRecord');
const BlockchainAnchor = require('../models/BlockchainAnchor');
const ChainOutbox      = require('../models/ChainOutbox');
const FabricLedgerState = require('../models/FabricLedgerState');
const { withMongoTransaction } = require('../lib/transactions');
const chainOutboxService = require('../services/chainOutbox');
const blockchainService = require('../services/blockchain');
const ledgerReconciliation = require('../services/ledgerReconciliation');
const fabricConnection = require('../fabric/connect');
const chainWorker = require('../workers/chainOutboxWorker');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function serializeReceipt(source) {
  if (!source?.txId) return null;
  return {
    txId: source.txId,
    blockNumber: source.blockNumber ?? null,
    ledgerEpoch: source.ledgerEpoch ?? null,
    reconciled: Boolean(source.reconciled),
    completedAt: source.completedAt ?? source.anchoredAt ?? null,
  };
}

function serializeOperation(operation) {
  if (!operation) return null;
  return {
    operationId: operation.operationId,
    operation: operation.operation,
    idRecordId: operation.idRecordId?.toString(),
    recordRef: operation.recordRef,
    sequence: operation.sequence,
    state: operation.state,
    attempts: operation.attempts,
    nextAttempt: operation.nextAttempt,
    lastError: operation.lastError ?? null,
    alertedAt: operation.alertedAt ?? null,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    receipt: serializeReceipt(operation),
  };
}

// ── POST /blockchain/anchor/:idRecordId ──────────────────────────────────────
// Manual anchoring uses the same deterministic operation and atomic claim path
// as the background worker. It never submits directly beside a worker.
async function anchorRecord(req, res, next) {
  try {
    const prepared = await withMongoTransaction(async (session) => {
      const idRecord = await IDRecord.findById(req.params.idRecordId).session(session);
      if (!idRecord) {
        throw httpError(404, 'NOT_FOUND', 'ID record not found.');
      }

      const applicant = await Applicant.findById(idRecord.applicantId).session(session);
      if (!applicant) {
        throw httpError(404, 'NOT_FOUND', 'Applicant not found.');
      }
      if (applicant.status !== 'COMPLETE') {
        throw httpError(
          409,
          'APPLICANT_NOT_COMPLETE',
          'The applicant profile must be complete before blockchain anchoring.'
        );
      }

      // Even a legacy BlockchainAnchor row is reconciled through the durable
      // command path. A Mongo receipt alone is not proof that the live ledger
      // still contains the matching transaction after a restore.
      const operation = await chainOutboxService.enqueueChainOp({
        session,
        operationId: chainOutboxService.operationIdFor('ANCHOR', idRecord._id),
        operation: 'ANCHOR',
        idRecordId: idRecord._id,
        payload: chainOutboxService.buildAnchorPayload(applicant, idRecord),
      });
      return { idRecord, operation };
    });

    let processingState = prepared.operation.state === 'SENT'
      ? 'ALREADY_SENT'
      : 'NOT_ATTEMPTED';
    if (prepared.operation.state !== 'SENT') {
      try {
        const processing = await chainWorker.processOperationById(
          prepared.operation.operationId,
          { owner: `manual-anchor:${prepared.idRecord._id}:${req.user.id}:${randomUUID()}` }
        );
        processingState = processing.state;
      } catch (error) {
        // The intent is already durable. A synchronous processing failure must
        // not turn a queued command into an HTTP failure or lose its retry path.
        processingState = error?.code || 'PROCESSING_ERROR';
      }
    }

    const [current, ledgerState, anchor] = await Promise.all([
      ChainOutbox.findOne({ operationId: prepared.operation.operationId }).lean(),
      FabricLedgerState.findOne({ key: 'primary' }).lean(),
      BlockchainAnchor.findOne({ idRecordId: prepared.idRecord._id }).lean(),
    ]);
    if (!current) {
      throw httpError(500, 'CHAIN_OPERATION_MISSING', 'The queued blockchain operation could not be reloaded.');
    }

    const receiptVerified = current.state === 'SENT'
      && ledgerState?.status === 'ACTIVE'
      && Boolean(current.ledgerEpoch)
      && current.ledgerEpoch === ledgerState.acceptedEpoch
      && anchor?.receiptState === 'CURRENT'
      && anchor.txId === current.txId
      && anchor.ledgerEpoch === current.ledgerEpoch;
    if (ledgerState?.status === 'MISMATCH') {
      processingState = 'LEDGER_EPOCH_MISMATCH';
    } else if (current.state === 'SENT' && !receiptVerified) {
      processingState = ledgerState?.status === 'ACTIVE'
        ? 'RECEIPT_EPOCH_STALE'
        : 'LEDGER_EPOCH_UNOBSERVED';
    }

    const receipt = serializeReceipt(current);
    const body = {
      ...serializeOperation(current),
      queued: current.state !== 'SENT',
      receiptVerified,
      processingState,
      hash: current.payload?.canonicalHash ?? null,
      ledger: {
        status: ledgerState?.status ?? 'UNOBSERVED',
        acceptedEpoch: ledgerState?.acceptedEpoch ?? null,
        observedEpoch: ledgerState?.observedEpoch ?? null,
      },
      anchor: current.state === 'SENT'
        ? {
          canonicalHash: current.payload?.canonicalHash ?? anchor?.canonicalHash ?? null,
          ...receipt,
          anchoredAt: anchor?.anchoredAt ?? current.completedAt ?? null,
          receiptState: anchor?.receiptState ?? null,
        }
        : null,
    };
    return res.status(receiptVerified ? 200 : 202).json(body);
  } catch (err) {
    if (err?.code === 'CHAIN_OPERATION_ID_COLLISION' && !err.status) err.status = 409;
    next(err);
  }
}

// ── GET /blockchain/verify/:idNumber ────────────────────────────────────────
async function verifyRecord(req, res, next) {
  try {
    const { idNumber } = req.params;

    const idRecord = await IDRecord.findOne({ idNumber });
    if (!idRecord) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ID record not found in system.' } });
    }

    const applicant = await Applicant.findById(idRecord.applicantId);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }

    const anchor = await BlockchainAnchor.findOne({ idRecordId: idRecord._id });
    if (!anchor) {
      return res.json({
        idNumber,
        anchored:    false,
        hashMatch:   null,
        reason:      'NOT_ANCHORED',
        message:     'This record has not been anchored to the blockchain yet.',
      });
    }

    if (process.env.FABRIC_ENABLED !== 'true') {
      const { hash } = blockchainService.computeHash(applicant, idRecord);
      const hashMatch = hash === anchor.canonicalHash;
      return res.json({
        idNumber,
        anchored:   true,
        hashMatch,
        source:     'cached',
        anchoredAt: anchor.anchoredAt,
        reason:     hashMatch ? null : 'HASH_MISMATCH',
      });
    }

    const result = await blockchainService.checkIntegrity(applicant, idRecord);

    await BlockchainAnchor.findByIdAndUpdate(anchor._id, {
      lastCheckedAt:   new Date(),
      lastCheckPassed: result.verified,
    });

    return res.json({
      idNumber,
      anchored:      true,
      hashMatch:     result.verified,
      source:        'live',
      onChainStatus: result.onChainStatus ?? null,
      anchoredAt:    anchor.anchoredAt,
      reason:        result.reason ?? null,
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /blockchain/status/:idRecordId ───────────────────────────────────────
async function getAnchorStatus(req, res, next) {
  try {
    const [anchor, operation] = await Promise.all([
      BlockchainAnchor.findOne({ idRecordId: req.params.idRecordId }).lean(),
      ChainOutbox.findOne({ idRecordId: req.params.idRecordId, operation: 'ANCHOR' }).lean(),
    ]);
    if (!anchor) {
      return res.json({
        anchored: false,
        chainSync: operation ? serializeOperation(operation) : null,
      });
    }
    return res.json({
      anchored:        true,
      canonicalHash:   anchor.canonicalHash,
      txId:            anchor.txId,
      blockNumber:     anchor.blockNumber,
      ledgerEpoch:     anchor.ledgerEpoch,
      receiptState:    anchor.receiptState,
      anchoredAt:      anchor.anchoredAt,
      lastCheckedAt:   anchor.lastCheckedAt,
      lastCheckPassed: anchor.lastCheckPassed,
      chainSync:       operation ? serializeOperation(operation) : null,
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /blockchain/health ───────────────────────────────────────────────────
async function getHealth(req, res, next) {
  try {
    const fabricEnabled = process.env.FABRIC_ENABLED === 'true';
    const connected = fabricConnection.isFabricConnected();
    const ledgerState = await FabricLedgerState.findOne({ key: 'primary' }).lean();
    const ledgerStatus = ledgerState?.status ?? 'UNOBSERVED';
    const paused = ledgerStatus === 'MISMATCH';

    return res.json({
      fabricEnabled,
      connected,
      ready: fabricEnabled && connected && ledgerStatus === 'ACTIVE',
      ledger: {
        status: ledgerStatus,
        paused,
        acceptedEpoch: ledgerState?.acceptedEpoch ?? null,
        observedEpoch: ledgerState?.observedEpoch ?? null,
        detectedAt: ledgerState?.detectedAt ?? null,
        acceptedAt: ledgerState?.acceptedAt ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /blockchain/sync-status ──────────────────────────────────────────────
async function getSyncStatus(req, res, next) {
  try {
    const now = new Date();
    const countRows = await ChainOutbox.aggregate([
      { $group: { _id: '$state', count: { $sum: 1 } } },
    ]);
    const counts = { PENDING: 0, PROCESSING: 0, SENT: 0, BLOCKED: 0, FAILED: 0 };
    for (const row of countRows) counts[row._id] = row.count;

    const operationalStates = ['PENDING', 'PROCESSING', 'BLOCKED', 'FAILED'];
    const [oldestOperation, failed, blocked, alertedRevokes, terminalRecords, ledgerState] = await Promise.all([
      ChainOutbox.findOne({ state: { $in: operationalStates } }).sort({ createdAt: 1, sequence: 1 }).lean(),
      ChainOutbox.find({ state: 'FAILED' }).sort({ updatedAt: 1 }).lean(),
      ChainOutbox.find({ state: 'BLOCKED' }).sort({ createdAt: 1, sequence: 1 }).lean(),
      ChainOutbox.find({ operation: 'REVOKE', alertedAt: { $exists: true, $ne: null } })
        .sort({ alertedAt: 1 }).lean(),
      IDRecord.find({ status: { $in: ['REVOKED', 'EXPIRED'] } }).sort({ updatedAt: 1 }).lean(),
      FabricLedgerState.findOne({ key: 'primary' }).lean(),
    ]);

    const blockedRefs = [...new Set(blocked.map((operation) => operation.recordRef))];
    const nonSentOperations = blockedRefs.length === 0
      ? []
      : await ChainOutbox.find({
        recordRef: { $in: blockedRefs },
        state: { $ne: 'SENT' },
      }).sort({ recordRef: 1, sequence: 1 }).lean();
    const nonSentByRecord = new Map();
    for (const operation of nonSentOperations) {
      if (!nonSentByRecord.has(operation.recordRef)) nonSentByRecord.set(operation.recordRef, []);
      nonSentByRecord.get(operation.recordRef).push(operation);
    }
    const blockedRows = blocked.map((operation) => {
      const predecessors = (nonSentByRecord.get(operation.recordRef) || [])
        .filter((candidate) => candidate.sequence < operation.sequence);
      const predecessor = predecessors.at(-1) ?? null;
      return {
        ...serializeOperation(operation),
        predecessor: predecessor ? serializeOperation(predecessor) : null,
      };
    });

    const terminalIds = terminalRecords.map((record) => record._id);
    const [anchoredIds, anchorIntentIds] = terminalIds.length === 0
      ? [[], []]
      : await Promise.all([
        BlockchainAnchor.distinct('idRecordId', { idRecordId: { $in: terminalIds } }),
        ChainOutbox.distinct('idRecordId', {
          idRecordId: { $in: terminalIds },
          operation: 'ANCHOR',
        }),
      ]);
    const anchoredSet = new Set(anchoredIds.map(String));
    const anchorIntentSet = new Set(anchorIntentIds.map(String));
    const unanchoredTerminalIds = terminalRecords
      .filter((record) => !anchoredSet.has(String(record._id)) && !anchorIntentSet.has(String(record._id)))
      .map((record) => ({
        idRecordId: record._id.toString(),
        recordRef: record.idNumber,
        status: record.status,
        reason: 'NEVER_ANCHORED',
        updatedAt: record.updatedAt,
      }));

    const oldest = oldestOperation
      ? {
        ...serializeOperation(oldestOperation),
        ageMs: Math.max(0, now.getTime() - new Date(oldestOperation.createdAt).getTime()),
      }
      : null;

    return res.json({
      generatedAt: now,
      counts,
      oldest,
      failed: failed.map(serializeOperation),
      blocked: blockedRows,
      alertedRevokes: alertedRevokes.map(serializeOperation),
      unanchoredTerminalIds,
      ledger: {
        status: ledgerState?.status ?? 'UNOBSERVED',
        acceptedEpoch: ledgerState?.acceptedEpoch ?? null,
        observedEpoch: ledgerState?.observedEpoch ?? null,
        paused: ledgerState?.status === 'MISMATCH',
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /blockchain/sync/:operationId/retry ─────────────────────────────────
async function retrySyncOperation(req, res, next) {
  try {
    const retried = await withMongoTransaction(async (session) => {
      const operation = await ChainOutbox.findOne({ operationId: req.params.operationId }).session(session);
      if (!operation) {
        throw httpError(404, 'NOT_FOUND', 'Blockchain synchronization operation not found.');
      }
      if (!['FAILED', 'BLOCKED'].includes(operation.state)) {
        throw httpError(
          409,
          'CHAIN_OPERATION_NOT_RETRYABLE',
          `Only FAILED or BLOCKED operations can be retried; current state is ${operation.state}.`
        );
      }

      const predecessor = await ChainOutbox.findOne({
        recordRef: operation.recordRef,
        sequence: { $lt: operation.sequence },
        state: { $ne: 'SENT' },
      }).sort({ sequence: -1 }).session(session);
      const nextState = predecessor ? 'BLOCKED' : 'PENDING';

      const updated = await ChainOutbox.findOneAndUpdate(
        { _id: operation._id, state: operation.state },
        {
          $set: {
            state: nextState,
            attempts: 0,
            nextAttempt: new Date(),
          },
          $unset: {
            lastError: '',
            alertedAt: '',
            lockOwner: '',
            lockedUntil: '',
          },
        },
        { new: true, session }
      );
      if (!updated) {
        throw httpError(409, 'CHAIN_OPERATION_STATE_CHANGED', 'The operation changed while retry was being prepared.');
      }

      return { operation: updated, predecessor };
    });

    return res.json({
      ...serializeOperation(retried.operation),
      predecessor: retried.predecessor ? serializeOperation(retried.predecessor) : null,
    });
  } catch (err) {
    next(err);
  }
}

function reconciliationFabricClient() {
  return {
    getLedgerEpoch: (...args) => ledgerReconciliation.getLedgerEpoch(...args),
    verifyIDOnChain: (...args) => blockchainService.verifyIDOnChain(...args),
  };
}

// ── POST /blockchain/reconcile ───────────────────────────────────────────────
async function reconcileBlockchain(req, res, next) {
  try {
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.toUpperCase() : '';
    if (process.env.FABRIC_ENABLED !== 'true' || !fabricConnection.isFabricConnected()) {
      throw httpError(503, 'FABRIC_UNAVAILABLE', 'Fabric must be connected before reconciliation can run.');
    }
    const fabricClient = reconciliationFabricClient();

    if (mode === 'SCAN') {
      const report = await ledgerReconciliation.scanBlockchainConsistency({ fabricClient });
      return res.json(report);
    }
    if (mode === 'APPLY') {
      const result = await ledgerReconciliation.applyBlockchainReconciliation({
        actorId: req.user.id,
        expectedObservedEpoch: req.body.expectedObservedEpoch,
        fabricClient,
      });
      return res.json(result);
    }

    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: "mode must be either 'SCAN' or 'APPLY'.",
      },
    });
  } catch (err) {
    if (err instanceof TypeError && !err.status) {
      err.status = 400;
      err.code = err.code || 'VALIDATION_ERROR';
    } else if (typeof err?.code === 'string' && err.code.startsWith('BLOCKCHAIN_RECONCILIATION_') && !err.status) {
      err.status = 409;
    }
    next(err);
  }
}

// ── GET /blockchain/anchors ──────────────────────────────────────────────────
async function listAnchors(req, res, next) {
  try {
    const anchors = await BlockchainAnchor.find().sort({ anchoredAt: -1 }).lean();
    const result = await Promise.all(anchors.map(async (a) => {
      const idRecord  = await IDRecord.findById(a.idRecordId).lean();
      const applicant = idRecord ? await Applicant.findById(idRecord.applicantId).lean() : null;
      return {
        idNumber:        a.recordRef,
        idRecordId:      a.idRecordId,
        applicantName:   applicant ? `${applicant.lastName}, ${applicant.firstName}` : '(unknown)',
        anchoredAt:      a.anchoredAt,
        lastCheckPassed: a.lastCheckPassed ?? null,
      };
    }));
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

const TAMPERABLE_FIELDS = {
  birthDate: (a) => {
    const d = new Date(a.birthdate);
    d.setDate(d.getDate() + 1);
    a.birthdate = d;
    return d.toISOString().split('T')[0];
  },
  firstName: (a) => { a.firstName = `${a.firstName}X`; return a.firstName; },
  lastName:  (a) => { a.lastName  = `${a.lastName}X`;  return a.lastName;  },
};

async function simulateTamper(req, res, next) {
  try {
    const { idNumber } = req.params;
    const field = req.query.field || 'birthDate';

    if (!TAMPERABLE_FIELDS[field]) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: `field must be one of: ${Object.keys(TAMPERABLE_FIELDS).join(', ')}` },
      });
    }

    const idRecord = await IDRecord.findOne({ idNumber });
    if (!idRecord) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ID record not found.' } });
    }
    const anchor = await BlockchainAnchor.findOne({ idRecordId: idRecord._id });
    if (!anchor) {
      return res.status(404).json({ error: { code: 'NOT_ANCHORED', message: 'This record is not anchored on-chain.' } });
    }
    const applicant = await Applicant.findById(idRecord.applicantId);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }

    const clone = applicant.toObject();
    const originalValue = field === 'birthDate'
      ? new Date(clone.birthdate).toISOString().split('T')[0]
      : clone[field];

    const tamperedValue = TAMPERABLE_FIELDS[field](clone);
    const { hash: tamperedHash } = blockchainService.computeHash(clone, idRecord);

    return res.json({
      idNumber,
      field,
      originalValue,
      tamperedValue,
      originalHash: anchor.canonicalHash,
      tamperedHash,
      match: tamperedHash === anchor.canonicalHash,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  anchorRecord,
  verifyRecord,
  getAnchorStatus,
  getHealth,
  getSyncStatus,
  retrySyncOperation,
  reconcileBlockchain,
  listAnchors,
  simulateTamper,
};
