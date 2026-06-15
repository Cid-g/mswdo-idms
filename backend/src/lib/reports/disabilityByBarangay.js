'use strict';

const Applicant = require('../../models/Applicant');
const { BARANGAYS, PWD_DISABILITY_TYPES } = require('../constants');
const { SEX_NORMALIZE } = require('../aggHelpers');

const stripNumPrefix = (s) => (s || '').replace(/^\d+\.\s*/, '');

async function buildDisabilityByBarangayReport() {
  const agg = await Applicant.aggregate([
    { $match: { department: 'PWD', recordStatus: 'ACTIVE' } },
    { $addFields: { _sex: SEX_NORMALIZE } },
    { $group: { _id: { barangay: '$barangay', type: '$pwd.disabilityType', sex: '$_sex' }, count: { $sum: 1 } } },
  ]);

  const typeIndex = {};
  PWD_DISABILITY_TYPES.forEach((t, i) => { typeIndex[t] = i; });

  const lookup = {};
  agg.forEach(({ _id, count }) => {
    if (!_id.barangay || typeIndex[_id.type] === undefined) return;
    const b = _id.barangay;
    const di = typeIndex[_id.type];
    lookup[b] = lookup[b] || {};
    lookup[b][di] = lookup[b][di] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[b][di].male += count;
    else if (_id.sex === 'Female') lookup[b][di].female += count;
  });

  const totals = {};
  PWD_DISABILITY_TYPES.forEach((t, i) => { totals[`d${i}_m`] = 0; totals[`d${i}_f`] = 0; totals[`d${i}_t`] = 0; });
  totals.all_m = 0; totals.all_f = 0; totals.all_t = 0;

  const rows = BARANGAYS.map((barangay, bi) => {
    const row = { no: bi + 1, barangay };
    let aM = 0;
    let aF = 0;
    PWD_DISABILITY_TYPES.forEach((t, i) => {
      const v = (lookup[barangay] && lookup[barangay][i]) || { male: 0, female: 0 };
      row[`d${i}_m`] = v.male;
      row[`d${i}_f`] = v.female;
      row[`d${i}_t`] = v.male + v.female;
      aM += v.male;
      aF += v.female;
      totals[`d${i}_m`] += v.male;
      totals[`d${i}_f`] += v.female;
      totals[`d${i}_t`] += v.male + v.female;
    });
    row.all_m = aM;
    row.all_f = aF;
    row.all_t = aM + aF;
    totals.all_m += aM;
    totals.all_f += aF;
    totals.all_t += aM + aF;
    return row;
  });

  const columnGroups = [
    {
      label: null,
      columns: [
        { key: 'no', label: 'No.', align: 'right' },
        { key: 'barangay', label: 'Barangay' },
      ],
    },
    ...PWD_DISABILITY_TYPES.map((t, i) => ({
      label: stripNumPrefix(t),
      columns: [
        { key: `d${i}_m`, label: 'M', align: 'right' },
        { key: `d${i}_f`, label: 'F', align: 'right' },
        { key: `d${i}_t`, label: 'Total', align: 'right' },
      ],
    })),
    {
      label: 'Total (PWD)',
      columns: [
        { key: 'all_m', label: 'M', align: 'right' },
        { key: 'all_f', label: 'F', align: 'right' },
        { key: 'all_t', label: 'Total', align: 'right' },
      ],
    },
  ];

  return {
    id: 'disability-by-barangay',
    title: 'Type of Disability per Barangay',
    asOf: new Date().toISOString(),
    columnGroups,
    rows,
    totals,
  };
}

module.exports = { buildDisabilityByBarangayReport };
