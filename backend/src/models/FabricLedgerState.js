'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const FabricLedgerStateSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: 'primary',
    },
    acceptedEpoch: String,
    observedEpoch: String,
    status: {
      type: String,
      enum: ['ACTIVE', 'MISMATCH'],
      default: 'ACTIVE',
      required: true,
      index: true,
    },
    detectedAt: Date,
    acceptedAt: Date,
    acceptedById: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FabricLedgerState', FabricLedgerStateSchema);
