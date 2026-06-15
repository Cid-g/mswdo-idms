'use strict';

const Applicant = require('../../models/Applicant');
const { BARANGAYS, PENSION_TYPES } = require('../constants');
const { SEX_NORMALIZE } = require('../aggHelpers');

// Friendly labels matching the LGU "Pension Data" report tab.
const PENSION_LABELS = {
  socpen: "Social Pension (Nat'l)",
  'local socpen': 'Social Pension (Local)',
  SSS: 'SSS Pensioner',
  GSIS: 'GSIS Pensioner',
  PVAO: 'PVAO Pensioner',
  'Socpen/SSS': 'Socpen + SSS',
  None: 'No Pension',
};

const PENSION_GROUPS = [...PENSION_TYPES, 'Other/Unspecified'];

async function buildPensionByBarangayReport() {
  const agg = await Applicant.aggregate([
    { $match: { department: 'SENIOR_CITIZEN', recordStatus: 'ACTIVE' } },
    { $addFields: { _sex: SEX_NORMALIZE } },
    { $group: { _id: { barangay: '$barangay', type: '$seniorCitizen.pensionType', sex: '$_sex' }, count: { $sum: 1 } } },
  ]);

  const known = new Set(PENSION_TYPES);
  const groupIndex = {};
  PENSION_GROUPS.forEach((g, i) => { groupIndex[g] = i; });
  const otherIdx = groupIndex['Other/Unspecified'];

  const lookup = {};
  agg.forEach(({ _id, count }) => {
    if (!_id.barangay) return;
    const b = _id.barangay;
    const gi = known.has(_id.type) ? groupIndex[_id.type] : otherIdx;
    lookup[b] = lookup[b] || {};
    lookup[b][gi] = lookup[b][gi] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[b][gi].male += count;
    else if (_id.sex === 'Female') lookup[b][gi].female += count;
  });

  const totals = {};
  PENSION_GROUPS.forEach((g, i) => { totals[`p${i}_m`] = 0; totals[`p${i}_f`] = 0; totals[`p${i}_t`] = 0; });
  totals.all_m = 0; totals.all_f = 0; totals.all_t = 0;

  const rows = BARANGAYS.map((barangay, bi) => {
    const row = { no: bi + 1, barangay };
    let aM = 0;
    let aF = 0;
    PENSION_GROUPS.forEach((g, i) => {
      const v = (lookup[barangay] && lookup[barangay][i]) || { male: 0, female: 0 };
      row[`p${i}_m`] = v.male;
      row[`p${i}_f`] = v.female;
      row[`p${i}_t`] = v.male + v.female;
      aM += v.male;
      aF += v.female;
      totals[`p${i}_m`] += v.male;
      totals[`p${i}_f`] += v.female;
      totals[`p${i}_t`] += v.male + v.female;
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
    ...PENSION_GROUPS.map((g, i) => ({
      label: PENSION_LABELS[g] || g,
      columns: [
        { key: `p${i}_m`, label: 'M', align: 'right' },
        { key: `p${i}_f`, label: 'F', align: 'right' },
        { key: `p${i}_t`, label: 'Total', align: 'right' },
      ],
    })),
    {
      label: 'Total (SC)',
      columns: [
        { key: 'all_m', label: 'M', align: 'right' },
        { key: 'all_f', label: 'F', align: 'right' },
        { key: 'all_t', label: 'Total', align: 'right' },
      ],
    },
  ];

  return {
    id: 'pension-by-barangay',
    title: 'Senior Citizens per Pension Type by Barangay',
    asOf: new Date().toISOString(),
    columnGroups,
    rows,
    totals,
  };
}

module.exports = { buildPensionByBarangayReport };
