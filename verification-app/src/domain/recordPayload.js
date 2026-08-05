'use strict';

const { deepFreeze } = require('../crypto/canonicalEnvelope');

const RECORD_PAYLOAD_FIELDS = Object.freeze([
  'anchoredAt',
  'anchoredHash',
  'blockNumber',
  'expiryDate',
  'idNumber',
  'idType',
  'issuedDate',
  'maskedName',
  'releasedAt',
  'status',
  'txId',
]);
const RECORD_STATUSES = Object.freeze(['ACTIVE', 'REVOKED', 'EXPIRED']);
const ID_TYPES = Object.freeze(['PWD', 'SOLO_PARENT', 'SENIOR_CITIZEN']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FABRIC_TX_ID_PATTERN = /^[a-f0-9]{64}$/;

class RecordPayloadValidationError extends Error {
  constructor(message, code = 'INVALID_VERIFICATION_PAYLOAD') {
    super(message);
    this.name = 'RecordPayloadValidationError';
    this.code = code;
    this.status = 400;
  }
}

function assertPlainObject(value, fieldName) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new RecordPayloadValidationError(`${fieldName} must be a plain object.`);
  }
}

function assertExactFields(value, expectedFields, objectName) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new RecordPayloadValidationError(`${objectName} fields do not match the minimized schema.`);
  }
}

function assertTrimmedString(value, fieldName, { min = 1, max, pattern } = {}) {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || value.length < min
    || (max !== undefined && value.length > max)
    || /[\u0000-\u001f\u007f]/.test(value)
    || (pattern && !pattern.test(value))
  ) {
    throw new RecordPayloadValidationError(`${fieldName} is invalid.`);
  }
}

function assertCanonicalDate(value, fieldName) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new RecordPayloadValidationError(`${fieldName} must use YYYY-MM-DD.`);
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const canonical = [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
  if (canonical !== value) {
    throw new RecordPayloadValidationError(`${fieldName} is not a real calendar date.`);
  }
}

function assertNullableCanonicalDate(value, fieldName) {
  if (value === null) return;
  assertCanonicalDate(value, fieldName);
}

function assertNullableInstant(value, fieldName) {
  if (value === null) return;
  if (
    typeof value !== 'string'
    || !ISO_INSTANT_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new RecordPayloadValidationError(`${fieldName} must be a canonical UTC ISO timestamp.`);
  }
}

function assertNullableSafeInteger(value, fieldName) {
  if (value === null) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RecordPayloadValidationError(`${fieldName} must be a non-negative safe integer or null.`);
  }
}

function assertAnchorTuple(payload) {
  const tuple = [payload.anchoredHash, payload.txId, payload.blockNumber, payload.anchoredAt];
  const allNull = tuple.every((value) => value === null);
  const allPresent = tuple.every((value) => value !== null);
  if (!allNull && !allPresent) {
    throw new RecordPayloadValidationError(
      'anchoredHash, txId, blockNumber, and anchoredAt must be all present or all null.',
      'INCOMPLETE_ISSUANCE_RECEIPT',
    );
  }
}

function validateRecordPayload(payload) {
  assertPlainObject(payload, 'payload');
  assertExactFields(payload, RECORD_PAYLOAD_FIELDS, 'payload');

  if (!RECORD_STATUSES.includes(payload.status)) {
    throw new RecordPayloadValidationError('status is unsupported.');
  }
  if (!ID_TYPES.includes(payload.idType)) {
    throw new RecordPayloadValidationError('idType is unsupported.');
  }

  assertTrimmedString(payload.idNumber, 'idNumber', { max: 128 });
  assertTrimmedString(payload.maskedName, 'maskedName', { max: 256 });
  assertCanonicalDate(payload.issuedDate, 'issuedDate');
  assertNullableCanonicalDate(payload.expiryDate, 'expiryDate');
  assertNullableInstant(payload.releasedAt, 'releasedAt');

  if (payload.anchoredHash !== null) {
    assertTrimmedString(payload.anchoredHash, 'anchoredHash', { pattern: SHA256_PATTERN });
  }
  if (payload.txId !== null) {
    assertTrimmedString(payload.txId, 'txId', { pattern: FABRIC_TX_ID_PATTERN });
  }
  assertNullableSafeInteger(payload.blockNumber, 'blockNumber');
  assertNullableInstant(payload.anchoredAt, 'anchoredAt');
  assertAnchorTuple(payload);

  return deepFreeze({ ...payload });
}

module.exports = {
  DATE_PATTERN,
  FABRIC_TX_ID_PATTERN,
  ID_TYPES,
  ISO_INSTANT_PATTERN,
  RECORD_PAYLOAD_FIELDS,
  RECORD_STATUSES,
  RecordPayloadValidationError,
  SHA256_PATTERN,
  validateRecordPayload,
};
