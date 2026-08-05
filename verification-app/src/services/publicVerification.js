'use strict';

const { createHash } = require('node:crypto');
const {
  assertStoredRecordIntegrity,
} = require('../models/verifiedRecord');
const {
  SOURCE_HEALTH_ID,
  assertStoredSourceHealthIntegrity,
} = require('../models/sourceHealth');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_TYPE_LABELS = Object.freeze({
  PWD: 'Person with Disability (PWD)',
  SOLO_PARENT: 'Solo Parent',
  SENIOR_CITIZEN: 'Senior Citizen',
});

class PublicVerificationError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'PublicVerificationError';
    this.code = code;
    this.status = status;
  }
}

function normalizeVerificationToken(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new PublicVerificationError(
      'Verification token must be a valid UUID.',
      'INVALID_VERIFICATION_TOKEN',
      400,
    );
  }
  return value.toLowerCase();
}

function hashVerificationToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function assertCurrentTime(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('now() must return a positive safe integer timestamp.');
  }
  return value;
}

function isExpiredAtReadTime(expiryDate, nowMs) {
  if (expiryDate === null) return false;
  const expiryInstant = Date.parse(`${expiryDate}T00:00:00.000Z`);
  if (!Number.isSafeInteger(expiryInstant)) {
    throw new PublicVerificationError(
      'Stored expiry date cannot be evaluated.',
      'VERIFICATION_RECORD_EXPIRY_INVALID',
      503,
    );
  }
  return nowMs > expiryInstant;
}

function effectiveStatus(record, nowMs) {
  if (record.status === 'ACTIVE' && isExpiredAtReadTime(record.expiryDate, nowMs)) {
    return 'EXPIRED';
  }
  return record.status;
}

function issuanceAnchor(record) {
  const anchored = record.anchoredHash !== null;
  return Object.freeze({
    anchored,
    txId: anchored ? record.txId : null,
    blockNumber: anchored ? record.blockNumber : null,
    anchoredAt: anchored ? record.anchoredAt : null,
  });
}

function sourceHealthState(record, sourceHealth, nowMs, maxSyncAgeMs) {
  if (!sourceHealth) {
    return Object.freeze({ fresh: false, sourceLastHealthyAt: null });
  }

  const sourceLastHealthyMs = Date.parse(sourceHealth.sourceLastHealthyAt);
  if (!Number.isSafeInteger(sourceLastHealthyMs)) {
    throw new PublicVerificationError(
      'Stored source-health timestamp cannot be evaluated.',
      'SOURCE_HEALTH_TIMESTAMP_INVALID',
      503,
    );
  }

  const sameEpoch = sourceHealth.epoch === record.epoch;
  const ageMs = nowMs - sourceLastHealthyMs;
  return Object.freeze({
    fresh: sameEpoch && ageMs <= maxSyncAgeMs,
    sourceLastHealthyAt: sourceHealth.sourceLastHealthyAt,
  });
}

function publicResultBody({
  record,
  sourceHealth,
  nowMs,
  maxSyncAgeMs,
}) {
  const status = effectiveStatus(record, nowMs);
  const health = sourceHealthState(record, sourceHealth, nowMs, maxSyncAgeMs);
  let result;
  let valid;
  let message;

  if (status === 'REVOKED') {
    result = 'NOT_VALID';
    valid = false;
    message = 'This ID has been officially revoked.';
  } else if (status === 'EXPIRED') {
    result = 'NOT_VALID';
    valid = false;
    message = 'This ID has expired.';
  } else if (health.fresh) {
    result = 'VALID';
    valid = true;
    message = 'This ID is active and current.';
  } else {
    result = 'UNKNOWN';
    valid = null;
    message = 'Current status cannot be confirmed. Contact MSWDO.';
  }

  return Object.freeze({
    result,
    valid,
    status,
    idType: record.idType,
    idTypeLabel: ID_TYPE_LABELS[record.idType] || record.idType,
    idNumber: record.idNumber,
    maskedName: record.maskedName,
    issuedDate: record.issuedDate,
    expiryDate: record.expiryDate,
    releasedAt: record.releasedAt,
    issuanceAnchor: issuanceAnchor(record),
    syncedAt: record.syncedAt,
    sourceLastHealthyAt: health.sourceLastHealthyAt,
    verifiedAt: new Date(nowMs).toISOString(),
    message,
  });
}

async function verifyPublicToken({
  collection,
  healthCollection,
  maxSyncAgeMs,
  now = Date.now,
  publicKeys,
  rawToken,
  recordAudience,
  recordPath,
  healthAudience = recordAudience,
  healthPath,
}) {
  if (!collection || typeof collection.findOne !== 'function') {
    throw new TypeError('A Mongo-compatible verified-record collection is required.');
  }
  if (!healthCollection || typeof healthCollection.findOne !== 'function') {
    throw new TypeError('A Mongo-compatible source-health collection is required.');
  }
  if (!Number.isSafeInteger(maxSyncAgeMs) || maxSyncAgeMs < 1) {
    throw new TypeError('maxSyncAgeMs must be a positive safe integer.');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function.');

  const currentTime = assertCurrentTime(now());
  const normalizedToken = normalizeVerificationToken(rawToken);
  const tokenHash = hashVerificationToken(normalizedToken);
  const storedRecord = await collection.findOne({ tokenHash });

  if (!storedRecord) {
    return Object.freeze({
      found: false,
      statusCode: 404,
      body: Object.freeze({
        result: 'NOT_FOUND',
        valid: false,
        status: null,
        message: 'No ID record matches this QR code.',
        verifiedAt: new Date(currentTime).toISOString(),
      }),
    });
  }

  const record = assertStoredRecordIntegrity(storedRecord, {
    audience: recordAudience,
    path: recordPath,
    publicKeys,
  });

  const storedHealth = await healthCollection.findOne({ _id: SOURCE_HEALTH_ID });
  const sourceHealth = storedHealth
    ? assertStoredSourceHealthIntegrity(storedHealth, {
      audience: healthAudience,
      path: healthPath,
      publicKeys,
    })
    : null;

  return Object.freeze({
    found: true,
    statusCode: 200,
    body: publicResultBody({
      maxSyncAgeMs,
      nowMs: currentTime,
      record,
      sourceHealth,
    }),
  });
}

module.exports = {
  ID_TYPE_LABELS,
  PublicVerificationError,
  UUID_PATTERN,
  assertCurrentTime,
  effectiveStatus,
  hashVerificationToken,
  isExpiredAtReadTime,
  issuanceAnchor,
  normalizeVerificationToken,
  publicResultBody,
  sourceHealthState,
  verifyPublicToken,
};
