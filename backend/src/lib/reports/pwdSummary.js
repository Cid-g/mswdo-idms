'use strict';

const Applicant = require('../../models/Applicant');
const IDRecord = require('../../models/IDRecord');

async function buildPwdSummaryReport() {
  const dept = 'PWD';
  const c = (filter) => Applicant.countDocuments({ department: dept, ...filter });

  const [
    total, newCnt, renewCnt, active, expired, deceased, transferred, revoked, doh,
    idApplicantIds, allIdDocs,
  ] = await Promise.all([
    c({}),
    c({ transactionType: 'New' }),
    c({ transactionType: 'Renew' }),
    c({ recordStatus: 'ACTIVE' }),
    c({ recordStatus: 'EXPIRED' }),
    c({ recordStatus: 'DECEASED' }),
    c({ recordStatus: 'TRANSFERRED' }),
    c({ recordStatus: 'REVOKED' }),
    c({ 'pwd.uploadedToDOH': true }),
    IDRecord.distinct('applicantId', { department: dept }),
    Applicant.find({ department: dept }).select('_id').lean(),
  ]);

  const idSet = new Set(idApplicantIds.map((x) => String(x)));
  const withoutId = allIdDocs.filter((a) => !idSet.has(String(a._id))).length;

  const rows = [
    { metric: 'Total Registered', count: total },
    { metric: 'New Issuances', count: newCnt },
    { metric: 'Renewals', count: renewCnt },
    { metric: 'Active', count: active },
    { metric: 'Expired', count: expired },
    { metric: 'Deceased', count: deceased },
    { metric: 'Transferred', count: transferred },
    { metric: 'Revoked', count: revoked },
    { metric: 'Encoded to DOH', count: doh },
    { metric: 'Without ID Number', count: withoutId },
  ];

  return {
    id: 'pwd-summary',
    title: 'Summary of Persons with Disability',
    asOf: new Date().toISOString(),
    columns: [
      { key: 'metric', label: 'Item' },
      { key: 'count', label: 'Count', align: 'right' },
    ],
    rows,
    totals: null,
  };
}

module.exports = { buildPwdSummaryReport };
