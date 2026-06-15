'use strict';

const Applicant = require('../../models/Applicant');
const { SOLO_PARENT_CATEGORIES } = require('../constants');
const { SEX_NORMALIZE } = require('../aggHelpers');

async function buildCategoryByStatusReport() {
  const agg = await Applicant.aggregate([
    { $match: { department: 'SOLO_PARENT', recordStatus: 'ACTIVE' } },
    { $addFields: { _sex: SEX_NORMALIZE } },
    { $group: { _id: { code: '$soloParent.categoryCode', status: '$soloParent.spicStatus', sex: '$_sex' }, count: { $sum: 1 } } },
  ]);

  const lookup = {};
  agg.forEach(({ _id, count }) => {
    if (!_id.code) return;
    // null/undefined spicStatus is treated as New (transactionType defaults to New)
    const status = _id.status === 'Renewal' ? 'Renewal' : 'New';
    lookup[_id.code] = lookup[_id.code] || { New: { male: 0, female: 0 }, Renewal: { male: 0, female: 0 } };
    if (_id.sex === 'Male') lookup[_id.code][status].male += count;
    else if (_id.sex === 'Female') lookup[_id.code][status].female += count;
  });

  const totals = { nm: 0, nf: 0, nt: 0, rm: 0, rf: 0, rt: 0, am: 0, af: 0, at: 0 };

  const rows = SOLO_PARENT_CATEGORIES.map(({ code, label }, i) => {
    const v = lookup[code] || { New: { male: 0, female: 0 }, Renewal: { male: 0, female: 0 } };
    const nm = v.New.male;
    const nf = v.New.female;
    const nt = nm + nf;
    const rm = v.Renewal.male;
    const rf = v.Renewal.female;
    const rt = rm + rf;
    const am = nm + rm;
    const af = nf + rf;
    const at = am + af;
    totals.nm += nm; totals.nf += nf; totals.nt += nt;
    totals.rm += rm; totals.rf += rf; totals.rt += rt;
    totals.am += am; totals.af += af; totals.at += at;
    return { no: i + 1, category: label, nm, nf, nt, rm, rf, rt, am, af, at };
  });

  const mft = (m, f, t) => [
    { key: m, label: 'M', align: 'right' },
    { key: f, label: 'F', align: 'right' },
    { key: t, label: 'Total', align: 'right' },
  ];

  const columnGroups = [
    {
      label: null,
      columns: [
        { key: 'no', label: 'No.', align: 'right' },
        { key: 'category', label: 'Category' },
      ],
    },
    { label: 'New', columns: mft('nm', 'nf', 'nt') },
    { label: 'Renewal', columns: mft('rm', 'rf', 'rt') },
    { label: 'Total', columns: mft('am', 'af', 'at') },
  ];

  return {
    id: 'category-by-status',
    title: 'Solo Parents per Category (New vs Renewal)',
    asOf: new Date().toISOString(),
    columnGroups,
    rows,
    totals,
  };
}

module.exports = { buildCategoryByStatusReport };
