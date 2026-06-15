'use strict';

const Applicant = require('../../models/Applicant');
const { BARANGAYS, PWD_DISABILITY_TYPES } = require('../constants');

const AGE_BRACKETS = [
  { label: '0-17', min: 0, max: 17 },
  { label: '18-30', min: 18, max: 30 },
  { label: '31-59', min: 31, max: 59 },
  { label: '60+', min: 60, max: null },
];

const stripNumPrefix = (s) => (s || '').replace(/^\d+\.\s*/, '');

function computeAge(birthdate, now) {
  const b = new Date(birthdate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

function ageIndex(age) {
  for (let i = 0; i < AGE_BRACKETS.length; i += 1) {
    const br = AGE_BRACKETS[i];
    if (age >= br.min && (br.max == null || age <= br.max)) return i;
  }
  return -1;
}

async function buildAgeByBarangayReport() {
  const now = new Date();
  const docs = await Applicant.find({ department: 'PWD', recordStatus: 'ACTIVE' })
    .select('barangay birthdate pwd.disabilityType')
    .lean();

  const typeIndex = {};
  PWD_DISABILITY_TYPES.forEach((t, i) => { typeIndex[t] = i; });

  // lookup[barangay][disabilityIndex] = [c0_17, c18_30, c31_59, c60+]
  const lookup = {};
  docs.forEach((d) => {
    if (!d.barangay || !d.birthdate || !d.pwd) return;
    const di = typeIndex[d.pwd.disabilityType];
    if (di === undefined) return;
    const ai = ageIndex(computeAge(d.birthdate, now));
    if (ai < 0) return;
    lookup[d.barangay] = lookup[d.barangay] || {};
    lookup[d.barangay][di] = lookup[d.barangay][di] || [0, 0, 0, 0];
    lookup[d.barangay][di][ai] += 1;
  });

  const totals = { total_pwd: 0 };
  AGE_BRACKETS.forEach((_, ai) => { totals[`all_a${ai}`] = 0; });
  PWD_DISABILITY_TYPES.forEach((_, di) => {
    AGE_BRACKETS.forEach((_, ai) => { totals[`d${di}_a${ai}`] = 0; });
  });

  const rows = BARANGAYS.map((barangay, bi) => {
    const row = { no: bi + 1, barangay };
    const allAges = [0, 0, 0, 0];
    let totalPwd = 0;
    PWD_DISABILITY_TYPES.forEach((t, di) => {
      const counts = (lookup[barangay] && lookup[barangay][di]) || [0, 0, 0, 0];
      AGE_BRACKETS.forEach((_, ai) => {
        row[`d${di}_a${ai}`] = counts[ai];
        allAges[ai] += counts[ai];
        totalPwd += counts[ai];
        totals[`d${di}_a${ai}`] += counts[ai];
      });
    });
    AGE_BRACKETS.forEach((_, ai) => {
      row[`all_a${ai}`] = allAges[ai];
      totals[`all_a${ai}`] += allAges[ai];
    });
    row.total_pwd = totalPwd;
    totals.total_pwd += totalPwd;
    return row;
  });

  const ageCols = (prefix) => AGE_BRACKETS.map((br, ai) => ({ key: `${prefix}_a${ai}`, label: br.label, align: 'right' }));

  const columnGroups = [
    {
      label: null,
      columns: [
        { key: 'no', label: 'No.', align: 'right' },
        { key: 'barangay', label: 'Barangay' },
        { key: 'total_pwd', label: 'Total PWD', align: 'right' },
      ],
    },
    { label: 'All Disabilities (Age)', columns: ageCols('all') },
    ...PWD_DISABILITY_TYPES.map((t, di) => ({ label: stripNumPrefix(t), columns: ageCols(`d${di}`) })),
  ];

  return {
    id: 'age-by-barangay',
    title: 'PWD Age Segregation per Barangay',
    asOf: new Date().toISOString(),
    columnGroups,
    rows,
    totals,
  };
}

module.exports = { buildAgeByBarangayReport };
