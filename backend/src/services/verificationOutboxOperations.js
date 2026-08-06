'use strict';

const mongoose = require('mongoose');

const Applicant = require('../models/Applicant');
const AuditLog = require('../models/AuditLog');
const BlockchainAnchor = require('../models/BlockchainAnchor');
const IDRecord = require('../models/IDRecord');
const VerifyOutbox = require('../models/VerifyOutbox');
const { withMongoTransaction } = require('../lib/transactions');
const { buildVerificationPayload } = require('./verificationProjection');
const {
  enqueueVerificationSync,
  verificationOperationIdFor,
} = require('./verifyOutbox');

const DEFAULT_STATUS_ROW_LIMIT = 25;
const OPERATION_ID_PATTERN = /^verify:([a-z][a-z0-9_]{0,31}):([a-f0-9]{24})(?::[A-Za-z0-9._-]{1,96})?$/i;
const OPERATION_REF_PATTERN = /^[a-f0-9]{24}$/i;
const RESYNC_REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{7,63}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

class VerificationOutboxOperationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'VerificationOutboxOperationError';
    this.status = status;
    this.code = code;
  }
}

function requireDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${name} must be a valid Date.`);
  }
}

function requireLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new TypeError('Verification status row limit must be between 1 and 100.');
  }
}

function normalizeOperationRef(value) {
  if (typeof value !== 'string' || !OPERATION_REF_PATTERN.test(value)) {
    throw new VerificationOutboxOperationError(
      400,
      'INVALID_VERIFICATION_OPERATION_REF',
      'Verification operation reference must be a 24-character hexadecimal identifier.'
    );
  }
  return new mongoose.Types.ObjectId(value).toString();
}

function normalizeIdRecordRef(value) {
  if (typeof value !== 'string' || !OPERATION_REF_PATTERN.test(value)) {
    throw new VerificationOutboxOperationError(
      400,
      'INVALID_ID_RECORD_REF',
      'ID record reference must be a 24-character hexadecimal identifier.'
    );
  }
  return new mongoose.Types.ObjectId(value).toString();
}

function normalizeResyncRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new VerificationOutboxOperationError(
      400,
      'INVALID_VERIFICATION_RESYNC_REQUEST',
      'Verification resynchronization request must be a JSON object.'
    );
  }
  const fields = Object.keys(body).sort();
  if (fields.length !== 1 || fields[0] !== 'requestId') {
    throw new VerificationOutboxOperationError(
      400,
      'INVALID_VERIFICATION_RESYNC_REQUEST',
      'Verification resynchronization request must contain only requestId.'
    );
  }
  if (typeof body.requestId !== 'string' || !RESYNC_REQUEST_ID_PATTERN.test(body.requestId)) {
    throw new VerificationOutboxOperationError(
      400,
      'INVALID_VERIFICATION_RESYNC_REQUEST_ID',
      'requestId must be 8 to 64 lowercase letters, numbers, dots, underscores, or hyphens.'
    );
  }
  return Object.freeze({ requestId: body.requestId });
}

function verificationEpoch(env = process.env) {
  const raw = env.VERIFY_EPOCH ?? '1';
  const epoch = Number(raw);
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    const error = new Error('VERIFY_EPOCH must be a positive safe integer.');
    error.code = 'VERIFY_CONFIGURATION_INVALID';
    throw error;
  }
  return epoch;
}

function requireSuperadminActor(actor) {
  if (!actor || typeof actor !== 'object') {
    throw new TypeError('Authenticated verification operations actor is required.');
  }
  if (actor.role !== 'SUPERADMIN') {
    throw new VerificationOutboxOperationError(
      403,
      'FORBIDDEN',
      'Verification synchronization recovery is restricted to SUPERADMIN.'
    );
  }
  if (typeof actor.id !== 'string' || !OPERATION_REF_PATTERN.test(actor.id)) {
    throw new TypeError('Authenticated verification operations actor ID is invalid.');
  }
  return Object.freeze({
    id: new mongoose.Types.ObjectId(actor.id),
    department: typeof actor.department === 'string' ? actor.department : null,
  });
}

function operationEvent(operationId) {
  if (typeof operationId !== 'string') return 'UNKNOWN';
  const match = OPERATION_ID_PATTERN.exec(operationId);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}

function safeFailureClassification(summary, { required = false } = {}) {
  if (typeof summary !== 'string' || summary.trim() === '') {
    return required
      ? Object.freeze({ code: 'VERIFY_SYNC_UNKNOWN_FAILURE', remoteCode: null, status: null })
      : null;
  }

  let code = null;
  let remoteCode = null;
  let status = null;
  for (const part of summary.trim().split(/\s+/)) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (key === 'code' && ERROR_CODE_PATTERN.test(value)) code = value;
    if (key === 'remoteCode' && ERROR_CODE_PATTERN.test(value)) remoteCode = value;
    if (key === 'status' && /^(?:[1-5][0-9]{2})$/.test(value)) status = Number(value);
  }

  return Object.freeze({
    code: code || 'VERIFY_SYNC_UNKNOWN_FAILURE',
    remoteCode,
    status,
  });
}

function leaseState(operation, now) {
  if (operation?.state !== 'PROCESSING') return null;
  const lockedUntil = operation.lockedUntil instanceof Date
    ? operation.lockedUntil
    : operation.lockedUntil
      ? new Date(operation.lockedUntil)
      : null;
  if (!lockedUntil || Number.isNaN(lockedUntil.getTime())) {
    return Object.freeze({ state: 'MISSING', lockedUntil: null });
  }
  return Object.freeze({
    state: lockedUntil.getTime() <= now.getTime() ? 'EXPIRED' : 'ACTIVE',
    lockedUntil,
  });
}

function serializeVerificationOperation(operation, { now }) {
  requireDate(now, 'now');
  if (!operation || typeof operation !== 'object') {
    throw new TypeError('Verification operation is required.');
  }

  return Object.freeze({
    operationRef: operation._id?.toString?.() ?? null,
    event: operationEvent(operation.operationId),
    idRecordId: operation.idRecordId?.toString?.() ?? null,
    epoch: operation.epoch,
    revision: operation.revision,
    state: operation.state,
    attempts: operation.attempts,
    nextAttempt: operation.nextAttempt ?? null,
    failure: safeFailureClassification(operation.lastError, {
      required: operation.state === 'FAILED',
    }),
    lease: leaseState(operation, now),
    createdAt: operation.createdAt ?? null,
    updatedAt: operation.updatedAt ?? null,
  });
}

function staleProcessingQuery(now) {
  requireDate(now, 'now');
  return {
    state: 'PROCESSING',
    $or: [
      { lockedUntil: { $lte: now } },
      { lockedUntil: { $exists: false } },
      { lockedUntil: null },
    ],
  };
}

function withAge(operation, now) {
  if (!operation) return null;
  const serialized = serializeVerificationOperation(operation, { now });
  const createdAt = new Date(operation.createdAt);
  const ageMs = Number.isNaN(createdAt.getTime())
    ? null
    : Math.max(0, now.getTime() - createdAt.getTime());
  return Object.freeze({ ...serialized, ageMs });
}

function withLeaseOverdue(operation, now) {
  const serialized = serializeVerificationOperation(operation, { now });
  const lockedUntil = serialized.lease?.lockedUntil;
  const fallback = new Date(operation.updatedAt ?? operation.createdAt);
  const reference = lockedUntil instanceof Date && !Number.isNaN(lockedUntil.getTime())
    ? lockedUntil
    : fallback;
  const overdueMs = reference instanceof Date && !Number.isNaN(reference.getTime())
    ? Math.max(0, now.getTime() - reference.getTime())
    : null;
  return Object.freeze({ ...serialized, overdueMs });
}

async function buildVerificationSyncStatus({
  now = new Date(),
  rowLimit = DEFAULT_STATUS_ROW_LIMIT,
} = {}) {
  requireDate(now, 'now');
  requireLimit(rowLimit);

  const staleQuery = staleProcessingQuery(now);
  const [
    pendingCount,
    processingCount,
    failedCount,
    sentCount,
    oldestUndelivered,
    staleCount,
    staleRows,
    failedRows,
  ] = await Promise.all([
    VerifyOutbox.countDocuments({ state: 'PENDING' }),
    VerifyOutbox.countDocuments({ state: 'PROCESSING' }),
    VerifyOutbox.countDocuments({ state: 'FAILED' }),
    VerifyOutbox.countDocuments({ state: 'SENT' }),
    VerifyOutbox.findOne({ state: { $ne: 'SENT' } })
      .sort({ createdAt: 1, epoch: 1, revision: 1, _id: 1 })
      .lean(),
    VerifyOutbox.countDocuments(staleQuery),
    VerifyOutbox.find(staleQuery)
      .sort({ lockedUntil: 1, createdAt: 1, _id: 1 })
      .limit(rowLimit)
      .lean(),
    VerifyOutbox.find({ state: 'FAILED' })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(rowLimit)
      .lean(),
  ]);

  const counts = {
    PENDING: pendingCount,
    PROCESSING: processingCount,
    FAILED: failedCount,
    SENT: sentCount,
  };

  return Object.freeze({
    generatedAt: now,
    counts: Object.freeze(counts),
    undeliveredCount: counts.PENDING + counts.PROCESSING + counts.FAILED,
    oldestUndelivered: withAge(oldestUndelivered, now),
    staleProcessing: Object.freeze({
      count: staleCount,
      items: Object.freeze(staleRows.map((row) => withLeaseOverdue(row, now))),
    }),
    recentFailures: Object.freeze({
      count: counts.FAILED,
      items: Object.freeze(failedRows.map((row) => serializeVerificationOperation(row, { now }))),
    }),
  });
}

async function retryFailedVerificationOperation({
  operationRef,
  actor,
  now = new Date(),
}) {
  const normalizedRef = normalizeOperationRef(operationRef);
  const normalizedActor = requireSuperadminActor(actor);
  requireDate(now, 'now');

  return withMongoTransaction(async (session) => {
    const operation = await VerifyOutbox.findById(normalizedRef).session(session);
    if (!operation) {
      throw new VerificationOutboxOperationError(
        404,
        'VERIFICATION_OPERATION_NOT_FOUND',
        'Verification synchronization operation was not found.'
      );
    }
    if (operation.state !== 'FAILED') {
      throw new VerificationOutboxOperationError(
        409,
        'VERIFICATION_OPERATION_NOT_RETRYABLE',
        `Only FAILED verification synchronization operations can be retried; current state is ${operation.state}.`
      );
    }

    const event = operationEvent(operation.operationId);
    const failure = safeFailureClassification(operation.lastError, { required: true });
    const previousAttempts = operation.attempts;
    const updated = await VerifyOutbox.findOneAndUpdate(
      { _id: operation._id, state: 'FAILED' },
      {
        $set: {
          state: 'PENDING',
          nextAttempt: now,
        },
        $unset: {
          lastError: '',
          lockOwner: '',
          lockedUntil: '',
        },
      },
      { new: true, session }
    );
    if (!updated) {
      throw new VerificationOutboxOperationError(
        409,
        'VERIFICATION_OPERATION_STATE_CHANGED',
        'Verification synchronization operation changed while retry was being prepared.'
      );
    }

    await AuditLog.create([{
      userId: normalizedActor.id,
      action: 'VERIFICATION_SYNC_RETRY_QUEUED',
      department: normalizedActor.department,
      targetType: 'VerifyOutbox',
      targetId: operation._id.toString(),
      description: `Verification synchronization retry queued for ${event} revision ${operation.revision}.`,
      metadata: {
        operationRef: operation._id.toString(),
        event,
        epoch: operation.epoch,
        revision: operation.revision,
        previousState: 'FAILED',
        previousAttempts,
        failure,
      },
    }], { session });

    return Object.freeze({
      retried: true,
      operation: serializeVerificationOperation(updated, { now }),
    });
  });
}

function mapResyncEnqueueError(error) {
  if (error?.code === 'VERIFY_OPERATION_ID_COLLISION') {
    return new VerificationOutboxOperationError(
      409,
      'VERIFICATION_RESYNC_REQUEST_CONFLICT',
      'requestId was already used for a different verification projection.'
    );
  }
  if (error?.code === 'VERIFY_ID_RECORD_NOT_FOUND') {
    return new VerificationOutboxOperationError(
      404,
      'ID_RECORD_NOT_FOUND',
      'ID record was not found.'
    );
  }
  return error;
}

function buildCurrentResyncProjection({ applicant, idRecord, anchor }) {
  try {
    return buildVerificationPayload({ applicant, idRecord, anchor });
  } catch (error) {
    if (error?.name !== 'VerificationPayloadValidationError' && !(error instanceof TypeError)) {
      throw error;
    }
    throw new VerificationOutboxOperationError(
      409,
      'VERIFICATION_RESYNC_SOURCE_INVALID',
      'Current local record cannot produce a valid verification projection.'
    );
  }
}

async function queueFullRecordResynchronization({
  idRecordRef,
  request,
  actor,
  now = new Date(),
  epoch = verificationEpoch(),
}) {
  const normalizedRecordRef = normalizeIdRecordRef(idRecordRef);
  const normalizedRequest = normalizeResyncRequest(request);
  const normalizedActor = requireSuperadminActor(actor);
  requireDate(now, 'now');
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    throw new TypeError('Verification resynchronization epoch must be a positive safe integer.');
  }

  const operationId = verificationOperationIdFor(
    'RESYNC',
    normalizedRecordRef,
    normalizedRequest.requestId
  );

  return withMongoTransaction(async (session) => {
    const idRecord = await IDRecord.findById(normalizedRecordRef).session(session);
    if (!idRecord) {
      throw new VerificationOutboxOperationError(
        404,
        'ID_RECORD_NOT_FOUND',
        'ID record was not found.'
      );
    }

    const [applicant, anchor, existingOperation, latestHistory] = await Promise.all([
      Applicant.findById(idRecord.applicantId).session(session),
      BlockchainAnchor.findOne({ idRecordId: idRecord._id }).session(session),
      VerifyOutbox.findOne({ operationId }).session(session),
      VerifyOutbox.findOne({ idRecordId: idRecord._id })
        .sort({ revision: -1, epoch: -1, _id: -1 })
        .session(session),
    ]);

    if (!applicant) {
      throw new VerificationOutboxOperationError(
        409,
        'VERIFICATION_RESYNC_SOURCE_INCOMPLETE',
        'The ID record no longer has its required local applicant source.'
      );
    }
    if (!latestHistory) {
      throw new VerificationOutboxOperationError(
        409,
        'VERIFICATION_RESYNC_HISTORY_REQUIRED',
        'Full-record resynchronization requires existing verification history.'
      );
    }
    if (idRecord.verifyRevision !== latestHistory.revision) {
      throw new VerificationOutboxOperationError(
        409,
        'VERIFICATION_RESYNC_HISTORY_INCONSISTENT',
        'Local verification revision does not match the latest durable outbox revision.'
      );
    }

    const otherUndelivered = await VerifyOutbox.findOne({
      idRecordId: idRecord._id,
      state: { $ne: 'SENT' },
      ...(existingOperation ? { _id: { $ne: existingOperation._id } } : {}),
    }).session(session);
    if (otherUndelivered) {
      throw new VerificationOutboxOperationError(
        409,
        'VERIFICATION_RESYNC_BLOCKED_BY_UNDELIVERED',
        'Resolve existing undelivered verification work before requesting a full-record resynchronization.'
      );
    }

    const projection = buildCurrentResyncProjection({ applicant, idRecord, anchor });
    const previousRevision = idRecord.verifyRevision;
    let queued;
    try {
      queued = await enqueueVerificationSync({
        session,
        operationId,
        idRecordId: idRecord._id,
        payload: projection,
        epoch,
      });
    } catch (error) {
      throw mapResyncEnqueueError(error);
    }

    const created = !existingOperation;
    if (created) {
      await AuditLog.create([{
        userId: normalizedActor.id,
        action: 'VERIFICATION_SYNC_RESYNC_QUEUED',
        department: normalizedActor.department,
        targetType: 'IDRecord',
        targetId: idRecord._id.toString(),
        description: `Authoritative verification resynchronization queued as revision ${queued.revision}.`,
        metadata: {
          operationRef: queued._id.toString(),
          event: 'RESYNC',
          requestId: normalizedRequest.requestId,
          epoch: queued.epoch,
          revision: queued.revision,
          previousRevision,
          sourceStatus: idRecord.status,
          anchorIncluded: projection.txId !== null,
        },
      }], { session });
    }

    return Object.freeze({
      queued: created,
      idempotent: !created,
      operation: serializeVerificationOperation(queued, { now }),
    });
  });
}

module.exports = {
  DEFAULT_STATUS_ROW_LIMIT,
  VerificationOutboxOperationError,
  buildVerificationSyncStatus,
  normalizeIdRecordRef,
  normalizeOperationRef,
  normalizeResyncRequest,
  operationEvent,
  queueFullRecordResynchronization,
  requireSuperadminActor,
  retryFailedVerificationOperation,
  safeFailureClassification,
  serializeVerificationOperation,
  staleProcessingQuery,
  verificationEpoch,
};
