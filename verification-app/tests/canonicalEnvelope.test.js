'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EnvelopeValidationError,
  MAX_SIGNED_PAYLOAD_BYTES,
  SIGNATURE_DOMAIN,
  buildRecordEnvelope,
  canonicalize,
  digestPayload,
  parseCanonicalRecordEnvelope,
  sha256Hex,
} = require('../src/crypto/canonicalEnvelope');

const TOKEN_HASH = 'a'.repeat(64);
const PAYLOAD = Object.freeze({
  idNumber: 'PWD-2026-00123',
  maskedName: 'D****, L****',
  status: 'ACTIVE',
});
const PAYLOAD_DIGEST = '16c3aefc927e77273047b8ca137d7a0d05ecb7b8afafdd4116a56f885c1d5b78';

function envelopeInput(overrides = {}) {
  return {
    audience: 'mswdo-verification-service',
    epoch: 3,
    keyId: 'office-key-2026-01',
    path: '/internal/sync',
    payload: PAYLOAD,
    revision: 14,
    timestamp: 1785940200123,
    tokenHash: TOKEN_HASH,
    ...overrides,
  };
}

test('canonicalize recursively sorts object keys while preserving array order', () => {
  assert.equal(
    canonicalize({ z: 1, a: { y: true, b: 'two' }, list: [{ d: 4, c: 3 }, 2] }),
    '{"a":{"b":"two","y":true},"list":[{"c":3,"d":4},2],"z":1}',
  );
});

test('canonicalize rejects unsupported and sparse values instead of silently dropping them', () => {
  assert.throws(() => canonicalize({ missing: undefined }), EnvelopeValidationError);
  assert.throws(() => canonicalize({ value: 1n }), EnvelopeValidationError);
  assert.throws(() => canonicalize([, 'value']), /sparse array/);
  assert.throws(() => canonicalize({ value: Number.NaN }), /non-finite number/);
});

test('digestPayload hashes the exact canonical payload', () => {
  const payload = { status: 'ACTIVE', maskedName: 'D****, L****', revision: 7 };
  const canonical = '{"maskedName":"D****, L****","revision":7,"status":"ACTIVE"}';
  assert.equal(digestPayload(payload), sha256Hex(canonical));
  assert.equal(digestPayload(payload), '212f60f5b7633536b65938be7e0ff8f9e5865d1a48949e2b2d0bac354b4e53ef');
  assert.equal(digestPayload(PAYLOAD), PAYLOAD_DIGEST);
});

test('buildRecordEnvelope produces deterministic exact signed bytes with payload included', () => {
  const signedPayload = buildRecordEnvelope(envelopeInput());

  assert.equal(
    signedPayload,
    `{"audience":"mswdo-verification-service","domain":"${SIGNATURE_DOMAIN}","epoch":3,"keyId":"office-key-2026-01","method":"POST","path":"/internal/sync","payload":{"idNumber":"PWD-2026-00123","maskedName":"D****, L****","status":"ACTIVE"},"payloadDigest":"${PAYLOAD_DIGEST}","protocolVersion":1,"revision":14,"timestamp":1785940200123,"tokenHash":"${TOKEN_HASH}"}`,
  );
  const parsed = parseCanonicalRecordEnvelope(signedPayload);
  assert.deepEqual(parsed, {
    audience: 'mswdo-verification-service',
    domain: SIGNATURE_DOMAIN,
    epoch: 3,
    keyId: 'office-key-2026-01',
    method: 'POST',
    path: '/internal/sync',
    payload: PAYLOAD,
    payloadDigest: PAYLOAD_DIGEST,
    protocolVersion: 1,
    revision: 14,
    timestamp: 1785940200123,
    tokenHash: TOKEN_HASH,
  });
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.payload), true);
});

test('builder rejects a caller-supplied digest that does not match the payload', () => {
  assert.throws(
    () => buildRecordEnvelope(envelopeInput({ payloadDigest: 'b'.repeat(64) })),
    (error) => error.code === 'PAYLOAD_DIGEST_MISMATCH',
  );
});

test('parser rejects payload tampering even when the envelope remains canonical JSON', () => {
  const original = JSON.parse(buildRecordEnvelope(envelopeInput()));
  original.payload.status = 'REVOKED';
  const tampered = canonicalize(original);

  assert.throws(
    () => parseCanonicalRecordEnvelope(tampered),
    (error) => error.code === 'PAYLOAD_DIGEST_MISMATCH',
  );
});

