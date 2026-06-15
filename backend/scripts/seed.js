/**
 * Seed script — creates SuperAdmin + 3 dept Admins.
 * Safe to re-run: skips accounts that already exist.
 *
 * Usage: npm run seed
 * Configure credentials in .env (copy .env.example → .env)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mswdo_idms';
const BCRYPT_ROUNDS = 12;

const seedUsers = [
  {
    role: 'SUPERADMIN',
    department: null,
    username: process.env.SEED_SUPERADMIN_USERNAME || 'superadmin',
    email: process.env.SEED_SUPERADMIN_EMAIL || 'superadmin@mswdo-gerona.gov.ph',
    password: process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@1234!',
    firstName: 'Super',
    lastName: 'Admin',
  },
  {
    role: 'ADMIN',
    department: 'PWD',
    username: process.env.SEED_PWD_ADMIN_USERNAME || 'admin.pwd',
    email: process.env.SEED_PWD_ADMIN_EMAIL || 'admin.pwd@mswdo-gerona.gov.ph',
    password: process.env.SEED_PWD_ADMIN_PASSWORD || 'Admin@1234!',
    firstName: 'PWD',
    lastName: 'Admin',
  },
  {
    role: 'ADMIN',
    department: 'SOLO_PARENT',
    username: process.env.SEED_SP_ADMIN_USERNAME || 'admin.soloparent',
    email: process.env.SEED_SP_ADMIN_EMAIL || 'admin.sp@mswdo-gerona.gov.ph',
    password: process.env.SEED_SP_ADMIN_PASSWORD || 'Admin@1234!',
    firstName: 'Solo Parent',
    lastName: 'Admin',
  },
  {
    role: 'ADMIN',
    department: 'SENIOR_CITIZEN',
    username: process.env.SEED_SC_ADMIN_USERNAME || 'admin.seniorcitizen',
    email: process.env.SEED_SC_ADMIN_EMAIL || 'admin.sc@mswdo-gerona.gov.ph',
    password: process.env.SEED_SC_ADMIN_PASSWORD || 'Admin@1234!',
    firstName: 'Senior Citizen',
    lastName: 'Admin',
  },
];

async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected to MongoDB: ${MONGODB_URI}\n`);

  for (const u of seedUsers) {
    const existing = await User.findOne({ username: u.username });

    if (existing) {
      const fieldsToUpdate = {};
      if (existing.firstName !== u.firstName) fieldsToUpdate.firstName = u.firstName;
      if (existing.lastName  !== u.lastName)  fieldsToUpdate.lastName  = u.lastName;

      if (Object.keys(fieldsToUpdate).length > 0) {
        await User.updateOne({ _id: existing._id }, { $set: fieldsToUpdate });
        console.log(`PATCHED ${u.role.padEnd(15)} ${u.username} — updated: ${Object.keys(fieldsToUpdate).join(', ')}`);
      } else {
        console.log(`SKIP  ${u.role.padEnd(16)} ${u.username} (already exists)`);
      }
      continue;
    }

    const passwordHash = await bcrypt.hash(u.password, BCRYPT_ROUNDS);
    await User.create({
      firstName:    u.firstName,
      lastName:     u.lastName,
      username:     u.username,
      email:        u.email,
      passwordHash,
      role:         u.role,
      department:   u.department,
      status:       'ACTIVE',
      createdById:  null,
    });

    console.log(`CREATED ${u.role.padEnd(16)} ${u.username}`);
  }

  console.log('\nSeed complete.');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
