const mongoose = require('mongoose');
const { Schema } = mongoose;

const RefreshTokenSchema = new Schema(
  {
    userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
    token:      { type: String, required: true, unique: true },
    expiresAt:  { type: Date, required: true },
    revokedAt:  Date,
    replacedBy: String, // new token hash on rotation
    ipAddress:  String,
    userAgent:  String,
  },
  { timestamps: true }
);

// token has unique:true above — no separate index needed
RefreshTokenSchema.index({ userId: 1 });
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema);
