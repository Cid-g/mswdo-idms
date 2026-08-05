'use strict';

const { createHash } = require('node:crypto');

const MAX_SIGNED_PAYLOAD_BYTES = 16 * 1024;
const PROTOCOL_VERSION = 1;
const SIGNATURE_DOMAIN = 'MSWDO-IDMS/VERIFY-SYNC/V1';
const HEALTH_SIGNATURE_DOMAIN = 'MSWDO-IDMS/VERIFY-HEALTH/V1';
const HEALTH_SYNC_FIELDS = Object.freeze([
  'audience',
  'domain',
  'epoch',
  'keyId',
  'method',
  'path',
  'payload',
  'payloadDigest',
  'protocolVersion',
  'timestamp',
]);
const HEALTH_PAYLOAD_FIELDS = Object.freeze(['sourceLastHealthyAt']);
const RECORD_SYNC_FIELDS = Object.freeze([
  'audience',
  'domain',
  'epoch',
  'keyId',
  'method',
  'path',
  'payload',
  'payloadDigest',
  'protocolVersion',
  'revision',
  'timestamp',
  'tokenHash',
]);

class EnvelopeValidationError extends Error {
  constructor(message, code = 'INVALID_SIGNED_ENVELOPE') {
    super(message);
    this.name = 'EnvelopeValidationError';
    this.code = code;
    this.status = 400;
  }
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EnvelopeValidationError(`${label} must be a plain object.`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new EnvelopeValidationError(`${label} must be a plain object.`);
  }
}

function canonicalize(value, path = '$') {
  if (value === null) return 'null';

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new EnvelopeValidationError(`${path} contains a non-finite number.`);
    }
    if (Object.is(value, -0)) return '0';
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const parts = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new EnvelopeValidationError(`${path} contains a sparse array.`);
      }
      parts.push(canonicalize(value[index], `${path}[${index}]`));
    }
    return `[${parts.join(',')}]`;
  }

  if (typeof value === 'object') {
    assertPlainObject(value, path);
    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => {
      const child = value[key];
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol' || typeof child === 'bigint') {
        throw new EnvelopeValidationError(`${path}.${key} contains an unsupported value.`);
      }
      return `${JSON.stringify(key)}:${canonicalize(child, `${path}.${key}`)}`;
    });
    return `{${parts.join(',')}}`;
  }

  throw new EnvelopeValidationError(`${path} contains an unsupported value.`);
}


function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;

  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function sha256Hex(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return createHash('sha256').update(bytes).digest('hex');
}

function digestPayload(payload) {
  return sha256Hex(canonicalize(payload));
}

function assertSafeInteger(value, label, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new EnvelopeValidationError(`${label} must be a safe integer greater than or equal to ${minimum}.`);
  }
}

function assertPattern(value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new EnvelopeValidationError(`${label} has an invalid format.`);
  }
}

function validateHealthPayload(payload, timestamp) {
  assertPlainObject(payload, 'payload');
  const keys = Object.keys(payload).sort();
  const expectedKeys = [...HEALTH_PAYLOAD_FIELDS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new EnvelopeValidationError('Health payload fields do not match the protocol schema.');
  }
  assertSafeInteger(payload.sourceLastHealthyAt, 'payload.sourceLastHealthyAt', 1);
  if (payload.sourceLastHealthyAt !== timestamp) {
    throw new EnvelopeValidationError(
      'payload.sourceLastHealthyAt must equal the signed request timestamp.',
      'HEALTH_TIMESTAMP_MISMATCH',
    );
  }
  return payload;
}

