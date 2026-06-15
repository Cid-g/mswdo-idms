const mongoose = require('mongoose');
const { Schema } = mongoose;

const AuditLogSchema = new Schema(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User' },
    action:      { type: String, required: true },
    department:  String,
    targetType:  String, // 'Applicant', 'IDRecord', 'User', 'IDTemplate'
    targetId:    String,
    description: { type: String, required: true },
    metadata:    Schema.Types.Mixed,
    ipAddress:   String,
    userAgent:   String,
  },
  { timestamps: true }
);

AuditLogSchema.index({ department: 1 });
AuditLogSchema.index({ action: 1 });
AuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
