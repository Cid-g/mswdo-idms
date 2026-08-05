'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RecordPayloadValidationError,
  validateRecordPayload,
} = require('../src/domain/recordPayload');
const { validRecordPayload } = require('./fixtures');

test('accepts the exact minimized verification payload and freezes it', () => {
  const payload = validateRecordPayload(validRecordPayload());
  assert.equal(payload.status, 'ACTIVE');
  assert.equal(payload.idType, 'PWD');
  assert.equal(Object.isFrozen(payload), true);
});

test('rejects any extra field, including fields forbidden from cloud replication', () => {
  for (const forbidden of [
    ['fullName', 'Daniel Local'],
    ['birthDate', '1990-01-01'],
    ['address', 'Tarlac'],
    ['photo', 'base64'],
    ['signatureImage', 'base64'],
    ['revokedReason', 'private explanation'],
    ['qrToken', 'f0544184-ddf3-4aa0-8270-ef8062c6dc0a'],
  ]) {
    assert.throws(
      () => validateRecordPayload({ ...validRecordPayload(), [forbidden[0]]: forbidden[1] }),
      (error) => error instanceof RecordPayloadValidationError,
    );
  }
});

test('rejects missing fields rather than applying implicit defaults', () => {
  const payload = validRecordPayload();
  delete payload.maskedName;
  assert.throws(() => validateRecordPayload(payload), /minimized schema/);
});

test('accepts all supported statuses and ID types only', () => {
  for (const status of ['ACTIVE', 'REVOKED', 'EXPIRED']) {
    assert.equal(validateRecordPayload(validRecordPayload({ status })).status, status);
  }
  for (const idType of ['PWD', 'SOLO_PARENT', 'SENIOR_CITIZEN']) {
    assert.equal(validateRecordPayload(validRecordPayload({ idType })).idType, idType);
  }
  assert.throws(() => validateRecordPayload(validRecordPayload({ status: 'VALID' })), /status/);
  assert.throws(() => validateRecordPayload(validRecordPayload({ idType: 'ADMIN' })), /idType/);
});

test('validates real calendar dates instead of accepting normalized invalid dates', () => {
  assert.throws(
    () => validateRecordPayload(validRecordPayload({ issuedDate: '2026-02-30' })),
    /real calendar date/,
  );
  assert.throws(
    () => validateRecordPayload(validRecordPayload({ expiryDate: '03/01/2031' })),
    /YYYY-MM-DD/,
  );
  assert.equal(validateRecordPayload(validRecordPayload({ expiryDate: null })).expiryDate, null);
});

test('requires canonical UTC instants for released and anchor timestamps', () => {
  assert.throws(
    () => validateRecordPayload(validRecordPayload({ releasedAt: '2026-03-02T09:00:00+08:00' })),
    /canonical UTC ISO timestamp/,
  );
  assert.throws(
    () => validateRecordPayload(validRecordPayload({ anchoredAt: '2026-03-01T02:03:04Z' })),
    /canonical UTC ISO timestamp/,
  );
  assert.equal(validateRecordPayload(validRecordPayload({ releasedAt: null })).releasedAt, null);
});

test('requires issuance receipt fields to be all present or all null', () => {
  assert.throws(
    () => validateRecordPayload(validRecordPayload({ txId: null })),
    (error) => error.code === 'INCOMPLETE_ISSUANCE_RECEIPT',
  );

  const withoutReceipt = validateRecordPayload(validRecordPayload({
    anchoredAt: null,
    anchoredHash: null,
    blockNumber: null,
    txId: null,
  }));
  assert.equal(withoutReceipt.anchoredHash, null);
});

test('rejects malformed hashes, transaction IDs, block numbers, and control characters', () => {
  assert.throws(() => validateRecordPayload(validRecordPayload({ anchoredHash: 'A'.repeat(64) })), /anchoredHash/);
  assert.throws(() => validateRecordPayload(validRecordPayload({ txId: 'tx-short' })), /txId/);
  assert.throws(() => validateRecordPayload(validRecordPayload({ blockNumber: -1 })), /blockNumber/);
  assert.throws(() => validateRecordPayload(validRecordPayload({ maskedName: 'D****\nL****' })), /maskedName/);
});
