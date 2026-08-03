const mongoose = require('mongoose');
const { Schema } = mongoose;

const ChainOutboxSchema = new Schema(
  {
    operationId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },
    operation: {
      type: String,
      enum: ['ANCHOR', 'REVOKE', 'EXPIRE'],
      required: true,
      immutable: true,
    },
    idRecordId: {
      type: Schema.Types.ObjectId,
      ref: 'IDRecord',
      required: true,
      index: true,
      immutable: true,
    },
    recordRef: {
      type: String,
      required: true,
      immutable: true,
    },
    sequence: {
      type: Number,
      required: true,
      immutable: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    state: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'SENT', 'BLOCKED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    attempts:        { type: Number, default: 0 },
    nextAttempt:     { type: Date, default: Date.now, index: true },
    lastError:       String,
    lockOwner:       String,
    lockedUntil:     Date,
    alertedAt:       Date,
    txId:            String,
    blockNumber:     Number,
    ledgerEpoch:     String,
    reconciled:      { type: Boolean, default: false },
    completedAt:     Date,
  },
  { timestamps: true }
);

ChainOutboxSchema.index({ state: 1, nextAttempt: 1 });
ChainOutboxSchema.index({ recordRef: 1, sequence: 1 }, { unique: true });

ChainOutboxSchema.pre('save', function rejectPayloadMutation() {
  if (!this.isNew && this.isModified('payload')) {
    throw new Error('ChainOutbox payload is immutable');
  }
});

module.exports = mongoose.model('ChainOutbox', ChainOutboxSchema);
