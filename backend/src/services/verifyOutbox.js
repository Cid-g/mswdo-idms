'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const IDRecord = require('../models/IDRecord');
const VerifyOutbox = require('../models/VerifyOutbox');
const {
  canonicalize,
  digestVerificationPayload,
  validateVerificationPayload,
} = require('../lib/verificationPayload');

const OPERATION_EVENT_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
const OPERATION_QUALIFIER_PATTERN = /^[A-Za-z0-9._-]{1,96}$/;

function verificationOperationIdFor(event, idRecordId, qualifier) {
  if (typeof event !== 'string' || !OPERATION_EVENT_PATTERN.test(event)) {
    throw new TypeError('Verification operation event is invalid.');
  }

  const recordId = String(idRecordId);
  if (!/^[a-f0-9]{24}$/i.test(recordId)) {
    throw new TypeError('Verification operation ID record is invalid.');
  }

  let operationId = `verify:${event.toLowerCase()}:${recordId}`;
  if (qualifier !== undefined) {
    if (
      typeof qualifier !== 'string'
      || qualifier !== qualifier.trim()
      || !OPERATION_QUALIFIER_PATTERN.test(qualifier)
    ) {
      throw new TypeError('Verification operation qualifier is invalid.');
    }
    operationId += `:${qualifier}`;
  }

  if (operationId.length > 256) {
    throw new TypeError('Verification operation ID is too long.');
  }
  return operationId;
}

function hashQrToken(rawToken) {
  if (
    typeof rawToken !== 'string'
    || rawToken !== rawToken.trim()
    || rawToken.length < 1
    || rawToken.length > 512
    || /[\u0000-\u001f\u007f]/.test(rawToken)
  ) {
    throw new TypeError('ID record QR token is invalid.');
  }
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function immutablePayloadSnapshot(payload) {
  validateVerificationPayload(payload);
  return Object.freeze(JSON.parse(canonicalize(payload)));
}

function assertOperationMetadata({ operationId, epoch }) {
  if (
    typeof operationId !== 'string'
    || operationId !== operationId.trim()
    || operationId.length < 1
    || operationId.length > 256
    || /[\u0000-\u001f\u007f]/.test(operationId)
  ) {
    throw new TypeError('Verification operationId is invalid.');
  }
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    throw new TypeError('Verification epoch must be a positive safe integer.');
  }
}

function operationCollision(operationId) {
  const error = new Error(`Verification operation ID collision: ${operationId}`);
  error.code = 'VERIFY_OPERATION_ID_COLLISION';
  return error;
}

function assertSameImmutableCommand(existing, command) {
  const sameCommand = existing.idRecordId.toString() === command.idRecordId.toString()
    && existing.tokenHash === command.tokenHash
    && existing.epoch === command.epoch
    && existing.payloadDigest === command.payloadDigest
    && isDeepStrictEqual(existing.payload, command.payload);

  if (!sameCommand) throw operationCollision(command.operationId);
  return existing;
}

async function loadRecordTokenHash({ session, idRecordId }) {
  const idRecord = await IDRecord.findById(idRecordId)
    .select('qrToken')
    .session(session);
  if (!idRecord) {
    const error = new Error('ID record not found while enqueueing verification synchronization');
    error.code = 'VERIFY_ID_RECORD_NOT_FOUND';
    throw error;
  }
  return hashQrToken(idRecord.qrToken);
}

async function enqueueVerificationSync({
  session,
  operationId,
  idRecordId,
  payload,
  epoch,
}) {
  if (!session || !session.inTransaction()) {
    throw new Error('enqueueVerificationSync requires an active MongoDB transaction');
  }

  assertOperationMetadata({ operationId, epoch });
  const payloadSnapshot = immutablePayloadSnapshot(payload);
  const payloadDigest = digestVerificationPayload(payloadSnapshot);
  const tokenHash = await loadRecordTokenHash({ session, idRecordId });
  const command = {
    operationId,
    idRecordId,
    tokenHash,
    payload: payloadSnapshot,
    payloadDigest,
    epoch,
  };

  const existing = await VerifyOutbox.findOne({ operationId }).session(session);
  if (existing) return assertSameImmutableCommand(existing, command);

  const idRecord = await IDRecord.findOneAndUpdate(
    { _id: idRecordId },
    { $inc: { verifyRevision: 1 } },
    { new: true, session }
  );
  if (!idRecord) {
    const error = new Error('ID record not found while allocating verification revision');
    error.code = 'VERIFY_ID_RECORD_NOT_FOUND';
    throw error;
  }

  const revision = idRecord.verifyRevision;
  const [created] = await VerifyOutbox.create([{
    ...command,
    revision,
  }], { session });

  return created;
}

module.exports = {
  enqueueVerificationSync,
  hashQrToken,
  immutablePayloadSnapshot,
  verificationOperationIdFor,
};
