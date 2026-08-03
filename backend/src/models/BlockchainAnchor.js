const mongoose = require('mongoose');
const { Schema } = mongoose;

const BlockchainAnchorSchema = new Schema(
  {
    idRecordId:      { type: Schema.Types.ObjectId, ref: 'IDRecord', unique: true },
    recordRef:       { type: String, unique: true }, // = idRecord.idNumber
    canonicalHash:   String, // SHA-256
    txId:            String, // Hyperledger Fabric transaction ID
    blockNumber:     Number,
    ledgerEpoch:     String,
    receiptState:    { type: String, enum: ['CURRENT', 'STALE'], default: 'CURRENT' },
    reconciledAt:    Date,
    anchoredAt:      { type: Date, default: Date.now },
    lastCheckedAt:   Date,
    lastCheckPassed: Boolean,
  },
  { timestamps: true }
);

module.exports = mongoose.model('BlockchainAnchor', BlockchainAnchorSchema);
