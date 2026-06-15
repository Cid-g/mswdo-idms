'use strict';

const Applicant = require('../models/Applicant');
const IDRecord = require('../models/IDRecord');
const { SOLO_PARENT_CATEGORIES, BARANGAYS, PWD_DISABILITY_TYPES, PENSION_TYPES } = require('./constants');
const { SEX_NORMALIZE } = require('./aggHelpers');

const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * DAY_MS;

const PWD_AGE_BRACKETS = [
  { label: '0-17', min: 0, max: 17 },
  { label: '18-30', min: 18, max: 30 },
  { label: '31-59', min: 31, max: 59 },
  { label: '60+', min: 60, max: null },
];
const SC_AGE_BRACKETS = [
  { label: '60-69', min: 60, max: 69 },
  { label: '70-79', min: 70, max: 79 },
  { label: '80-89', min: 80, max: 89 },
  { label: '90+', min: 90, max: null },
];

function normSexJs(s) {
  if (s === 'Male' || s === 'M') return 'Male';
  if (s === 'Female' || s === 'F') return 'Female';
  return 'Unknown';
}

function computeAge(birthdate, now) {
  const b = new Date(birthdate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

function bucketAges(docs, brackets) {
  const now = new Date();
  const lookup = {};
  brackets.forEach((b) => { lookup[b.label] = { male: 0, female: 0 }; });
  docs.forEach((d) => {
    if (!d.birthdate) return;
    const sex = normSexJs(d.sex);
    if (sex === 'Unknown') return;
    const age = computeAge(d.birthdate, now);
    const b = brackets.find((br) => age >= br.min && (br.max == null || age <= br.max));
    if (!b) return;
    lookup[b.label][sex === 'Male' ? 'male' : 'female'] += 1;
  });
  return brackets.map((b) => ({
    bracket: b.label,
    male: lookup[b.label].male,
    female: lookup[b.label].female,
    total: lookup[b.label].male + lookup[b.label].female,
  }));
}

const stripNumPrefix = (s) => (s || '').replace(/^\d+\.\s*/, '');

function buildPerDisability(agg) {
  const lookup = {};
  agg.forEach(({ _id, count }) => {
    if (!_id.type) return;
    lookup[_id.type] = lookup[_id.type] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[_id.type].male += count;
    else if (_id.sex === 'Female') lookup[_id.type].female += count;
  });
  return PWD_DISABILITY_TYPES.map((code) => {
    const v = lookup[code] || { male: 0, female: 0 };
    return { code, label: stripNumPrefix(code), male: v.male, female: v.female, total: v.male + v.female };
  });
}

function buildPerCategory(agg) {
  const lookup = {};
  agg.forEach(({ _id, count }) => {
    if (!_id.code) return;
    lookup[_id.code] = lookup[_id.code] || { New: 0, Renewal: 0 };
    // null/undefined spicStatus is treated as New (transactionType defaults to New)
    if (_id.status === 'Renewal') lookup[_id.code].Renewal += count;
    else lookup[_id.code].New += count;
  });
  return SOLO_PARENT_CATEGORIES.map(({ code, label }) => {
    const c = lookup[code] || { New: 0, Renewal: 0 };
    return { code, label, new: c.New, renew: c.Renewal, total: c.New + c.Renewal };
  });
}

function buildPerBarangay(agg) {
  const lookup = {};
  agg.forEach(({ _id, count }) => {
    if (!_id.barangay) return;
    lookup[_id.barangay] = lookup[_id.barangay] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[_id.barangay].male += count;
    else if (_id.sex === 'Female') lookup[_id.barangay].female += count;
  });
  return BARANGAYS
    .map((barangay) => {
      const v = lookup[barangay] || { male: 0, female: 0 };
      return { barangay, male: v.male, female: v.female, total: v.male + v.female };
    })
    .sort((a, b) => b.total - a.total);
}

function buildPerYear(agg) {
  const lookup = {};
  agg.forEach(({ _id, count }) => {
    lookup[_id.year] = lookup[_id.year] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[_id.year].male += count;
    else if (_id.sex === 'Female') lookup[_id.year].female += count;
  });
  return Object.keys(lookup)
    .map(Number)
    .sort((a, b) => a - b)
    .map((year) => ({
      year,
      male: lookup[year].male,
      female: lookup[year].female,
      total: lookup[year].male + lookup[year].female,
    }));
}

function buildSexSplit(agg) {
  let male = 0;
  let female = 0;
  agg.forEach(({ _id, count }) => {
    if (_id === 'Male') male += count;
    else if (_id === 'Female') female += count;
  });
  return { male, female, total: male + female };
}

function buildSpicExpiry(docs) {
  const now = Date.now();
  const buckets = { expired: 0, days30: 0, days90: 0, valid: 0 };
  const soon = [];
  docs.forEach((d) => {
    if (!d.soloParent || !d.soloParent.dateSpicIssued) return;
    const issued = new Date(d.soloParent.dateSpicIssued).getTime();
    const expiry = issued + ONE_YEAR_MS;
    const daysLeft = Math.ceil((expiry - now) / DAY_MS);
    let status;
    if (daysLeft < 0) { buckets.expired += 1; status = 'expired'; }
    else if (daysLeft <= 30) { buckets.days30 += 1; status = 'days30'; }
    else if (daysLeft <= 90) { buckets.days90 += 1; status = 'days90'; }
    else { buckets.valid += 1; status = 'valid'; }

    if (status !== 'valid') {
      soon.push({
        name: `${d.lastName}, ${d.firstName}`,
        spicNumber: d.soloParent.spicNumber || null,
        dateSpicIssued: d.soloParent.dateSpicIssued,
        expiry: new Date(expiry),
        daysLeft,
        status,
      });
    }
  });
  soon.sort((a, b) => a.daysLeft - b.daysLeft);
  return { buckets, soon };
}

async function buildSoloParentReports() {
  const match = { department: 'SOLO_PARENT', recordStatus: 'ACTIVE' };

  const [categoryAgg, barangayAgg, yearAgg, sexAgg, spicDocs] = await Promise.all([
    Applicant.aggregate([
      { $match: match },
      { $group: { _id: { code: '$soloParent.categoryCode', status: '$soloParent.spicStatus' }, count: { $sum: 1 } } },
    ]),
    Applicant.aggregate([
      { $match: match },
      { $addFields: { _sex: SEX_NORMALIZE } },
      { $group: { _id: { barangay: '$barangay', sex: '$_sex' }, count: { $sum: 1 } } },
    ]),
    Applicant.aggregate([
      { $match: { ...match, 'soloParent.dateSpicIssued': { $ne: null } } },
      { $addFields: { _sex: SEX_NORMALIZE, _year: { $year: '$soloParent.dateSpicIssued' } } },
      { $group: { _id: { year: '$_year', sex: '$_sex' }, count: { $sum: 1 } } },
    ]),
    Applicant.aggregate([
      { $match: match },
      { $addFields: { _sex: SEX_NORMALIZE } },
      { $group: { _id: '$_sex', count: { $sum: 1 } } },
    ]),
    Applicant.find({ ...match, 'soloParent.dateSpicIssued': { $ne: null } })
      .select('firstName lastName soloParent.spicNumber soloParent.dateSpicIssued')
      .lean(),
  ]);

  return {
    perCategory: buildPerCategory(categoryAgg),
    perBarangay: buildPerBarangay(barangayAgg),
    perYear: buildPerYear(yearAgg),
    sexSplit: buildSexSplit(sexAgg),
    spicExpiry: buildSpicExpiry(spicDocs),
  };
}

async function buildPwdReports() {
  const active = { department: 'PWD', recordStatus: 'ACTIVE' };

  const [disabilityAgg, barangayAgg, sexAgg, activeDocs, dohCount, statusAgg, idApplicantIds] =
    await Promise.all([
      Applicant.aggregate([
        { $match: active },
        { $addFields: { _sex: SEX_NORMALIZE } },
        { $group: { _id: { type: '$pwd.disabilityType', sex: '$_sex' }, count: { $sum: 1 } } },
      ]),
      Applicant.aggregate([
        { $match: active },
        { $addFields: { _sex: SEX_NORMALIZE } },
        { $group: { _id: { barangay: '$barangay', sex: '$_sex' }, count: { $sum: 1 } } },
      ]),
      Applicant.aggregate([
        { $match: active },
        { $addFields: { _sex: SEX_NORMALIZE } },
        { $group: { _id: '$_sex', count: { $sum: 1 } } },
      ]),
      // one fetch of active records — used for both age bucketing and the withoutId check
      Applicant.find(active).select('_id birthdate sex').lean(),
      Applicant.countDocuments({ ...active, 'pwd.uploadedToDOH': true }),
      Applicant.aggregate([
        { $match: { department: 'PWD' } },
        { $group: { _id: '$recordStatus', count: { $sum: 1 } } },
      ]),
      IDRecord.distinct('applicantId', { department: 'PWD' }),
    ]);

  const statusMap = {};
  statusAgg.forEach(({ _id, count }) => { statusMap[_id] = count; });
  const idSet = new Set(idApplicantIds.map((x) => String(x)));
  const withoutId = activeDocs.filter((a) => !idSet.has(String(a._id))).length;

  return {
    perDisability: buildPerDisability(disabilityAgg),
    perBarangay: buildPerBarangay(barangayAgg),
    ageDistribution: bucketAges(activeDocs, PWD_AGE_BRACKETS),
    sexSplit: buildSexSplit(sexAgg),
    statusSummary: {
      encodedToDOH: dohCount,
      withoutId,
      expired: statusMap.EXPIRED || 0,
      deceased: statusMap.DECEASED || 0,
    },
  };
}

// Human-readable labels for the raw pensionType codes (match the LGU "Pension Data" report).
const PENSION_LABELS = {
  socpen: "Social Pension (Nat'l)",
  'local socpen': 'Social Pension (Local)',
  SSS: 'SSS Pensioner',
  GSIS: 'GSIS Pensioner',
  PVAO: 'PVAO Pensioner',
  'Socpen/SSS': 'Socpen + SSS',
  None: 'No Pension',
  'Other/Unspecified': 'Other/Unspecified',
};

function buildPerPension(agg) {
  const known = new Set(PENSION_TYPES);
  const lookup = {};
  agg.forEach(({ _id, count }) => {
    const raw = _id.type;
    const key = known.has(raw) ? raw : 'Other/Unspecified';
    lookup[key] = lookup[key] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[key].male += count;
    else if (_id.sex === 'Female') lookup[key].female += count;
  });
  const list = [...PENSION_TYPES, 'Other/Unspecified'];
  return list.map((type) => {
    const v = lookup[type] || { male: 0, female: 0 };
    return { type, label: PENSION_LABELS[type] || type, male: v.male, female: v.female, total: v.male + v.female };
  });
}

function buildRegistration(agg) {
  let walkIn = 0; let caravan = 0; let unspecified = 0;
  agg.forEach(({ _id, count }) => {
    if (_id === 'Walk-In') walkIn += count;
    else if (_id === 'Caravan') caravan += count;
    else unspecified += count;
  });
  return { walkIn, caravan, unspecified };
}

async function buildSeniorReports() {
  const active = { department: 'SENIOR_CITIZEN', recordStatus: 'ACTIVE' };

  const [pensionAgg, barangayAgg, sexAgg, ageDocs, registrationAgg] = await Promise.all([
    Applicant.aggregate([
      { $match: active },
      { $addFields: { _sex: SEX_NORMALIZE } },
      { $group: { _id: { type: '$seniorCitizen.pensionType', sex: '$_sex' }, count: { $sum: 1 } } },
    ]),
    Applicant.aggregate([
      { $match: active },
      { $addFields: { _sex: SEX_NORMALIZE } },
      { $group: { _id: { barangay: '$barangay', sex: '$_sex' }, count: { $sum: 1 } } },
    ]),
    Applicant.aggregate([
      { $match: active },
      { $addFields: { _sex: SEX_NORMALIZE } },
      { $group: { _id: '$_sex', count: { $sum: 1 } } },
    ]),
    Applicant.find(active).select('birthdate sex').lean(),
    Applicant.aggregate([
      { $match: active },
      { $group: { _id: '$seniorCitizen.registrationCategory', count: { $sum: 1 } } },
    ]),
  ]);

  return {
    perPension: buildPerPension(pensionAgg),
    perBarangay: buildPerBarangay(barangayAgg),
    ageDistribution: bucketAges(ageDocs, SC_AGE_BRACKETS),
    sexSplit: buildSexSplit(sexAgg),
    registration: buildRegistration(registrationAgg),
  };
}

module.exports = { buildSoloParentReports, buildPwdReports, buildSeniorReports };
