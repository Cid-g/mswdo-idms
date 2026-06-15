'use strict';

const Applicant = require('../../models/Applicant');
const { BARANGAYS } = require('../constants');
const { SEX_NORMALIZE } = require('../aggHelpers');

const DEPT_NOUN = {
  SOLO_PARENT: 'Solo Parents',
  PWD: 'Persons with Disability',
  SENIOR_CITIZEN: 'Senior Citizens',
};

async function buildPerBarangayReport(dept) {
  const agg = await Applicant.aggregate([
    { $match: { department: dept, recordStatus: 'ACTIVE' } },
    { $addFields: { _sex: SEX_NORMALIZE } },
    { $group: { _id: { barangay: '$barangay', sex: '$_sex' }, count: { $sum: 1 } } },
  ]);

  const lookup = {};
  agg.forEach(({ _id, count }) => {
    if (!_id.barangay) return;
    lookup[_id.barangay] = lookup[_id.barangay] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[_id.barangay].male += count;
    else if (_id.sex === 'Female') lookup[_id.barangay].female += count;
  });

  let tMale = 0;
  let tFemale = 0;
  const rows = BARANGAYS.map((barangay, i) => {
    const v = lookup[barangay] || { male: 0, female: 0 };
    tMale += v.male;
    tFemale += v.female;
    return { no: i + 1, barangay, male: v.male, female: v.female, total: v.male + v.female };
  });

  return {
    id: 'per-barangay',
    title: `${DEPT_NOUN[dept]} per Barangay`,
    asOf: new Date().toISOString(),
    columns: [
      { key: 'no', label: 'No.', align: 'right' },
      { key: 'barangay', label: 'Barangay' },
      { key: 'male', label: 'Male', align: 'right' },
      { key: 'female', label: 'Female', align: 'right' },
      { key: 'total', label: 'Total', align: 'right' },
    ],
    rows,
    totals: { male: tMale, female: tFemale, total: tMale + tFemale },
  };
}

module.exports = { buildPerBarangayReport, DEPT_NOUN };
