'use strict';

const {
  createHash,
  createPrivateKey,
  sign,
} = require('node:crypto');
const {
  digestVerificationPayload,
  validateVerificationPayload,
} = require('./verificationPayload');

const MAX_SIGNED_PAYLOAD_BYTES = 16 * 1024;
const PROTOCOL_VERSION = 1;
const SIGNATURE_DOMAIN = 'MSWDO-IDMS/VERIFY-SYNC/V1';
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

class VerificationSyncProtocolError extends Error {
  constructor(message, code = 'INVALID_VERIFICATION_SYNC_ENVELOPE') {
    super(message);
    this.name = 'VerificationSyncProtocolError';
    this.code = code;
  }
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new VerificationSyncProtocolError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new VerificationSyncProtocolError(`${label} must be a plain object.`);
  }
}

function canonicalize(value, path = '$') {
  if (value === null) return 'null';

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new VerificationSyncProtocolError(`${path} contains a non-finite number.`);
    }
    if (Object.is(value, -0)) return '0';
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const parts = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new VerificationSyncProtocolError(`${path} contains a sparse array.`);
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
      if (
        child === undefined
        || typeof child === 'function'
        || typeof child === 'symbol'
        || typeof child === 'bigint'
      ) {
        throw new VerificationSyncProtocolError(`${path}.${key} contains an unsupported value.`);
      }
      return `${JSON.stringify(key)}:${canonicalize(child, `${path}.${key}`)}`;
    });
    return `{${parts.join(',')}}`;
  }

  throw new VerificationSyncProtocolError(`${path} contains an unsupported value.`);
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
    throw new VerificationSyncProtocolError(
      `${label} must be a safe integer greater than or equal to ${minimum}.`
    );
  }
}

function assertPattern(value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new VerificationSyncProtocolError(`${label} has an invalid format.`);
  }
}

function validateRecordEnvelope(envelope) {
  assertPlainObject(envelope, 'envelope');

  const keys = Object.keys(envelope).sort();
  const expectedKeys = [...RECORD_SYNC_FIELDS].sort();
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new VerificationSyncProtocolError(
      'Envelope fields do not match the record-sync protocol schema.'
    );
  }

  if (envelope.domain !== SIGNATURE_DOMAIN) {
    throw new VerificationSyncProtocolError('Envelope signature domain is invalid.');
  }
  if (envelope.protocolVersion !== PROTOCOL_VERSION) {
    throw new VerificationSyncProtocolError('Envelope protocol version is unsupported.');
  }

  assertPattern(envelope.keyId, 'keyId', /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  assertSafeInteger(envelope.epoch, 'epoch', 1);
  assertSafeInteger(envelope.revision, 'revision', 1);
  assertSafeInteger(envelope.timestamp, 'timestamp', 1);

  if (envelope.method !== 'POST') {
    throw new VerificationSyncProtocolError('method must be POST.');
  }
  if (
    typeof envelope.path !== 'string'
    || !envelope.path.startsWith('/')
    || envelope.path.includes('?')
  ) {
    throw new VerificationSyncProtocolError(
      'path must be an absolute path without a query string.'
    );
  }
  if (
    typeof envelope.audience !== 'string'
    || !envelope.audience.trim()
    || envelope.audience !== envelope.audience.trim()
  ) {
    throw new VerificationSyncProtocolError('audience must be a non-empty string.');
  }

  assertPattern(envelope.tokenHash, 'tokenHash', /^[a-f0-9]{64}$/);
  validateVerificationPayload(envelope.payload);
  assertPattern(envelope.payloadDigest, 'payloadDigest', /^[a-f0-9]{64}$/);

  const cloudCompatibleDigest = digestPayload(envelope.payload);
  if (cloudCompatibleDigest !== envelope.payloadDigest) {
    throw new VerificationSyncProtocolError(
      'payloadDigest does not match the canonical payload.',
      'PAYLOAD_DIGEST_MISMATCH'
    );
  }
  if (digestVerificationPayload(envelope.payload) !== envelope.payloadDigest) {
    throw new VerificationSyncProtocolError(
      'Local payload digest does not match the signed payload.',
      'PAYLOAD_DIGEST_MISMATCH'
    );
  }

  return envelope;
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
    throw new VerificationSyncProtocolError(
      'Provided payloadDigest does not match payload.',
      'PAYLOAD_DIGEST_MISMATCH'
    );
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
  const signedPayload = canonicalize(envelope);
  if (Buffer.byteLength(signedPayload, 'utf8') > MAX_SIGNED_PAYLOAD_BYTES) {
    throw new VerificationSyncProtocolError(
      'Signed payload exceeds the protocol size limit.',
      'SIGNED_ENVELOPE_TOO_LARGE'
    );
  }
  return signedPayload;
}

function requireEd25519PrivateKey(keyInput) {
  let privateKey;
  try {
    privateKey = keyInput?.type === 'private' ? keyInput : createPrivateKey(keyInput);
  } catch {
    throw new VerificationSyncProtocolError(
      'Verification signing key is invalid.',
      'INVALID_VERIFICATION_PRIVATE_KEY'
    );
  }

  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
    throw new VerificationSyncProtocolError(
      'Verification signing key must be an Ed25519 private key.',
      'INVALID_VERIFICATION_PRIVATE_KEY'
    );
  }
  return privateKey;
}

function buildSignedRecordRequest({
  audience,
  keyId,
  operation,
  path,
  privateKey,
  timestamp,
}) {
  assertPlainObject(operation, 'operation');
  const key = requireEd25519PrivateKey(privateKey);
  const signedPayload = buildRecordEnvelope({
    audience,
    epoch: operation.epoch,
    keyId,
    path,
    payload: operation.payload,
    payloadDigest: operation.payloadDigest,
    revision: operation.revision,
    timestamp,
    tokenHash: operation.tokenHash,
  });

  const signature = sign(null, Buffer.from(signedPayload, 'utf8'), key);
  if (signature.length !== 64) {
    throw new VerificationSyncProtocolError(
      'Ed25519 signing returned an invalid signature length.',
      'INVALID_VERIFICATION_SIGNATURE'
    );
  }
  const signatureBase64 = signature.toString('base64');

  return Object.freeze({
    body: signedPayload,
    headers: Object.freeze({
      'Content-Type': 'application/json; charset=utf-8',
      'X-Key-Id': keyId,
      'X-Signature': signatureBase64,
      'X-Timestamp': String(timestamp),
    }),
    signature: signatureBase64,
    signedPayload,
  });
}

module.exports = {
  MAX_SIGNED_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  RECORD_SYNC_FIELDS,
  SIGNATURE_DOMAIN,
  VerificationSyncProtocolError,
  buildRecordEnvelope,
  buildSignedRecordRequest,
  canonicalize,
  digestPayload,
  requireEd25519PrivateKey,
  sha256Hex,
  validateRecordEnvelope,
};
