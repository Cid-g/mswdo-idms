'use strict';

const { verifyStoredHealthSignature } = require('../crypto/signatureVerifier');
const {
  SOURCE_HEALTH_ID,
  assertStoredSourceHealthIntegrity,
  materializeSourceHealth,
  toCanonicalInstant,
} = require('../models/sourceHealth');
const { isDuplicateKeyError } = require('./verifiedRecordStore');

const DEFAULT_MAX_HEALTH_CAS_ATTEMPTS = 5;

class SourceHealthConflictError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SourceHealthConflictError';
    this.code = code;
    this.status = 409;
  }
}

function assertExistingHealthOrder(existing) {
  if (
    !existing
    || existing._id !== SOURCE_HEALTH_ID
    || !Number.isSafeInteger(existing.epoch)
    || existing.epoch < 1
    || typeof existing.sourceLastHealthyAt !== 'string'
    || Number.isNaN(Date.parse(existing.sourceLastHealthyAt))
    || new Date(existing.sourceLastHealthyAt).toISOString() !== existing.sourceLastHealthyAt
    || typeof existing.payloadDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(existing.payloadDigest)
  ) {
    throw new SourceHealthConflictError(
      'Stored source health ordering metadata is invalid and requires investigation.',
      'SOURCE_HEALTH_ORDERING_INVALID',
    );
  }
}

function decideSourceHealthApplication(existing, incoming) {
  if (!existing) return Object.freeze({ action: 'INSERT', reason: 'NO_HEALTH_STATE' });
  assertExistingHealthOrder(existing);

  if (incoming.epoch < existing.epoch) {
    throw new SourceHealthConflictError(
      'Incoming source health epoch is older than the stored epoch.',
      'STALE_SOURCE_HEALTH_EPOCH',
    );
  }
  if (incoming.epoch > existing.epoch) {
    return Object.freeze({ action: 'UPDATE', reason: 'NEWER_EPOCH' });
  }

  const incomingTime = Date.parse(incoming.sourceLastHealthyAt);
  const existingTime = Date.parse(existing.sourceLastHealthyAt);
  if (incomingTime < existingTime) {
    throw new SourceHealthConflictError(
      'Incoming source health timestamp is older than the stored heartbeat.',
      'STALE_SOURCE_HEALTH_TIMESTAMP',
    );
  }
  if (incomingTime > existingTime) {
    return Object.freeze({ action: 'UPDATE', reason: 'NEWER_HEARTBEAT' });
  }

  if (incoming.payloadDigest === existing.payloadDigest) {
    return Object.freeze({ action: 'IDEMPOTENT', reason: 'SAME_HEARTBEAT_AND_DIGEST' });
  }

  throw new SourceHealthConflictError(
    'Equal source health epoch and timestamp carry a different payload digest.',
    'SOURCE_HEALTH_DIGEST_CONFLICT',
  );
}

function sourceHealthCasFilter(existing) {
  return {
    _id: SOURCE_HEALTH_ID,
    epoch: existing.epoch,
    payloadDigest: existing.payloadDigest,
    sourceLastHealthyAt: existing.sourceLastHealthyAt,
  };
}

async function applySourceHealth({
  collection,
  integrityOptions,
  maxAttempts = DEFAULT_MAX_HEALTH_CAS_ATTEMPTS,
  receivedAt = Date.now(),
  verifiedRequest,
}) {
  if (!collection || typeof collection.findOne !== 'function') {
    throw new TypeError('A Mongo-compatible source-health collection is required.');
  }
  if (typeof collection.insertOne !== 'function' || typeof collection.findOneAndUpdate !== 'function') {
    throw new TypeError('Source-health collection must provide insertOne and findOneAndUpdate.');
  }
  if (!integrityOptions || typeof integrityOptions !== 'object') {
    throw new TypeError('integrityOptions are required.');
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new TypeError('maxAttempts must be a safe integer between 1 and 20.');
  }

  const authenticatedIncoming = verifyStoredHealthSignature({
    ...integrityOptions,
    signatureBase64: verifiedRequest?.signature,
    signedPayload: verifiedRequest?.signedPayload,
  });
  const incoming = materializeSourceHealth(authenticatedIncoming);
  const receivedAtIso = toCanonicalInstant(receivedAt, 'receivedAt');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const existing = await collection.findOne({ _id: SOURCE_HEALTH_ID });
    if (existing) assertStoredSourceHealthIntegrity(existing, integrityOptions);
    const decision = decideSourceHealthApplication(existing, incoming);

    if (decision.action === 'IDEMPOTENT') {
      return Object.freeze({
        applied: false,
        outcome: 'IDEMPOTENT',
        reason: decision.reason,
        record: existing,
      });
    }

    const updateFields = {
      ...incoming,
      receivedAt: receivedAtIso,
    };
    const storedIncoming = {
      _id: SOURCE_HEALTH_ID,
      ...updateFields,
    };

    if (decision.action === 'INSERT') {
      try {
        await collection.insertOne(storedIncoming);
        return Object.freeze({
          applied: true,
          outcome: 'INSERTED',
          reason: decision.reason,
          record: Object.freeze(storedIncoming),
        });
      } catch (error) {
        if (isDuplicateKeyError(error)) continue;
        throw error;
      }
    }

    const result = await collection.findOneAndUpdate(
      sourceHealthCasFilter(existing),
      { $set: updateFields },
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

  throw new SourceHealthConflictError(
    'Source health changed repeatedly during atomic application.',
    'SOURCE_HEALTH_CAS_EXHAUSTED',
  );
}

module.exports = {
  DEFAULT_MAX_HEALTH_CAS_ATTEMPTS,
  SourceHealthConflictError,
  applySourceHealth,
  assertExistingHealthOrder,
  decideSourceHealthApplication,
  sourceHealthCasFilter,
};
