const mongoose = require('mongoose');
const { Schema } = mongoose;
const { ROLES, USER_STATUS, DEPARTMENTS } = require('../lib/constants');

const UserSchema = new Schema(
  {
    employeeId:   { type: String },
    firstName:    { type: String, required: true },
    lastName:     { type: String, required: true },
    middleName:   { type: String },
    username:     { type: String, required: true, unique: true },
    email:        { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role:         { type: String, enum: ROLES, required: true },
    department:   { type: String, enum: DEPARTMENTS, default: null }, // null for SUPERADMIN
    status:       { type: String, enum: USER_STATUS, default: 'ACTIVE' },
    avatarPath:   { type: String, default: null },
    createdById:  { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
