const mongoose = require('mongoose');
const { Schema } = mongoose;
const { DEPARTMENTS } = require('../lib/constants');

const IDTemplateSchema = new Schema(
  {
    department:      { type: String, enum: DEPARTMENTS, required: true, unique: true },
    activeVersionId: { type: Schema.Types.ObjectId, ref: 'IDTemplateVersion', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('IDTemplate', IDTemplateSchema);
