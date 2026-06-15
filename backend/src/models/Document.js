const mongoose = require('mongoose');
const { Schema } = mongoose;

const DocumentSchema = new Schema(
  {
    applicantId:  { type: Schema.Types.ObjectId, ref: 'Applicant', required: true },
    documentType: String,
    fileName:     String,
    filePath:     String,
    mimeType:     String,
    fileSize:     Number,
    uploadedById: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Document', DocumentSchema);