test('record envelope rejects unexpected fields and invalid scalar formats', () => {
  const valid = JSON.parse(buildRecordEnvelope(envelopeInput()));

  assert.throws(
    () => parseCanonicalRecordEnvelope(canonicalize({ ...valid, parsedPayload: { status: 'ACTIVE' } })),
    /fields do not match/,
  );
  assert.throws(() => buildRecordEnvelope(envelopeInput({ tokenHash: 'A'.repeat(64) })), /tokenHash/);
  assert.throws(() => buildRecordEnvelope(envelopeInput({ payload: {} })), /payload must not be empty/);
  assert.throws(() => buildRecordEnvelope(envelopeInput({ revision: 0 })), /revision/);
  assert.throws(() => buildRecordEnvelope(envelopeInput({ epoch: Number.MAX_SAFE_INTEGER + 1 })), /epoch/);
  assert.throws(() => buildRecordEnvelope(envelopeInput({ path: '/internal/sync?debug=true' })), /path/);
});

test('parser rejects valid JSON when bytes are not exactly canonical', () => {
  const canonical = buildRecordEnvelope(envelopeInput());
  const pretty = JSON.stringify(JSON.parse(canonical), null, 2);

  assert.throws(
    () => parseCanonicalRecordEnvelope(pretty),
    (error) => error.code === 'NON_CANONICAL_SIGNED_ENVELOPE',
  );
});



test('parser rejects envelopes larger than the protocol limit', () => {
  const oversized = 'x'.repeat(MAX_SIGNED_PAYLOAD_BYTES + 1);
  assert.throws(
    () => parseCanonicalRecordEnvelope(oversized),
    (error) => error.code === 'SIGNED_ENVELOPE_TOO_LARGE',
  );
});

test('parser rejects duplicate-key JSON because it cannot equal canonical bytes', () => {
  const canonical = buildRecordEnvelope(envelopeInput());
  const duplicate = canonical.replace(
    '"epoch":3',
    '"epoch":2,"epoch":3',
  );

  assert.throws(
    () => parseCanonicalRecordEnvelope(duplicate),
    (error) => error.code === 'NON_CANONICAL_SIGNED_ENVELOPE',
  );
});

test('buildHealthEnvelope produces a domain-separated canonical heartbeat', () => {
  const {
    HEALTH_SIGNATURE_DOMAIN,
    buildHealthEnvelope,
    parseCanonicalHealthEnvelope,
  } = require('../src/crypto/canonicalEnvelope');
  const timestamp = 1785940200123;
  const signedPayload = buildHealthEnvelope({
    audience: 'mswdo-verification-service',
    epoch: 4,
    keyId: 'office-key-2026-01',
    path: '/internal/health',
    payload: { sourceLastHealthyAt: timestamp },
    timestamp,
  });
  const parsed = parseCanonicalHealthEnvelope(signedPayload);
  assert.equal(parsed.domain, HEALTH_SIGNATURE_DOMAIN);
  assert.equal(parsed.epoch, 4);
  assert.equal(parsed.payload.sourceLastHealthyAt, timestamp);
  assert.equal(Object.isFrozen(parsed.payload), true);
});

test('health envelope rejects timestamp mismatch, extra fields, and record-domain bytes', () => {
  const {
    buildHealthEnvelope,
    parseCanonicalHealthEnvelope,
  } = require('../src/crypto/canonicalEnvelope');
  const timestamp = 1785940200123;
  assert.throws(
    () => buildHealthEnvelope({
      audience: 'mswdo-verification-service',
      epoch: 1,
      keyId: 'office-key-2026-01',
      path: '/internal/health',
      payload: { sourceLastHealthyAt: timestamp - 1 },
      timestamp,
    }),
    (error) => error.code === 'HEALTH_TIMESTAMP_MISMATCH',
  );
  assert.throws(
    () => buildHealthEnvelope({
      audience: 'mswdo-verification-service',
      epoch: 1,
      keyId: 'office-key-2026-01',
      path: '/internal/health',
      payload: { sourceLastHealthyAt: timestamp, queueDepth: 0 },
      timestamp,
    }),
    /fields do not match/,
  );
  assert.throws(
    () => parseCanonicalHealthEnvelope(buildRecordEnvelope(envelopeInput())),
    /health-sync protocol schema/,
  );
});
