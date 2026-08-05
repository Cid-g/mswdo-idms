'use strict';

const {
  canonicalize,
  deepFreeze,
  parseCanonicalHealthEnvelope,
} = require('../crypto/canonicalEnvelope');
const { verifyStoredHealthSignature } = require('../crypto/signatureVerifier');

const SOURCE_HEALTH_COLLECTION = 'source_health';
const SOURCE_HEALTH_ID = 'office-source';
const SOURCE_HEALTH_FIELDS = Object.freeze([
  'epoch',
  'keyId',
  'payloadDigest',
  'signature',
  'signedPayload',
  'sourceLastHealthyAt',
]);
const SOURCE_HEALTH_METADATA_FIELDS = Object.freeze(['_id', 'receivedAt']);

class SourceHealthIntegrityError extends Error {
  constructor(message, code = 'SOURCE_HEALTH_INTEGRITY_FAILED') {
    super(message);
    this.name = 'SourceHealthIntegrityError';
    this.code = code;
    this.status = 503;
  }
}

function toCanonicalInstant(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer timestamp.`);
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime()) || instant.getTime() !== value) {
    throw new TypeError(`${label} cannot be represented as a UTC instant.`);
  }
  return instant.toISOString();
}

function materializeSourceHealth(verifiedRequest) {
  if (!verifiedRequest || typeof verifiedRequest !== 'object') {
    throw new TypeError('verifiedRequest is required.');
  }
  const { signature, signedPayload } = verifiedRequest;
  if (typeof signature !== 'string' || typeof signedPayload !== 'string') {
    throw new TypeError('verifiedRequest must contain signature and signedPayload.');
  }

  const envelope = parseCanonicalHealthEnvelope(signedPayload);
  return deepFreeze({
    epoch: envelope.epoch,
    keyId: envelope.keyId,
    payloadDigest: envelope.payloadDigest,
    signature,
    signedPayload,
    sourceLastHealthyAt: toCanonicalInstant(
      envelope.payload.sourceLastHealthyAt,
      'sourceLastHealthyAt',
    ),
  });
}

function assertNoUnexpectedSourceHealthFields(record) {
  const allowed = new Set([...SOURCE_HEALTH_FIELDS, ...SOURCE_HEALTH_METADATA_FIELDS]);
  const unexpected = Object.keys(record).filter((field) => !allowed.has(field));
  if (unexpected.length) {
    throw new SourceHealthIntegrityError(
      `Stored source health contains unexpected fields: ${unexpected.sort().join(', ')}.`,
      'SOURCE_HEALTH_UNEXPECTED_FIELDS',
    );
  }
}

function comparableSourceHealth(record) {
  const comparable = {};
  for (const field of SOURCE_HEALTH_FIELDS) comparable[field] = record[field];
  return comparable;
}

function assertStoredSourceHealthIntegrity(record, {
  audience,
  path,
  publicKeys,
} = {}) {
  if (!record || typeof record !== 'object') {
    throw new SourceHealthIntegrityError('Stored source health is missing.');
  }
  if (record._id !== SOURCE_HEALTH_ID) {
    throw new SourceHealthIntegrityError(
      'Stored source health singleton ID is invalid.',
      'SOURCE_HEALTH_ID_INVALID',
    );
  }
  assertNoUnexpectedSourceHealthFields(record);

  let verified;
  try {
    verified = verifyStoredHealthSignature({
      audience,
      path,
      publicKeys,
      signatureBase64: record.signature,
      signedPayload: record.signedPayload,
    });
  } catch (error) {
    throw new SourceHealthIntegrityError(
      `Stored source health signature is invalid: ${error.code || error.message}`,
      'SOURCE_HEALTH_SIGNATURE_INVALID',
    );
  }

  let expected;
  try {
    expected = materializeSourceHealth(verified);
  } catch (error) {
    throw new SourceHealthIntegrityError(
      `Stored source health payload is invalid: ${error.code || error.message}`,
      'SOURCE_HEALTH_PAYLOAD_INVALID',
    );
  }

  let actualCanonical;
  let expectedCanonical;
  try {
    actualCanonical = canonicalize(comparableSourceHealth(record));
    expectedCanonical = canonicalize(comparableSourceHealth(expected));
  } catch (error) {
    throw new SourceHealthIntegrityError(
      `Stored source health materialization is malformed: ${error.message}`,
      'SOURCE_HEALTH_MATERIALIZATION_INVALID',
    );
  }

  if (actualCanonical !== expectedCanonical) {
    throw new SourceHealthIntegrityError(
      'Stored source health fields do not match the signed envelope.',
      'SOURCE_HEALTH_MATERIALIZATION_MISMATCH',
    );
  }

  return expected;
}

module.exports = {
  SOURCE_HEALTH_COLLECTION,
  SOURCE_HEALTH_FIELDS,
  SOURCE_HEALTH_ID,
  SOURCE_HEALTH_METADATA_FIELDS,
  SourceHealthIntegrityError,
  assertNoUnexpectedSourceHealthFields,
  assertStoredSourceHealthIntegrity,
  materializeSourceHealth,
  toCanonicalInstant,
};
