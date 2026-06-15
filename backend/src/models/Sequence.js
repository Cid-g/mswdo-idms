const mongoose = require('mongoose');
const { Schema } = mongoose;

const SequenceSchema = new Schema({
  name:  { type: String, unique: true }, // e.g. 'PWD-2026', 'SC-2026', 'SP-2605'
  value: { type: Number, default: 0 },
});

module.exports = mongoose.model('Sequence', SequenceSchema);
