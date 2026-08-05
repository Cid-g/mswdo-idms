'use strict';

const { createHash } = require('node:crypto');

const VERIFICATION_PAYLOAD_FIELDS = Object.freeze([
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
const VERIFICATION_STATUSES = Object.freeze(['ACTIVE', 'REVOKED', 'EXPIRED']);
const VERIFICATION_ID_TYPES = Object.freeze(['PWD', 'SOLO_PARENT', 'SENIOR_CITIZEN']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FABRIC_TX_ID_PATTERN = /^[a-f0-9]{64}$/;

class VerificationPayloadValidationError extends Error {
  constructor(message, code = 'INVALID_VERIFICATION_PAYLOAD') {
    super(message);
    this.name = 'VerificationPayloadValidationError';
    this.code = code;
  }
}

function assertPlainObject(value, fieldName) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new VerificationPayloadValidationError(`${fieldName} must be a plain object.`);
  }
}

function assertExactFields(value, expectedFields, objectName) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new VerificationPayloadValidationError(
      `${objectName} fields do not match the minimized verification schema.`
    );
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
    throw new VerificationPayloadValidationError(`${fieldName} is invalid.`);
  }
}

function assertCanonicalDate(value, fieldName) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new VerificationPayloadValidationError(`${fieldName} must use YYYY-MM-DD.`);
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const canonical = [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
  if (canonical !== value) {
    throw new VerificationPayloadValidationError(`${fieldName} is not a real calendar date.`);
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
    throw new VerificationPayloadValidationError(
      `${fieldName} must be a canonical UTC ISO timestamp.`
    );
  }
}

function assertNullableSafeInteger(value, fieldName) {
  if (value === null) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new VerificationPayloadValidationError(
      `${fieldName} must be a non-negative safe integer or null.`
    );
  }
}

function assertAnchorTuple(payload) {
  const tuple = [payload.anchoredHash, payload.txId, payload.blockNumber, payload.anchoredAt];
  const allNull = tuple.every((value) => value === null);
  const allPresent = tuple.every((value) => value !== null);
  if (!allNull && !allPresent) {
    throw new VerificationPayloadValidationError(
      'anchoredHash, txId, blockNumber, and anchoredAt must be all present or all null.',
      'INCOMPLETE_ISSUANCE_RECEIPT'
    );
  }
}

function validateVerificationPayload(payload) {
  assertPlainObject(payload, 'payload');
  assertExactFields(payload, VERIFICATION_PAYLOAD_FIELDS, 'payload');

  if (!VERIFICATION_STATUSES.includes(payload.status)) {
    throw new VerificationPayloadValidationError('status is unsupported.');
  }
  if (!VERIFICATION_ID_TYPES.includes(payload.idType)) {
    throw new VerificationPayloadValidationError('idType is unsupported.');
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

  return payload;
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not support non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  assertPlainObject(value, 'canonical value');
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
  return `{${entries.join(',')}}`;
}

function digestVerificationPayload(payload) {
  validateVerificationPayload(payload);
  return createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');
}

module.exports = {
  DATE_PATTERN,
  FABRIC_TX_ID_PATTERN,
  ISO_INSTANT_PATTERN,
  SHA256_PATTERN,
  VERIFICATION_ID_TYPES,
  VERIFICATION_PAYLOAD_FIELDS,
  VERIFICATION_STATUSES,
  VerificationPayloadValidationError,
  canonicalize,
  digestVerificationPayload,
  validateVerificationPayload,
};