function validateHealthEnvelope(envelope) {
  assertPlainObject(envelope, 'envelope');

  const keys = Object.keys(envelope).sort();
  const expectedKeys = [...HEALTH_SYNC_FIELDS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new EnvelopeValidationError('Envelope fields do not match the health-sync protocol schema.');
  }

  if (envelope.domain !== HEALTH_SIGNATURE_DOMAIN) {
    throw new EnvelopeValidationError('Envelope signature domain is invalid.');
  }
  if (envelope.protocolVersion !== PROTOCOL_VERSION) {
    throw new EnvelopeValidationError('Envelope protocol version is unsupported.');
  }

  assertPattern(envelope.keyId, 'keyId', /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  assertSafeInteger(envelope.epoch, 'epoch', 1);
  assertSafeInteger(envelope.timestamp, 'timestamp', 1);

  if (envelope.method !== 'POST') {
    throw new EnvelopeValidationError('method must be POST.');
  }
  if (typeof envelope.path !== 'string' || !envelope.path.startsWith('/') || envelope.path.includes('?')) {
    throw new EnvelopeValidationError('path must be an absolute path without a query string.');
  }
  if (
    typeof envelope.audience !== 'string'
    || !envelope.audience.trim()
    || envelope.audience !== envelope.audience.trim()
  ) {
    throw new EnvelopeValidationError('audience must be a non-empty string.');
  }

  validateHealthPayload(envelope.payload, envelope.timestamp);
  assertPattern(envelope.payloadDigest, 'payloadDigest', /^[a-f0-9]{64}$/);
  if (digestPayload(envelope.payload) !== envelope.payloadDigest) {
    throw new EnvelopeValidationError('payloadDigest does not match the canonical payload.', 'PAYLOAD_DIGEST_MISMATCH');
  }

  return deepFreeze({ ...envelope, payload: envelope.payload });
}

function buildHealthEnvelope({
  audience,
  epoch,
  keyId,
  path,
  payload,
  payloadDigest,
  timestamp,
}) {
  const computedPayloadDigest = digestPayload(payload);
  if (payloadDigest !== undefined && payloadDigest !== computedPayloadDigest) {
    throw new EnvelopeValidationError('Provided payloadDigest does not match payload.', 'PAYLOAD_DIGEST_MISMATCH');
  }

  const envelope = {
    audience,
    domain: HEALTH_SIGNATURE_DOMAIN,
    epoch,
    keyId,
    method: 'POST',
    path,
    payload,
    payloadDigest: computedPayloadDigest,
    protocolVersion: PROTOCOL_VERSION,
    timestamp,
  };

  validateHealthEnvelope(envelope);
  return canonicalize(envelope);
}

function parseCanonicalHealthEnvelope(signedPayload) {
  if (typeof signedPayload !== 'string' || !signedPayload.length) {
    throw new EnvelopeValidationError('signedPayload must be a non-empty UTF-8 string.');
  }
  if (Buffer.byteLength(signedPayload, 'utf8') > MAX_SIGNED_PAYLOAD_BYTES) {
    throw new EnvelopeValidationError('signedPayload exceeds the protocol size limit.', 'SIGNED_ENVELOPE_TOO_LARGE');
  }

  let parsed;
  try {
    parsed = JSON.parse(signedPayload);
  } catch {
    throw new EnvelopeValidationError('signedPayload is not valid JSON.');
  }

  const envelope = validateHealthEnvelope(parsed);
  const canonicalPayload = canonicalize(envelope);
  if (canonicalPayload !== signedPayload) {
    throw new EnvelopeValidationError('signedPayload is not in canonical form.', 'NON_CANONICAL_SIGNED_ENVELOPE');
  }

  return envelope;
}

function validateRecordEnvelope(envelope) {
  assertPlainObject(envelope, 'envelope');

  const keys = Object.keys(envelope).sort();
  const expectedKeys = [...RECORD_SYNC_FIELDS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new EnvelopeValidationError('Envelope fields do not match the record-sync protocol schema.');
  }

  if (envelope.domain !== SIGNATURE_DOMAIN) {
    throw new EnvelopeValidationError('Envelope signature domain is invalid.');
  }
  if (envelope.protocolVersion !== PROTOCOL_VERSION) {
    throw new EnvelopeValidationError('Envelope protocol version is unsupported.');
  }

  assertPattern(envelope.keyId, 'keyId', /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  assertSafeInteger(envelope.epoch, 'epoch', 1);
  assertSafeInteger(envelope.revision, 'revision', 1);
  assertSafeInteger(envelope.timestamp, 'timestamp', 1);

  if (envelope.method !== 'POST') {
    throw new EnvelopeValidationError('method must be POST.');
  }
  if (typeof envelope.path !== 'string' || !envelope.path.startsWith('/') || envelope.path.includes('?')) {
    throw new EnvelopeValidationError('path must be an absolute path without a query string.');
  }
  if (
    typeof envelope.audience !== 'string'
    || !envelope.audience.trim()
    || envelope.audience !== envelope.audience.trim()
  ) {
    throw new EnvelopeValidationError('audience must be a non-empty string.');
  }

  assertPattern(envelope.tokenHash, 'tokenHash', /^[a-f0-9]{64}$/);
  assertPlainObject(envelope.payload, 'payload');
  if (Object.keys(envelope.payload).length === 0) {
    throw new EnvelopeValidationError('payload must not be empty.');
  }
  assertPattern(envelope.payloadDigest, 'payloadDigest', /^[a-f0-9]{64}$/);
  if (digestPayload(envelope.payload) !== envelope.payloadDigest) {
    throw new EnvelopeValidationError('payloadDigest does not match the canonical payload.', 'PAYLOAD_DIGEST_MISMATCH');
  }

  return deepFreeze({ ...envelope, payload: envelope.payload });
}

function buildRecordEnvelope({
  audience,
  epoch,
  keyId,
  path,
  payload,
  payloadDigest,
  revision,
  timestamp,
  tokenHash,
}) {
  const computedPayloadDigest = digestPayload(payload);
  if (payloadDigest !== undefined && payloadDigest !== computedPayloadDigest) {
    throw new EnvelopeValidationError('Provided payloadDigest does not match payload.', 'PAYLOAD_DIGEST_MISMATCH');
  }

  const envelope = {
    audience,
    domain: SIGNATURE_DOMAIN,
    epoch,
    keyId,
    method: 'POST',
    path,
    payload,
    payloadDigest: computedPayloadDigest,
    protocolVersion: PROTOCOL_VERSION,
    revision,
    timestamp,
    tokenHash,
  };

  validateRecordEnvelope(envelope);
  return canonicalize(envelope);
}

function parseCanonicalRecordEnvelope(signedPayload) {
  if (typeof signedPayload !== 'string' || !signedPayload.length) {
    throw new EnvelopeValidationError('signedPayload must be a non-empty UTF-8 string.');
  }
  if (Buffer.byteLength(signedPayload, 'utf8') > MAX_SIGNED_PAYLOAD_BYTES) {
    throw new EnvelopeValidationError('signedPayload exceeds the protocol size limit.', 'SIGNED_ENVELOPE_TOO_LARGE');
  }

  let parsed;
  try {
    parsed = JSON.parse(signedPayload);
  } catch {
    throw new EnvelopeValidationError('signedPayload is not valid JSON.');
  }

  const envelope = validateRecordEnvelope(parsed);
  const canonicalPayload = canonicalize(envelope);
  if (canonicalPayload !== signedPayload) {
    throw new EnvelopeValidationError('signedPayload is not in canonical form.', 'NON_CANONICAL_SIGNED_ENVELOPE');
  }

  return envelope;
}

module.exports = {
  EnvelopeValidationError,
  HEALTH_PAYLOAD_FIELDS,
  HEALTH_SIGNATURE_DOMAIN,
  HEALTH_SYNC_FIELDS,
  MAX_SIGNED_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  RECORD_SYNC_FIELDS,
  SIGNATURE_DOMAIN,
  buildHealthEnvelope,
  buildRecordEnvelope,
  canonicalize,
  deepFreeze,
  digestPayload,
  parseCanonicalHealthEnvelope,
  parseCanonicalRecordEnvelope,
  sha256Hex,
  validateHealthEnvelope,
  validateHealthPayload,
  validateRecordEnvelope,
};
