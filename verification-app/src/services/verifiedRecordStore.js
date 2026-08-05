'use strict';

const { verifyStoredRecordSignature } = require('../crypto/signatureVerifier');
const {
  VERIFIED_RECORD_INDEXES,
  assertStoredRecordIntegrity,
  materializeVerifiedRecord,
} = require('../models/verifiedRecord');

const DEFAULT_MAX_CAS_ATTEMPTS = 5;

class VerifiedRecordConflictError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'VerifiedRecordConflictError';
    this.code = code;
    this.status = 409;
  }
}

function assertExistingOrderFields(existing) {
  if (
    !existing
    || !Number.isSafeInteger(existing.epoch)
    || existing.epoch < 1
    || !Number.isSafeInteger(existing.revision)
    || existing.revision < 1
    || typeof existing.payloadDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(existing.payloadDigest)
    || !['ACTIVE', 'REVOKED', 'EXPIRED'].includes(existing.status)
  ) {
    throw new VerifiedRecordConflictError(
      'Stored record ordering metadata is invalid and requires investigation.',
      'STORED_RECORD_ORDERING_INVALID',
    );
  }
}

function decideRecordApplication(existing, incoming) {
  if (!existing) return Object.freeze({ action: 'INSERT', reason: 'NEW_TOKEN' });
  assertExistingOrderFields(existing);

  if (existing.tokenHash !== incoming.tokenHash) {
    throw new VerifiedRecordConflictError(
      'Stored and incoming token hashes do not match.',
      'TOKEN_HASH_MISMATCH',
    );
  }

  if (existing.status === 'REVOKED' && incoming.status !== 'REVOKED') {
    throw new VerifiedRecordConflictError(
      'A revoked token is terminal and cannot transition to another state.',
      'TERMINAL_REVOKED_RECORD',
    );
  }

  if (incoming.epoch < existing.epoch) {
    throw new VerifiedRecordConflictError(
      'Incoming verification epoch is older than the stored epoch.',
      'STALE_VERIFICATION_EPOCH',
    );
  }
  if (incoming.epoch > existing.epoch) {
    return Object.freeze({ action: 'UPDATE', reason: 'NEWER_EPOCH' });
  }

  if (incoming.revision < existing.revision) {
    throw new VerifiedRecordConflictError(
      'Incoming verification revision is older than the stored revision.',
      'STALE_VERIFICATION_REVISION',
    );
  }
  if (incoming.revision > existing.revision) {
    return Object.freeze({ action: 'UPDATE', reason: 'NEWER_REVISION' });
  }

  if (incoming.payloadDigest === existing.payloadDigest) {
    return Object.freeze({ action: 'IDEMPOTENT', reason: 'SAME_REVISION_AND_DIGEST' });
  }

  throw new VerifiedRecordConflictError(
    'Equal epoch and revision carry a different payload digest.',
    'EQUAL_REVISION_DIGEST_CONFLICT',
  );
}


async function ensureVerifiedRecordIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') {
    throw new TypeError('Collection must provide createIndex.');
  }

  const names = [];
  for (const index of VERIFIED_RECORD_INDEXES) {
    names.push(await collection.createIndex({ ...index.key }, { ...index.options }));
  }
  return Object.freeze(names);
}

function isDuplicateKeyError(error) {
  return error?.code === 11000 || error?.code === 11001;
}

function casFilterFor(existing) {
  const filter = {
    tokenHash: existing.tokenHash,
    epoch: existing.epoch,
    revision: existing.revision,
    payloadDigest: existing.payloadDigest,
    status: existing.status,
  };
  if (existing._id !== undefined) filter._id = existing._id;
  return filter;
}

async function applyVerifiedRecord({
  collection,
  integrityOptions,
  verifiedRequest,
  maxAttempts = DEFAULT_MAX_CAS_ATTEMPTS,
}) {
  if (!collection || typeof collection.findOne !== 'function') {
    throw new TypeError('A Mongo-compatible collection is required.');
  }
  if (
    typeof collection.insertOne !== 'function'
    || typeof collection.findOneAndUpdate !== 'function'
  ) {
    throw new TypeError('Collection must provide insertOne and findOneAndUpdate.');
  }
  if (!integrityOptions || typeof integrityOptions !== 'object') {
    throw new TypeError('integrityOptions are required to authenticate existing stored state.');
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new TypeError('maxAttempts must be a safe integer between 1 and 20.');
  }

  if (!verifiedRequest || typeof verifiedRequest !== 'object') {
    throw new TypeError('verifiedRequest is required.');
  }
  const authenticatedIncoming = verifyStoredRecordSignature({
    ...integrityOptions,
    signatureBase64: verifiedRequest.signature,
    signedPayload: verifiedRequest.signedPayload,
  });
  const incoming = materializeVerifiedRecord(authenticatedIncoming);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const existing = await collection.findOne({ tokenHash: incoming.tokenHash });
    if (existing) assertStoredRecordIntegrity(existing, integrityOptions);
    const decision = decideRecordApplication(existing, incoming);

    if (decision.action === 'IDEMPOTENT') {
      return Object.freeze({
        applied: false,
        outcome: 'IDEMPOTENT',
        reason: decision.reason,
        record: existing,
      });
    }

    if (decision.action === 'INSERT') {
      try {
        const result = await collection.insertOne({ ...incoming });
        return Object.freeze({
          applied: true,
          outcome: 'INSERTED',
          reason: decision.reason,
          record: Object.freeze({ ...incoming, _id: result.insertedId }),
        });
      } catch (error) {
        if (isDuplicateKeyError(error)) continue;
        throw error;
      }
    }

    const result = await collection.findOneAndUpdate(
      casFilterFor(existing),
      { $set: { ...incoming } },
      { returnDocument: 'after' },
    );
    const updated = result && Object.prototype.hasOwnProperty.call(result, 'value')
      ? result.value
      : result;
    if (updated) {
      return Object.freeze({
        applied: true,
        outcome: 'UPDATED',
        reason: decision.reason,
        record: updated,
      });
    }
  }

  throw new VerifiedRecordConflictError(
    'Verification record changed repeatedly during atomic application.',
    'VERIFICATION_RECORD_CAS_EXHAUSTED',
  );
}

module.exports = {
  DEFAULT_MAX_CAS_ATTEMPTS,
  VerifiedRecordConflictError,
  applyVerifiedRecord,
  assertExistingOrderFields,
  casFilterFor,
  decideRecordApplication,
  ensureVerifiedRecordIndexes,
  isDuplicateKeyError,
};
