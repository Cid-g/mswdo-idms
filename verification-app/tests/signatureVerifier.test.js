'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { buildRecordEnvelope } = require('../src/crypto/canonicalEnvelope');
const {
  SignatureVerificationError,
  verifyRecordSyncRequest,
  verifyStoredRecordSignature,
} = require('../src/crypto/signatureVerifier');

const NOW = 1785940200123;
const MAX_CLOCK_SKEW_MS = 300000;
const TOKEN_HASH = 'c'.repeat(64);
const PAYLOAD = Object.freeze({ idNumber: 'PWD-2026-00123', maskedName: 'D****, L****', status: 'ACTIVE' });
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

function signedRequest(overrides = {}) {
  const keyId = overrides.keyId || 'office-key-2026-01';
  const timestamp = overrides.timestamp ?? NOW;
  const signedPayload = buildRecordEnvelope({
    audience: overrides.envelopeAudience || 'mswdo-verification-service',
    epoch: overrides.epoch || 1,
    keyId,
    path: overrides.envelopePath || '/internal/sync',
    payload: PAYLOAD,
    revision: overrides.revision || 1,
    timestamp,
    tokenHash: TOKEN_HASH,
  });
  const signatureBase64 = sign(null, Buffer.from(signedPayload, 'utf8'), overrides.privateKey || privateKey)
    .toString('base64');

  return {
    audience: overrides.audience || 'mswdo-verification-service',
    headerKeyId: overrides.headerKeyId || keyId,
    headerTimestamp: overrides.headerTimestamp || String(timestamp),
    maxClockSkewMs: MAX_CLOCK_SKEW_MS,
    method: overrides.method || 'POST',
    now: overrides.now ?? NOW,
    path: overrides.path || '/internal/sync',
    publicKeys: overrides.publicKeys || { [keyId]: publicKey },
    signatureBase64: overrides.signatureBase64 || signatureBase64,
    signedPayload,
  };
}

test('verifies a valid Ed25519 signature over the exact canonical bytes', () => {
  const request = signedRequest();
  const result = verifyRecordSyncRequest(request);

  assert.equal(result.signedPayload, request.signedPayload);
  assert.equal(result.signature, request.signatureBase64);
  assert.equal(result.envelope.keyId, 'office-key-2026-01');
  assert.equal(result.envelope.timestamp, NOW);
});

test('re-verifies persisted signed bytes without treating their historical timestamp as a replay', () => {
  const request = signedRequest({ timestamp: NOW - (365 * 24 * 60 * 60 * 1000) });
  assert.doesNotThrow(() => verifyStoredRecordSignature({
    audience: request.audience,
    method: request.method,
    path: request.path,
    publicKeys: request.publicKeys,
    signatureBase64: request.signatureBase64,
    signedPayload: request.signedPayload,
  }));
});

test('accepts signed timestamps exactly on either replay-window boundary', () => {
  assert.doesNotThrow(() => verifyRecordSyncRequest(signedRequest({ now: NOW + MAX_CLOCK_SKEW_MS })));
  assert.doesNotThrow(() => verifyRecordSyncRequest(signedRequest({ now: NOW - MAX_CLOCK_SKEW_MS })));
});

test('rejects signed timestamps outside the replay window in either direction', () => {
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ now: NOW + MAX_CLOCK_SKEW_MS + 1 })),
    (error) => error.code === 'STALE_SIGNED_REQUEST',
  );
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ now: NOW - MAX_CLOCK_SKEW_MS - 1 })),
    (error) => error.code === 'STALE_SIGNED_REQUEST',
  );
});

test('rejects unknown key IDs without trying another key', () => {
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ publicKeys: {} })),
    (error) => error.code === 'UNKNOWN_SIGNING_KEY',
  );
});



test('treats inherited object properties as unknown key IDs', () => {
  const request = signedRequest({ keyId: 'constructor', publicKeys: {} });
  assert.throws(
    () => verifyRecordSyncRequest(request),
    (error) => error.code === 'UNKNOWN_SIGNING_KEY',
  );
});

test('rejects a signature made by a different private key', () => {
  const attacker = generateKeyPairSync('ed25519');
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ privateKey: attacker.privateKey })),
    (error) => error.code === 'SIGNATURE_INVALID',
  );
});

test('binds X-Key-Id and X-Timestamp to the signed envelope', () => {
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ headerKeyId: 'different-key' })),
    (error) => error.code === 'KEY_ID_MISMATCH',
  );
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ headerTimestamp: String(NOW + 1) })),
    (error) => error.code === 'TIMESTAMP_MISMATCH',
  );
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ headerTimestamp: '1.5' })),
    (error) => error.code === 'INVALID_TIMESTAMP_HEADER',
  );
});

test('binds the signature to method, exact path, and audience', () => {
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ method: 'PUT' })),
    (error) => error.code === 'METHOD_MISMATCH',
  );
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ path: '/internal/sync/' })),
    (error) => error.code === 'PATH_MISMATCH',
  );
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ audience: 'other-service' })),
    (error) => error.code === 'AUDIENCE_MISMATCH',
  );
});

test('rejects malformed or non-canonical base64 signatures', () => {
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ signatureBase64: 'not-base64' })),
    (error) => error.code === 'INVALID_SIGNATURE_ENCODING',
  );
  const valid = signedRequest();
  assert.throws(
    () => verifyRecordSyncRequest({ ...valid, signatureBase64: valid.signatureBase64.replace(/=$/, '') }),
    (error) => error.code === 'INVALID_SIGNATURE_ENCODING',
  );
});



test('rejects private key material in the cloud public-key ring', () => {
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ publicKeys: { 'office-key-2026-01': privateKey } })),
    (error) => error.code === 'PRIVATE_KEY_NOT_ALLOWED',
  );
});

test('rejects a configured non-Ed25519 public key', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(
    () => verifyRecordSyncRequest(signedRequest({ publicKeys: { 'office-key-2026-01': rsa.publicKey } })),
    (error) => error.code === 'INVALID_PUBLIC_KEY',
  );
});

test('rejects non-canonical signed bytes before signature acceptance', () => {
  const request = signedRequest();
  const nonCanonical = JSON.stringify(JSON.parse(request.signedPayload), null, 2);
  const signatureBase64 = sign(null, Buffer.from(nonCanonical, 'utf8'), privateKey).toString('base64');

  assert.throws(
    () => verifyRecordSyncRequest({ ...request, signedPayload: nonCanonical, signatureBase64 }),
    (error) => error.code === 'NON_CANONICAL_SIGNED_ENVELOPE',
  );
});

test('supports key-ring rotation by selecting only the envelope key ID', () => {
  const oldKey = generateKeyPairSync('ed25519');
  const request = signedRequest({
    keyId: 'office-key-2026-02',
    publicKeys: new Map([
      ['office-key-2026-01', oldKey.publicKey],
      ['office-key-2026-02', publicKey],
    ]),
  });

  assert.equal(verifyRecordSyncRequest(request).envelope.keyId, 'office-key-2026-02');
});

test('exposes stable error metadata for endpoint mapping', () => {
  const error = new SignatureVerificationError('example', 'EXAMPLE', 409);
  assert.equal(error.name, 'SignatureVerificationError');
  assert.equal(error.code, 'EXAMPLE');
  assert.equal(error.status, 409);
});
