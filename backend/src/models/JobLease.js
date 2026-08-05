'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const JobLeaseSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },
    lockOwner: {
      type: String,
      default: null,
    },
    lockedUntil: {
      type: Date,
      default: () => new Date(0),
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('JobLease', JobLeaseSchema);
