'use strict';

const Applicant = require('../../models/Applicant');

function fmtDate(d) {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}/${x.getFullYear()}`;
}

function computeAge(birthdate, now) {
  const b = new Date(birthdate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

function normSex(s) {
  if (s === 'Male' || s === 'M') return 'Male';
  if (s === 'Female' || s === 'F') return 'Female';
  return s || '';
}

async function buildSeniorMasterlistReport() {
  const now = new Date();
  const docs = await Applicant.find({ department: 'SENIOR_CITIZEN', recordStatus: 'ACTIVE' })
    .sort({ barangay: 1, lastName: 1, firstName: 1 })
    .lean();

  const rows = docs.map((d) => {
    const sc = d.seniorCitizen || {};
    return {
      lastName: d.lastName || '',
      firstName: d.firstName || '',
      middleName: d.middleName || '',
      barangay: d.barangay || '',
      sex: normSex(d.sex),
      age: d.birthdate ? computeAge(d.birthdate, now) : '',
      birthday: fmtDate(d.birthdate),
      oscaNumber: sc.oscaNumber || '',
      maritalStatus: sc.maritalStatus || '',
      pensioner: sc.isPensioner ? 'Yes' : 'No',
      pensionType: sc.pensionType || '',
      pensionAmount: sc.pensionAmount != null ? sc.pensionAmount : '',
      dateIssued: fmtDate(sc.dateIssued),
      rrn: sc.rrn || '',
      category: sc.registrationCategory || '',
      idStatus: d.recordStatus || '',
      contactNumber: d.contactNumber || '',
      livingStatus: sc.livingStatus || '',
      occupation: sc.occupation || '',
      income: sc.income != null ? sc.income : '',
      medicalCondition: sc.medicalCondition || '',
      medicine: sc.medicine || '',
      disabled: sc.isDisabled ? 'Yes' : 'No',
    };
  });

  const text = (key, label, width) => ({ key, label, width });
  const num = (key, label) => ({ key, label, align: 'right' });

  return {
    id: 'senior-masterlist',
    title: 'Senior Citizens Masterlist',
    asOf: new Date().toISOString(),
    columns: [
      text('lastName', 'Last Name', 16),
      text('firstName', 'First Name', 16),
      text('middleName', 'Middle Name', 16),
      text('barangay', 'Barangay', 16),
      text('sex', 'Sex', 8),
      num('age', 'Age'),
      text('birthday', 'Birthday', 12),
      text('oscaNumber', 'OSCA No.', 14),
      text('maritalStatus', 'Marital Status', 14),
      text('pensioner', 'Pensioner', 10),
      text('pensionType', 'Pension', 14),
      num('pensionAmount', 'Pension Amount'),
      text('dateIssued', 'Date Issued', 12),
      text('rrn', 'RRN', 14),
      text('category', 'Category', 12),
      text('idStatus', 'ID Status', 12),
      text('contactNumber', 'Contact No.', 14),
      text('livingStatus', 'Living Status', 16),
      text('occupation', 'Occupation', 16),
      num('income', 'Income'),
      text('medicalCondition', 'Medical Condition', 20),
      text('medicine', 'Medicine', 16),
      text('disabled', 'Disabled', 9),
    ],
    rows,
    totals: null,
  };
}

module.exports = { buildSeniorMasterlistReport };
