'use strict';

const mongoose = require('mongoose');

const {
  normalizeIdRecordRef,
  normalizeOperationRef,
  normalizeResyncRequest,
  operationEvent,
  requireSuperadminActor,
  safeFailureClassification,
  serializeVerificationOperation,
  staleProcessingQuery,
  verificationEpoch,
} = require('../../src/services/verificationOutboxOperations');

const NOW = new Date('2026-08-06T10:00:00.000Z');

function operation(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId('64b7f1f77bcf86cd79943901'),
    operationId: 'verify:anchor_receipt:507f1f77bcf86cd799439011:tx-1',
    idRecordId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
    tokenHash: 'a'.repeat(64),
    payload: { maskedName: 'must not be serialized' },
    payloadDigest: 'b'.repeat(64),
    epoch: 2,
    revision: 7,
    state: 'FAILED',
    attempts: 3,
    nextAttempt: new Date('2026-08-06T09:30:00.000Z'),
    lastError: 'code=VERIFY_SYNC_REJECTED remoteCode=EQUAL_REVISION_DIGEST_CONFLICT status=409',
    lockOwner: 'host:pid:secret-owner',
    lockedUntil: new Date('2026-08-06T09:59:00.000Z'),
    createdAt: new Date('2026-08-06T09:00:00.000Z'),
    updatedAt: new Date('2026-08-06T09:30:00.000Z'),
    ...overrides,
  };
}

describe('verification outbox operations helpers', () => {

  test('normalizes only opaque Mongo operation references', () => {
    expect(normalizeOperationRef('64B7F1F77BCF86CD79943901'))
      .toBe('64b7f1f77bcf86cd79943901');
    expect(() => normalizeOperationRef('verify:issue:507f1f77bcf86cd799439011'))
      .toThrow(expect.objectContaining({
        code: 'INVALID_VERIFICATION_OPERATION_REF',
        status: 400,
      }));
  });


  test('normalizes only opaque ID-record references', () => {
    expect(normalizeIdRecordRef('507F1F77BCF86CD799439011'))
      .toBe('507f1f77bcf86cd799439011');
    expect(() => normalizeIdRecordRef('PWD-2026-0001'))
      .toThrow(expect.objectContaining({ code: 'INVALID_ID_RECORD_REF', status: 400 }));
  });

  test('accepts only an exact privacy-safe resync request shape', () => {
    expect(normalizeResyncRequest({ requestId: 'recovery-request-001' }))
      .toEqual({ requestId: 'recovery-request-001' });
    expect(() => normalizeResyncRequest({
      requestId: 'recovery-request-001',
      reason: 'free text is not accepted',
    })).toThrow(expect.objectContaining({
      code: 'INVALID_VERIFICATION_RESYNC_REQUEST',
      status: 400,
    }));
    expect(() => normalizeResyncRequest({ requestId: 'UPPER CASE' }))
      .toThrow(expect.objectContaining({
        code: 'INVALID_VERIFICATION_RESYNC_REQUEST_ID',
        status: 400,
      }));
  });

  test('loads a positive verification epoch and fails closed on bad configuration', () => {
    expect(verificationEpoch({ VERIFY_EPOCH: '3' })).toBe(3);
    expect(verificationEpoch({})).toBe(1);
    expect(() => verificationEpoch({ VERIFY_EPOCH: '0' }))
      .toThrow(expect.objectContaining({ code: 'VERIFY_CONFIGURATION_INVALID' }));
  });

  test('enforces SuperAdmin recovery authorization inside the service boundary', () => {
    expect(requireSuperadminActor({
      id: '507f1f77bcf86cd799439011',
      role: 'SUPERADMIN',
      department: null,
    })).toEqual({
      id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
      department: null,
    });
    expect(() => requireSuperadminActor({
      id: '507f1f77bcf86cd799439011',
      role: 'ADMIN',
      department: 'PWD',
    })).toThrow(expect.objectContaining({ code: 'FORBIDDEN', status: 403 }));
  });

  test('extracts only the normalized operation event from canonical IDs', () => {
    expect(operationEvent('verify:issue:507f1f77bcf86cd799439011')).toBe('ISSUE');
    expect(operationEvent('verify:anchor_receipt:507f1f77bcf86cd799439011:tx-1')).toBe('ANCHOR_RECEIPT');
    expect(operationEvent('unexpected-format')).toBe('UNKNOWN');
  });

  test('parses only allow-listed safe failure tokens', () => {
    expect(safeFailureClassification(
      'code=VERIFY_SYNC_REJECTED remoteCode=EQUAL_REVISION_DIGEST_CONFLICT status=409 secret=https://private'
    )).toEqual({
      code: 'VERIFY_SYNC_REJECTED',
      remoteCode: 'EQUAL_REVISION_DIGEST_CONFLICT',
      status: 409,
    });
    expect(safeFailureClassification('database password leaked', { required: true })).toEqual({
      code: 'VERIFY_SYNC_UNKNOWN_FAILURE',
      remoteCode: null,
      status: null,
    });
    expect(safeFailureClassification(null)).toBeNull();
  });

  test('serializes operational metadata without queue secrets or projection data', () => {
    const serialized = serializeVerificationOperation(operation(), { now: NOW });

    expect(serialized).toEqual({
      operationRef: '64b7f1f77bcf86cd79943901',
      event: 'ANCHOR_RECEIPT',
      idRecordId: '507f1f77bcf86cd799439011',
      epoch: 2,
      revision: 7,
      state: 'FAILED',
      attempts: 3,
      nextAttempt: new Date('2026-08-06T09:30:00.000Z'),
      failure: {
        code: 'VERIFY_SYNC_REJECTED',
        remoteCode: 'EQUAL_REVISION_DIGEST_CONFLICT',
        status: 409,
      },
      lease: null,
      createdAt: new Date('2026-08-06T09:00:00.000Z'),
      updatedAt: new Date('2026-08-06T09:30:00.000Z'),
    });
    expect(serialized).not.toHaveProperty('operationId');
    expect(serialized).not.toHaveProperty('tokenHash');
    expect(serialized).not.toHaveProperty('payload');
    expect(serialized).not.toHaveProperty('payloadDigest');
    expect(serialized).not.toHaveProperty('lastError');
    expect(serialized).not.toHaveProperty('lockOwner');
  });

  test('classifies processing leases without exposing the owner', () => {
    expect(serializeVerificationOperation(operation({
      state: 'PROCESSING',
      lastError: undefined,
      lockedUntil: new Date('2026-08-06T09:59:59.999Z'),
    }), { now: NOW }).lease).toEqual({
      state: 'EXPIRED',
      lockedUntil: new Date('2026-08-06T09:59:59.999Z'),
    });

    expect(serializeVerificationOperation(operation({
      state: 'PROCESSING',
      lastError: undefined,
      lockedUntil: undefined,
    }), { now: NOW }).lease).toEqual({ state: 'MISSING', lockedUntil: null });
  });

  test('builds a read-only stale lease selector', () => {
    expect(staleProcessingQuery(NOW)).toEqual({
      state: 'PROCESSING',
      $or: [
        { lockedUntil: { $lte: NOW } },
        { lockedUntil: { $exists: false } },
        { lockedUntil: null },
      ],
    });
  });
});
