'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  StoredRecordIntegrityError,
  assertStoredRecordIntegrity,
  materializeVerifiedRecord,
} = require('../src/models/verifiedRecord');
const {
  AUDIENCE,
  PATH,
  TIMESTAMP,
  publicKey,
  signedRecord,
  validRecordPayload,
} = require('./fixtures');

test('materializes every queryable field from the signed envelope only', () => {
  const { verifiedRequest } = signedRecord({ epoch: 4, revision: 9 });
  const record = materializeVerifiedRecord(verifiedRequest);

  assert.deepEqual(record, {
    ...validRecordPayload(),
    epoch: 4,
    keyId: 'office-key-2026-01',
    payloadDigest: verifiedRequest.envelope.payloadDigest,
    revision: 9,
    signature: verifiedRequest.signature,
    signedPayload: verifiedRequest.signedPayload,
    syncedAt: new Date(TIMESTAMP).toISOString(),
    tokenHash: verifiedRequest.envelope.tokenHash,
  });
  assert.equal(Object.isFrozen(record), true);
});

test('re-verifies an old stored signature without applying the incoming-request replay window', () => {
  const { verifiedRequest } = signedRecord({ timestamp: 1609459200000 });
  const stored = materializeVerifiedRecord(verifiedRequest);

  assert.doesNotThrow(() => assertStoredRecordIntegrity(stored, {
    audience: AUDIENCE,
    path: PATH,
    publicKeys: { 'office-key-2026-01': publicKey },
  }));
});

test('detects database-only mutation of a materialized field', () => {
  const { verifiedRequest } = signedRecord();
  const stored = materializeVerifiedRecord(verifiedRequest);
  const tampered = { ...stored, status: 'REVOKED' };

  assert.throws(
    () => assertStoredRecordIntegrity(tampered, {
      audience: AUDIENCE,
      path: PATH,
      publicKeys: { 'office-key-2026-01': publicKey },
    }),
    (error) => error.code === 'STORED_RECORD_MATERIALIZATION_MISMATCH',
  );
});

test('detects mutation of signed bytes, signature, or key metadata', () => {
  const { verifiedRequest } = signedRecord();
  const stored = materializeVerifiedRecord(verifiedRequest);

  for (const tampered of [
    { ...stored, signedPayload: `${stored.signedPayload} ` },
    { ...stored, signature: 'A'.repeat(88) },
    { ...stored, keyId: 'attacker-key' },
  ]) {
    assert.throws(
      () => assertStoredRecordIntegrity(tampered, {
        audience: AUDIENCE,
        path: PATH,
        publicKeys: { 'office-key-2026-01': publicKey },
      }),
      StoredRecordIntegrityError,
    );
  }
});

test('rejects unexpected stored fields instead of silently retaining cloud-side PII', () => {
  const { verifiedRequest } = signedRecord();
  const stored = materializeVerifiedRecord(verifiedRequest);

  assert.throws(
    () => assertStoredRecordIntegrity({ ...stored, fullName: 'Daniel Local' }, {
      audience: AUDIENCE,
      path: PATH,
      publicKeys: { 'office-key-2026-01': publicKey },
    }),
    (error) => error.code === 'STORED_RECORD_UNEXPECTED_FIELDS',
  );
});

test('does not trust an independently supplied parsed payload', () => {
  const { verifiedRequest } = signedRecord();
  const record = materializeVerifiedRecord({
    ...verifiedRequest,
    envelope: {
      ...verifiedRequest.envelope,
      payload: { ...validRecordPayload(), status: 'REVOKED' },
    },
  });
  assert.equal(record.status, 'ACTIVE');
});
