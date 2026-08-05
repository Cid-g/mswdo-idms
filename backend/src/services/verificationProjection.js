'use strict';

const {
  canonicalize,
  validateVerificationPayload,
} = require('../lib/verificationPayload');

function assertSourceObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} is required.`);
  }
}

function sourceId(value, fieldName) {
  const candidate = value && typeof value === 'object' && value._id
    ? value._id
    : value;
  const id = String(candidate ?? '');
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    throw new TypeError(`${fieldName} is invalid.`);
  }
  return id.toLowerCase();
}

function trimmedSourceString(value, fieldName) {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || value.length < 1
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${fieldName} is invalid.`);
  }
  return value;
}

function nameSourceString(value, fieldName) {
  if (
    typeof value !== 'string'
    || value.trim().length < 1
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${fieldName} is invalid.`);
  }
  return value.trim();
}

function canonicalDateFromSource(value, fieldName, { nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new TypeError(`${fieldName} is required.`);
  }

  let date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string') {
    date = new Date(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new TypeError(`${fieldName} is invalid.`);
      }
      return value;
    }
    if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
      throw new TypeError(`${fieldName} is invalid.`);
    }
  } else {
    throw new TypeError(`${fieldName} is invalid.`);
  }

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${fieldName} is invalid.`);
  }
  return date.toISOString().slice(0, 10);
}

function canonicalInstantFromSource(value, fieldName, { nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new TypeError(`${fieldName} is required.`);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`${fieldName} is invalid.`);
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
      throw new TypeError(`${fieldName} is invalid.`);
    }
    return value;
  }
  throw new TypeError(`${fieldName} is invalid.`);
}

function maskWord(word) {
  if (!word || word.length <= 1) return word;
  return word[0] + '*'.repeat(word.length - 1);
}

function maskName(value) {
  if (!value) return '';
  return String(value).trim().split(/\s+/).map(maskWord).join(' ');
}

function assertProjectionIdentity(applicant, idRecord, anchor) {
  const applicantId = sourceId(applicant._id, 'applicant._id');
  const recordApplicantId = sourceId(idRecord.applicantId, 'idRecord.applicantId');
  if (applicantId !== recordApplicantId) {
    throw new TypeError('Applicant and ID record do not match.');
  }

  const applicantDepartment = trimmedSourceString(
    applicant.department,
    'applicant.department'
  );
  const recordDepartment = trimmedSourceString(idRecord.department, 'idRecord.department');
  if (applicantDepartment !== recordDepartment) {
    throw new TypeError('Applicant and ID record departments do not match.');
  }

  if (anchor !== null && anchor !== undefined) {
    const recordId = sourceId(idRecord._id, 'idRecord._id');
    const anchorRecordId = sourceId(anchor.idRecordId, 'anchor.idRecordId');
    if (recordId !== anchorRecordId) {
      throw new TypeError('Blockchain anchor and ID record do not match.');
    }
    if (anchor.recordRef !== idRecord.idNumber) {
      throw new TypeError('Blockchain anchor record reference does not match the ID record.');
    }
  }
}

function currentReceiptProjection(anchor) {
  if (anchor === null || anchor === undefined || anchor.receiptState === 'STALE') {
    return {
      anchoredAt: null,
      anchoredHash: null,
      blockNumber: null,
      txId: null,
    };
  }
  if (anchor.receiptState !== 'CURRENT') {
    throw new TypeError('Blockchain anchor receiptState is invalid.');
  }

  return {
    anchoredAt: canonicalInstantFromSource(anchor.anchoredAt, 'anchor.anchoredAt'),
    anchoredHash: anchor.canonicalHash,
    blockNumber: anchor.blockNumber,
    txId: anchor.txId,
  };
}

function immutableProjection(payload) {
  validateVerificationPayload(payload);
  return Object.freeze(JSON.parse(canonicalize(payload)));
}

function buildVerificationPayload({ applicant, idRecord, anchor = null }) {
  assertSourceObject(applicant, 'applicant');
  assertSourceObject(idRecord, 'idRecord');
  if (anchor !== null && anchor !== undefined) assertSourceObject(anchor, 'anchor');

  assertProjectionIdentity(applicant, idRecord, anchor);
  const firstName = nameSourceString(applicant.firstName, 'applicant.firstName');
  const lastName = nameSourceString(applicant.lastName, 'applicant.lastName');
  const receipt = currentReceiptProjection(anchor);
  const payload = {
    anchoredAt: receipt.anchoredAt,
    anchoredHash: receipt.anchoredHash,
    blockNumber: receipt.blockNumber,
    expiryDate: canonicalDateFromSource(
      idRecord.expiryDate,
      'idRecord.expiryDate',
      { nullable: true }
    ),
    idNumber: trimmedSourceString(idRecord.idNumber, 'idRecord.idNumber'),
    idType: trimmedSourceString(idRecord.department, 'idRecord.department'),
    issuedDate: canonicalDateFromSource(idRecord.issuedDate, 'idRecord.issuedDate'),
    maskedName: `${maskName(lastName)}, ${maskName(firstName)}`,
    releasedAt: canonicalInstantFromSource(
      idRecord.releasedAt,
      'idRecord.releasedAt',
      { nullable: true }
    ),
    status: trimmedSourceString(idRecord.status, 'idRecord.status'),
    txId: receipt.txId,
  };

  return immutableProjection(payload);
}

module.exports = {
  buildVerificationPayload,
  maskName,
};
