const mongoose = require('mongoose');
const { Schema } = mongoose;

const IDTemplateVersionSchema = new Schema(
  {
    templateId:    { type: Schema.Types.ObjectId, ref: 'IDTemplate', required: true, index: true },
    versionNumber: { type: Number, required: true },
    note:          { type: String, default: '' },
    front: {
      imagePath:         { type: String, default: null },
      placeholderConfig: { type: Schema.Types.Mixed, default: {} },
    },
    back: {
      imagePath:         { type: String, default: null },
      placeholderConfig: { type: Schema.Types.Mixed, default: {} },
    },
    uploadedById: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

IDTemplateVersionSchema.index({ templateId: 1, versionNumber: 1 }, { unique: true });

module.exports = mongoose.model('IDTemplateVersion', IDTemplateVersionSchema);
