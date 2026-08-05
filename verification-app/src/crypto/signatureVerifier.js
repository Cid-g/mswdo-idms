'use strict';

const { createPublicKey, verify } = require('node:crypto');
const {
  EnvelopeValidationError,
  parseCanonicalRecordEnvelope,
} = require('./canonicalEnvelope');

class SignatureVerificationError extends Error {
  constructor(message, code, status = 401) {
    super(message);
    this.name = 'SignatureVerificationError';
    this.code = code;
    this.status = status;
  }
}

function decodeSignature(signatureBase64) {
  if (typeof signatureBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/.test(signatureBase64)) {
    throw new SignatureVerificationError('Signature must be canonical base64.', 'INVALID_SIGNATURE_ENCODING', 400);
  }

  const signature = Buffer.from(signatureBase64, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== signatureBase64) {
    throw new SignatureVerificationError('Signature must be a 64-byte Ed25519 signature.', 'INVALID_SIGNATURE_ENCODING', 400);
  }

  return signature;
}

function containsPrivateKeyMaterial(keyInput) {
  if (keyInput?.type === 'private') return true;

  const direct = typeof keyInput === 'string' || Buffer.isBuffer(keyInput)
    ? keyInput
    : keyInput?.key;
  if (typeof direct === 'string' || Buffer.isBuffer(direct)) {
    return Buffer.from(direct).toString('utf8').includes('PRIVATE KEY');
  }

  return false;
}

function getEd25519PublicKey(publicKeys, keyId) {
  let keyInput;
  if (publicKeys instanceof Map) {
    keyInput = publicKeys.get(keyId);
  } else if (publicKeys && Object.prototype.hasOwnProperty.call(publicKeys, keyId)) {
    keyInput = publicKeys[keyId];
  }
  if (!keyInput) {
    throw new SignatureVerificationError('Unknown signing key ID.', 'UNKNOWN_SIGNING_KEY');
  }

  if (containsPrivateKeyMaterial(keyInput)) {
    throw new SignatureVerificationError('Cloud configuration must contain public keys only.', 'PRIVATE_KEY_NOT_ALLOWED', 500);
  }

  let publicKey;
  try {
    publicKey = keyInput?.type === 'public' ? keyInput : createPublicKey(keyInput);
  } catch {
    throw new SignatureVerificationError('Configured signing key is invalid.', 'INVALID_PUBLIC_KEY', 500);
  }

  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new SignatureVerificationError('Configured signing key must be Ed25519.', 'INVALID_PUBLIC_KEY', 500);
  }

  return publicKey;
}

function parseHeaderTimestamp(value) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw new SignatureVerificationError('X-Timestamp must be an integer string.', 'INVALID_TIMESTAMP_HEADER', 400);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new SignatureVerificationError('X-Timestamp is outside the supported range.', 'INVALID_TIMESTAMP_HEADER', 400);
  }

  return parsed;
}

function parseSignedEnvelope(signedPayload) {
  try {
    return parseCanonicalRecordEnvelope(signedPayload);
  } catch (error) {
    if (error instanceof EnvelopeValidationError) throw error;
    throw new SignatureVerificationError('Signed envelope could not be parsed.', 'INVALID_SIGNED_ENVELOPE', 400);
  }
}

function verifyStoredRecordSignature({
  audience,
  method = 'POST',
  path,
  publicKeys,
  signatureBase64,
  signedPayload,
}) {
  const envelope = parseSignedEnvelope(signedPayload);

  if (method !== envelope.method) {
    throw new SignatureVerificationError('HTTP method does not match the signed envelope.', 'METHOD_MISMATCH', 400);
  }
  if (path !== envelope.path) {
    throw new SignatureVerificationError('HTTP path does not match the signed envelope.', 'PATH_MISMATCH', 400);
  }
  if (audience !== envelope.audience) {
    throw new SignatureVerificationError('Audience does not match the signed envelope.', 'AUDIENCE_MISMATCH', 400);
  }

  const signature = decodeSignature(signatureBase64);
  const publicKey = getEd25519PublicKey(publicKeys, envelope.keyId);
  const valid = verify(null, Buffer.from(signedPayload, 'utf8'), publicKey, signature);
  if (!valid) {
    throw new SignatureVerificationError('Signature verification failed.', 'SIGNATURE_INVALID');
  }

  return Object.freeze({
    envelope,
    signature: signatureBase64,
    signedPayload,
  });
}

function verifyRecordSyncRequest({
  audience,
  headerKeyId,
  headerTimestamp,
  maxClockSkewMs,
  method,
  now = Date.now(),
  path,
  publicKeys,
  signatureBase64,
  signedPayload,
}) {
  const verified = verifyStoredRecordSignature({
    audience,
    method,
    path,
    publicKeys,
    signatureBase64,
    signedPayload,
  });
  const { envelope } = verified;

  if (headerKeyId !== envelope.keyId) {
    throw new SignatureVerificationError('X-Key-Id does not match the signed envelope.', 'KEY_ID_MISMATCH', 400);
  }

  const parsedHeaderTimestamp = parseHeaderTimestamp(headerTimestamp);
  if (parsedHeaderTimestamp !== envelope.timestamp) {
    throw new SignatureVerificationError('X-Timestamp does not match the signed envelope.', 'TIMESTAMP_MISMATCH', 400);
  }

  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(maxClockSkewMs) || maxClockSkewMs <= 0) {
    throw new TypeError('now and maxClockSkewMs must be valid safe integers.');
  }

  if (Math.abs(now - envelope.timestamp) > maxClockSkewMs) {
    throw new SignatureVerificationError('Signed request timestamp is outside the accepted window.', 'STALE_SIGNED_REQUEST');
  }

  return verified;
}

module.exports = {
  SignatureVerificationError,
  containsPrivateKeyMaterial,
  decodeSignature,
  getEd25519PublicKey,
  parseHeaderTimestamp,
  parseSignedEnvelope,
  verifyRecordSyncRequest,
  verifyStoredRecordSignature,
};
