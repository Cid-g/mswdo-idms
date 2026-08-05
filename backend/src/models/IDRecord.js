const mongoose = require('mongoose');
const { Schema } = mongoose;
const { DEPARTMENTS, ID_CARD_STATUS } = require('../lib/constants');

const IDRecordSchema = new Schema(
  {
    applicantId:        { type: Schema.Types.ObjectId, ref: 'Applicant', required: true },
    department:         { type: String, enum: DEPARTMENTS },
    idNumber:           { type: String, unique: true },
    qrToken:            { type: String, unique: true },
    issuedDate:         { type: Date, default: Date.now },
    expiryDate:         Date, // null = no expiry (Senior Citizen)
    status:             { type: String, enum: ID_CARD_STATUS, default: 'ACTIVE' },
    revokedReason:      String,
    revokedAt:          Date,
    revokedById:        { type: Schema.Types.ObjectId, ref: 'User' },
    idImagePath:        String,  // front side
    idImageBackPath:    String,  // back side (null if dept has no back)
    templateVersionId:  { type: Schema.Types.ObjectId, ref: 'IDTemplateVersion', default: null },
    printCount:         { type: Number, default: 0 },
    lastPrintedAt:      Date,
    reprintCount:       { type: Number, default: 0 },
    lastReprintAt:      Date,
    lastReprintById:    { type: Schema.Types.ObjectId, ref: 'User' },
    reprintHistory:     [{
      reprintedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reprintedAt: { type: Date, default: Date.now },
      reason:      { type: String },
    }],
    releasedAt:         Date,
    releasedById:       { type: Schema.Types.ObjectId, ref: 'User' },
    blockchainAnchorId: { type: Schema.Types.ObjectId, ref: 'BlockchainAnchor' },
    chainSequence:      { type: Number, default: 0 },
    verifyRevision:     {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: 'verifyRevision must be a non-negative safe integer',
      },
    },
  },
  { timestamps: true }
);

// qrToken and idNumber have unique:true in the field definitions — no separate .index() needed
// applicantId: only ONE active ID per applicant. Revoked records keep their applicantId
// so a replacement ID can be issued after revocation (partial unique index, ACTIVE only).
IDRecordSchema.index(
  { applicantId: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' }, name: 'applicantId_active_unique' }
);

module.exports = mongoose.model('IDRecord', IDRecordSchema);
