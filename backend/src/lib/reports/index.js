'use strict';

const { buildPerBarangayReport, DEPT_NOUN } = require('./perBarangay');
const { buildDisabilityByBarangayReport } = require('./disabilityByBarangay');
const { buildPensionByBarangayReport } = require('./pensionByBarangay');
const { buildCategoryByStatusReport } = require('./categoryByStatus');
const { buildPwdSummaryReport } = require('./pwdSummary');
const { buildSoloParentPerYearReport } = require('./soloParentPerYear');
const { buildAgeByBarangayReport } = require('./ageByBarangay');
const { buildSeniorMasterlistReport } = require('./seniorMasterlist');

const REPORTS = {
  'per-barangay': {
    departments: ['SOLO_PARENT', 'PWD', 'SENIOR_CITIZEN'],
    title: (dept) => `${DEPT_NOUN[dept]} per Barangay`,
    build: (dept) => buildPerBarangayReport(dept),
  },
  'disability-by-barangay': {
    departments: ['PWD'],
    title: () => 'Type of Disability per Barangay',
    build: () => buildDisabilityByBarangayReport(),
  },
  'pension-by-barangay': {
    departments: ['SENIOR_CITIZEN'],
    title: () => 'Senior Citizens per Pension Type by Barangay',
    build: () => buildPensionByBarangayReport(),
  },
  'category-by-status': {
    departments: ['SOLO_PARENT'],
    title: () => 'Solo Parents per Category (New vs Renewal)',
    build: () => buildCategoryByStatusReport(),
  },
  'pwd-summary': {
    departments: ['PWD'],
    title: () => 'Summary of Persons with Disability',
    build: () => buildPwdSummaryReport(),
  },
  'solo-parent-per-year': {
    departments: ['SOLO_PARENT'],
    title: () => 'Solo Parents per Year of Registration',
    build: () => buildSoloParentPerYearReport(),
  },
  'age-by-barangay': {
    departments: ['PWD'],
    title: () => 'PWD Age Segregation per Barangay',
    build: () => buildAgeByBarangayReport(),
  },
  'senior-masterlist': {
    departments: ['SENIOR_CITIZEN'],
    title: () => 'Senior Citizens Masterlist',
    build: () => buildSeniorMasterlistReport(),
  },
};

function listReportsForDept(dept) {
  return Object.entries(REPORTS)
    .filter(([, def]) => def.departments.includes(dept))
    .map(([id, def]) => ({ id, title: def.title(dept) }));
}

function isAvailable(id, dept) {
  return Boolean(REPORTS[id]) && REPORTS[id].departments.includes(dept);
}

function getReport(id, dept) {
  return REPORTS[id].build(dept);
}

module.exports = { REPORTS, listReportsForDept, isAvailable, getReport };
