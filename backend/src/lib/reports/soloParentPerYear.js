'use strict';

const Applicant = require('../../models/Applicant');
const { SEX_NORMALIZE } = require('../aggHelpers');

async function buildSoloParentPerYearReport() {
  const agg = await Applicant.aggregate([
    { $match: { department: 'SOLO_PARENT', recordStatus: 'ACTIVE', 'soloParent.dateSpicIssued': { $ne: null } } },
    { $addFields: { _sex: SEX_NORMALIZE, _year: { $year: '$soloParent.dateSpicIssued' } } },
    { $group: { _id: { year: '$_year', sex: '$_sex' }, count: { $sum: 1 } } },
  ]);

  const lookup = {};
  agg.forEach(({ _id, count }) => {
    lookup[_id.year] = lookup[_id.year] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[_id.year].male += count;
    else if (_id.sex === 'Female') lookup[_id.year].female += count;
  });

  let tMale = 0;
  let tFemale = 0;
  const rows = Object.keys(lookup)
    .map(Number)
    .sort((a, b) => a - b)
    .map((year) => {
      const v = lookup[year];
      tMale += v.male;
      tFemale += v.female;
      return { year, male: v.male, female: v.female, total: v.male + v.female };
    });

  return {
    id: 'solo-parent-per-year',
    title: 'Solo Parents per Year of Registration',
    asOf: new Date().toISOString(),
    columns: [
      { key: 'year', label: 'Year' },
      { key: 'male', label: 'Male', align: 'right' },
      { key: 'female', label: 'Female', align: 'right' },
      { key: 'total', label: 'Total', align: 'right' },
    ],
    rows,
    totals: { male: tMale, female: tFemale, total: tMale + tFemale },
  };
}

module.exports = { buildSoloParentPerYearReport };
