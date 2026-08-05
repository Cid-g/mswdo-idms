'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const {
  SHA256_PATTERN,
  digestVerificationPayload,
  validateVerificationPayload,
} = require('../lib/verificationPayload');

const VERIFY_OUTBOX_STATES = Object.freeze(['PENDING', 'PROCESSING', 'SENT', 'FAILED']);

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

const VerifyOutboxSchema = new Schema(
  {
    operationId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      maxlength: 256,
    },
    idRecordId: {
      type: Schema.Types.ObjectId,
      ref: 'IDRecord',
      required: true,
      index: true,
      immutable: true,
    },
    tokenHash: {
      type: String,
      required: true,
      index: true,
      immutable: true,
      match: SHA256_PATTERN,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
      immutable: true,
      validate: {
        validator(value) {
          try {
            validateVerificationPayload(value);
            return true;
          } catch (_) {
            return false;
          }
        },
        message: 'VerifyOutbox payload does not match the minimized verification schema',
      },
    },
    payloadDigest: {
      type: String,
      required: true,
      immutable: true,
      match: SHA256_PATTERN,
    },
    epoch: {
      type: Number,
      required: true,
      immutable: true,
      validate: {
        validator: isPositiveSafeInteger,
        message: 'VerifyOutbox epoch must be a positive safe integer',
      },
    },
    revision: {
      type: Number,
      required: true,
      immutable: true,
      validate: {
        validator: isPositiveSafeInteger,
        message: 'VerifyOutbox revision must be a positive safe integer',
      },
    },
    state: {
      type: String,
      enum: VERIFY_OUTBOX_STATES,
      default: 'PENDING',
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: 'VerifyOutbox attempts must be a non-negative safe integer',
      },
    },
    nextAttempt: { type: Date, default: Date.now, index: true },
    lastError: { type: String, maxlength: 4000 },
    lockOwner: { type: String, maxlength: 256 },
    lockedUntil: Date,
  },
  { timestamps: true, minimize: false }
);

VerifyOutboxSchema.index({ state: 1, nextAttempt: 1 });
VerifyOutboxSchema.index(
  { idRecordId: 1, epoch: 1, revision: 1 },
  { unique: true, name: 'uniq_verify_record_revision' }
);
VerifyOutboxSchema.index(
  { tokenHash: 1, epoch: 1, revision: 1 },
  { unique: true, name: 'uniq_verify_token_revision' }
);

VerifyOutboxSchema.pre('validate', function validatePayloadDigest() {
  if (!this.isNew && this.isModified('payload')) return;
  if (!this.payload || !this.payloadDigest) return;
  let expected;
  try {
    expected = digestVerificationPayload(this.payload);
  } catch (_) {
    return;
  }
  if (expected !== this.payloadDigest) {
    this.invalidate('payloadDigest', 'VerifyOutbox payloadDigest does not match payload');
  }
});

VerifyOutboxSchema.pre('save', function rejectPayloadMutation() {
  if (!this.isNew && this.isModified('payload')) {
    throw new Error('VerifyOutbox payload is immutable');
  }
});

module.exports = mongoose.model('VerifyOutbox', VerifyOutboxSchema);
module.exports.VERIFY_OUTBOX_STATES = VERIFY_OUTBOX_STATES;
