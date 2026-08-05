'use strict';

const {
  canonicalize,
  deepFreeze,
  parseCanonicalRecordEnvelope,
} = require('../crypto/canonicalEnvelope');
const { verifyStoredRecordSignature } = require('../crypto/signatureVerifier');
const { validateRecordPayload } = require('../domain/recordPayload');

const VERIFIED_RECORD_COLLECTION = 'verified_records';
const VERIFIED_RECORD_INDEXES = Object.freeze([
  Object.freeze({ key: Object.freeze({ tokenHash: 1 }), options: Object.freeze({ name: 'uniq_token_hash', unique: true }) }),
  Object.freeze({ key: Object.freeze({ status: 1 }), options: Object.freeze({ name: 'status_1' }) }),
]);

const STORED_RECORD_METADATA_FIELDS = Object.freeze(['_id', 'createdAt', 'updatedAt']);

const MATERIALIZED_RECORD_FIELDS = Object.freeze([
  'anchoredAt',
  'anchoredHash',
  'blockNumber',
  'epoch',
  'expiryDate',
  'idNumber',
  'idType',
  'issuedDate',
  'keyId',
  'maskedName',
  'payloadDigest',
  'releasedAt',
  'revision',
  'signature',
  'signedPayload',
  'status',
  'syncedAt',
  'tokenHash',
  'txId',
]);

class StoredRecordIntegrityError extends Error {
  constructor(message, code = 'STORED_RECORD_INTEGRITY_FAILED') {
    super(message);
    this.name = 'StoredRecordIntegrityError';
    this.code = code;
    this.status = 503;
  }
}

function materializeVerifiedRecord(verifiedRequest) {
  if (!verifiedRequest || typeof verifiedRequest !== 'object') {
    throw new TypeError('verifiedRequest is required.');
  }

  const { signature, signedPayload } = verifiedRequest;
  if (typeof signature !== 'string' || typeof signedPayload !== 'string') {
    throw new TypeError('verifiedRequest must contain signature and signedPayload.');
  }

  // Re-parse the exact signed bytes at the materialization boundary. A caller-supplied
  // parsed envelope is never an independent source of record fields.
  const envelope = parseCanonicalRecordEnvelope(signedPayload);
  const payload = validateRecordPayload(envelope.payload);
  const syncedAt = new Date(envelope.timestamp);
  if (Number.isNaN(syncedAt.getTime()) || syncedAt.getTime() !== envelope.timestamp) {
    throw new TypeError('Signed envelope timestamp cannot be materialized.');
  }

  return deepFreeze({
    ...payload,
    epoch: envelope.epoch,
    keyId: envelope.keyId,
    payloadDigest: envelope.payloadDigest,
    revision: envelope.revision,
    signature,
    signedPayload,
    syncedAt: syncedAt.toISOString(),
    tokenHash: envelope.tokenHash,
  });
}

function comparableRecord(record) {
  const comparable = {};
  for (const field of MATERIALIZED_RECORD_FIELDS) comparable[field] = record[field];
  return comparable;
}

function assertNoUnexpectedStoredFields(record) {
  const allowed = new Set([...MATERIALIZED_RECORD_FIELDS, ...STORED_RECORD_METADATA_FIELDS]);
  const unexpected = Object.keys(record).filter((field) => !allowed.has(field));
  if (unexpected.length) {
    throw new StoredRecordIntegrityError(
      `Stored verification record contains unexpected fields: ${unexpected.sort().join(', ')}.`,
      'STORED_RECORD_UNEXPECTED_FIELDS',
    );
  }
}

function assertStoredRecordIntegrity(record, {
  audience,
  path,
  publicKeys,
} = {}) {
  if (!record || typeof record !== 'object') {
    throw new StoredRecordIntegrityError('Stored verification record is missing.');
  }
  assertNoUnexpectedStoredFields(record);

  let verified;
  try {
    verified = verifyStoredRecordSignature({
      audience,
      path,
      publicKeys,
      signatureBase64: record.signature,
      signedPayload: record.signedPayload,
    });
  } catch (error) {
    throw new StoredRecordIntegrityError(
      `Stored signed record could not be verified: ${error.code || error.message}`,
      'STORED_RECORD_SIGNATURE_INVALID',
    );
  }

  let expected;
  try {
    expected = materializeVerifiedRecord(verified);
  } catch (error) {
    throw new StoredRecordIntegrityError(
      `Stored signed record payload is invalid: ${error.code || error.message}`,
      'STORED_RECORD_PAYLOAD_INVALID',
    );
  }

  let actualCanonical;
  let expectedCanonical;
  try {
    actualCanonical = canonicalize(comparableRecord(record));
    expectedCanonical = canonicalize(comparableRecord(expected));
  } catch (error) {
    throw new StoredRecordIntegrityError(
      `Stored materialized record is malformed: ${error.message}`,
      'STORED_RECORD_MATERIALIZATION_INVALID',
    );
  }

  if (actualCanonical !== expectedCanonical) {
    throw new StoredRecordIntegrityError(
      'Stored materialized fields do not match the signed envelope.',
      'STORED_RECORD_MATERIALIZATION_MISMATCH',
    );
  }

  return expected;
}

module.exports = {
  MATERIALIZED_RECORD_FIELDS,
  STORED_RECORD_METADATA_FIELDS,
  VERIFIED_RECORD_COLLECTION,
  VERIFIED_RECORD_INDEXES,
  StoredRecordIntegrityError,
  assertNoUnexpectedStoredFields,
  assertStoredRecordIntegrity,
  comparableRecord,
  materializeVerifiedRecord,
};
