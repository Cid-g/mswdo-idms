/**
 * Demo data seeder — populates dashboards & reports for presentation.
 *
 *   node scripts/seedDemo.js          # clears previous demo data, then seeds ~150/dept + IDs
 *   node scripts/seedDemo.js --clear  # removes ALL demo data only
 *
 * Reversible & safe: every demo Applicant is tagged with a sentinel encodedById
 * (000000000000000000000000) and every demo IDRecord uses a "DEMO-" idNumber prefix.
 * Real records (with a real encoder) are never touched.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Applicant = require('../src/models/Applicant');
const IDRecord = require('../src/models/IDRecord');
const {
  BARANGAYS, PWD_DISABILITY_TYPES,
} = require('../src/lib/constants');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mswdo_idms';
const SENTINEL = new mongoose.Types.ObjectId('000000000000000000000000');
const PER_DEPT = 150;
const ID_RATE = 0.7; // fraction of records that get an issued ID card

// ── helpers ────────────────────────────────────────────────
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const chance = (p) => Math.random() < p;
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
  return pairs[0][0];
}
const DAY = 86400000;
const daysAgo = (d) => new Date(Date.now() - d * DAY);
const recentMonths = (maxMonths) => daysAgo(rand(maxMonths * 30));
function birthdateForAge(age) {
  return new Date(new Date().getFullYear() - age, rand(12), rand(28) + 1);
}

const FIRST_M = ['Juan', 'Pedro', 'Jose', 'Mario', 'Ramon', 'Andres', 'Carlos', 'Ernesto', 'Roberto', 'Danilo', 'Eduardo', 'Nestor', 'Rolando', 'Alfredo', 'Benigno', 'Ricardo', 'Fernando', 'Arturo'];
const FIRST_F = ['Maria', 'Rosa', 'Ana', 'Luz', 'Elena', 'Teresa', 'Corazon', 'Gloria', 'Lourdes', 'Josefa', 'Remedios', 'Cristina', 'Nimfa', 'Erlinda', 'Imelda', 'Soledad', 'Felisa', 'Dolores'];
const LAST = ['Dela Cruz', 'Santos', 'Reyes', 'Bautista', 'Garcia', 'Ramos', 'Mendoza', 'Castro', 'Flores', 'Villanueva', 'Aquino', 'Torres', 'Domingo', 'Salvador', 'Padilla', 'Gonzales', 'Rivera', 'Navarro', 'Bernardo', 'Cruz', 'Macaraeg', 'Bumanglag', 'Sembrano', 'Pascual'];

function person(sex) {
  return {
    firstName: sex === 'Male' ? pick(FIRST_M) : pick(FIRST_F),
    lastName: pick(LAST),
    middleName: pick(LAST),
    sex,
  };
}

let seq = 0;
const seqStr = () => String(++seq).padStart(5, '0');

function makeSoloParent() {
  const sex = chance(0.88) ? 'Female' : 'Male';
  const spicStatus = chance(0.7) ? 'New' : 'Renewal';
  // ~45% recent (spread last 16 months -> mix of valid/expiring/expired) + rest older years
  const dateSpicIssued = chance(0.45)
    ? recentMonths(16)
    : new Date(2016 + rand(8), rand(12), rand(28) + 1);
  return {
    department: 'SOLO_PARENT', status: 'COMPLETE', recordStatus: 'ACTIVE',
    transactionType: spicStatus === 'New' ? 'New' : 'Renew',
    encodedById: SENTINEL,
    ...person(sex),
    birthdate: birthdateForAge(20 + rand(45)),
    barangay: pick(BARANGAYS),
    soloParent: {
      categoryCode: weighted([['A2', 30], ['A5', 22], ['C', 18], ['A7', 8], ['A6', 6], ['B1', 3], ['D', 3], ['B2', 2], ['A1', 2], ['A3', 2], ['A4', 2], ['E', 1], ['F', 1]]),
      spicStatus,
      dateSpicIssued,
      spicNumber: `SP-${seqStr()}`,
    },
  };
}

function makePwd() {
  const sex = chance(0.5) ? 'Male' : 'Female';
  const disabilityType = weighted([
    [PWD_DISABILITY_TYPES[4], 28], [PWD_DISABILITY_TYPES[7], 14], [PWD_DISABILITY_TYPES[0], 12],
    [PWD_DISABILITY_TYPES[1], 10], [PWD_DISABILITY_TYPES[3], 10], [PWD_DISABILITY_TYPES[5], 8],
    [PWD_DISABILITY_TYPES[6], 6], [PWD_DISABILITY_TYPES[2], 6], [PWD_DISABILITY_TYPES[8], 4],
    [PWD_DISABILITY_TYPES[9], 2],
  ]);
  return {
    department: 'PWD', status: 'COMPLETE',
    recordStatus: weighted([['ACTIVE', 82], ['EXPIRED', 10], ['DECEASED', 3], ['TRANSFERRED', 3], ['REVOKED', 2]]),
    transactionType: chance(0.75) ? 'New' : 'Renew',
    encodedById: SENTINEL,
    ...person(sex),
    birthdate: birthdateForAge(rand(85) + 1), // 1-85 -> all age brackets
    barangay: pick(BARANGAYS),
    pwd: { disabilityType, uploadedToDOH: chance(0.6) },
  };
}

function makeSc() {
  const sex = chance(0.58) ? 'Female' : 'Male';
  const pensionType = weighted([['socpen', 30], ['SSS', 22], ['None', 14], ['GSIS', 12], ['local socpen', 12], ['Socpen/SSS', 6], ['PVAO', 4]]);
  return {
    department: 'SENIOR_CITIZEN', status: 'COMPLETE', recordStatus: 'ACTIVE',
    transactionType: 'New',
    encodedById: SENTINEL,
    ...person(sex),
    birthdate: birthdateForAge(60 + rand(36)), // 60-95 -> all SC brackets
    barangay: pick(BARANGAYS),
    contactNumber: `09${rand(900000000) + 100000000}`,
    seniorCitizen: {
      oscaNumber: `OSCA-${seqStr()}`,
      maritalStatus: pick(['Married', 'Widowed', 'Single', 'Separated']),
      isPensioner: pensionType !== 'None',
      pensionType,
      pensionAmount: pensionType === 'None' ? 0 : weighted([[500, 5], [1000, 4], [1500, 2], [2000, 2], [3000, 1]]),
      registrationCategory: chance(0.7) ? 'Walk-In' : 'Caravan',
      dateIssued: recentMonths(12),
      rrn: `RRN-${seqStr()}`,
      livingStatus: pick(['Owned', 'Rent', 'Living Alone', 'Living with Relatives']),
      occupation: pick(['Retired', 'Farmer', 'None', 'Vendor', 'Housekeeper']),
      income: weighted([[0, 5], [2000, 3], [5000, 2]]),
      medicalCondition: pick(['Hypertension', 'Diabetes', 'Arthritis', 'None']),
      medicine: pick(['Losartan', 'Metformin', 'Amlodipine', 'None']),
      isDisabled: chance(0.15),
    },
  };
}

async function clearDemo() {
  const a = await Applicant.deleteMany({ encodedById: SENTINEL });
  const r = await IDRecord.deleteMany({ idNumber: { $regex: '^DEMO-' } });
  return { applicants: a.deletedCount, ids: r.deletedCount };
}

async function seed() {
  const cleared = await clearDemo();
  console.log(`Cleared previous demo data: ${cleared.applicants} applicants, ${cleared.ids} IDs`);

  const all = [
    ...Array.from({ length: PER_DEPT }, makeSoloParent),
    ...Array.from({ length: PER_DEPT }, makePwd),
    ...Array.from({ length: PER_DEPT }, makeSc),
  ];
  const inserted = await Applicant.insertMany(all);
  console.log(`Inserted ${inserted.length} demo applicants (${PER_DEPT}/dept)`);

  const idRecs = [];
  inserted.forEach((doc, i) => {
    if (doc.recordStatus !== 'ACTIVE') return;
    if (!chance(ID_RATE)) return;
    const dept2 = doc.department.slice(0, 2);
    idRecs.push({
      applicantId: doc._id,
      department: doc.department,
      idNumber: `DEMO-${dept2}-${Date.now()}-${i}`,
      qrToken: `DEMO-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 10)}`,
      issuedDate: recentMonths(6), // last 6 months -> fills the monthly issuance chart
      status: chance(0.9) ? 'ACTIVE' : 'REVOKED',
    });
  });
  const insertedIds = await IDRecord.insertMany(idRecs);
  console.log(`Issued ${insertedIds.length} demo ID cards`);
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected: ${MONGODB_URI}`);
  if (process.argv.includes('--clear')) {
    const c = await clearDemo();
    console.log(`Removed demo data: ${c.applicants} applicants, ${c.ids} IDs`);
  } else {
    await seed();
  }
  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => { console.error('Seed failed:', err); process.exit(1); });
