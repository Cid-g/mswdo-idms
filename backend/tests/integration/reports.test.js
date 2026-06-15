'use strict';

const db = require('../dbHelpers');
const Applicant = require('../../src/models/Applicant');
const { buildPerBarangayReport } = require('../../src/lib/reports/perBarangay');
const { tableToWorkbook } = require('../../src/lib/reports/excel');

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.disconnect(); });
afterEach(async () => { await db.clear(); });

function applicant(overrides = {}) {
  return {
    department: 'PWD', recordStatus: 'ACTIVE',
    lastName: 'X', firstName: 'Y', birthdate: new Date('1980-01-01'),
    encodedById: new (require('mongoose').Types.ObjectId)(),
    sex: 'Male', barangay: 'Abagon',
    ...overrides,
  };
}

describe('buildPerBarangayReport', () => {
  test('44 rows in alphabetical order with sequential No., zero-filled, normalized sex', async () => {
    await Applicant.create([
      applicant({ barangay: 'Abagon', sex: 'Male' }),
      applicant({ barangay: 'Abagon', sex: 'F' }),
      applicant({ barangay: 'Luna',   sex: 'Female' }),
    ]);
    const report = await buildPerBarangayReport('PWD');
    expect(report.rows).toHaveLength(44);
    expect(report.rows[0]).toMatchObject({ no: 1, barangay: 'Abagon', male: 1, female: 1, total: 2 });
    expect(report.rows[43].no).toBe(44);
    const luna = report.rows.find((r) => r.barangay === 'Luna');
    expect(luna).toMatchObject({ male: 0, female: 1, total: 1 });
    const bawa = report.rows.find((r) => r.barangay === 'Bawa');
    expect(bawa).toMatchObject({ male: 0, female: 0, total: 0 });
    expect(report.rows[1].barangay).toBe('Amacalan');
  });

  test('totals + dept-aware title + columns + asOf', async () => {
    await Applicant.create([
      applicant({ department: 'SENIOR_CITIZEN', barangay: 'Abagon', sex: 'Male' }),
      applicant({ department: 'SENIOR_CITIZEN', barangay: 'Luna', sex: 'Female' }),
    ]);
    const report = await buildPerBarangayReport('SENIOR_CITIZEN');
    expect(report.title).toBe('Senior Citizens per Barangay');
    expect(report.totals).toEqual({ male: 1, female: 1, total: 2 });
    expect(report.columns.map((c) => c.key)).toEqual(['no', 'barangay', 'male', 'female', 'total']);
    expect(typeof report.asOf).toBe('string');
    expect(report.id).toBe('per-barangay');
  });

  test('only ACTIVE records in the requested department', async () => {
    await Applicant.create([
      applicant({ department: 'PWD', barangay: 'Abagon', sex: 'Male' }),
      applicant({ department: 'PWD', barangay: 'Abagon', sex: 'Male', recordStatus: 'EXPIRED' }),
      applicant({ department: 'SOLO_PARENT', barangay: 'Abagon', sex: 'Male' }),
    ]);
    const report = await buildPerBarangayReport('PWD');
    expect(report.totals.total).toBe(1);
  });
});

describe('tableToWorkbook', () => {
  const sample = {
    title: 'Persons with Disability per Barangay',
    asOf: '2026-06-02T00:00:00.000Z',
    columns: [
      { key: 'no', label: 'No.', align: 'right' },
      { key: 'barangay', label: 'Barangay' },
      { key: 'male', label: 'Male', align: 'right' },
      { key: 'female', label: 'Female', align: 'right' },
      { key: 'total', label: 'Total', align: 'right' },
    ],
    rows: [
      { no: 1, barangay: 'Abagon', male: 2, female: 3, total: 5 },
      { no: 2, barangay: 'Amacalan', male: 0, female: 1, total: 1 },
    ],
    totals: { male: 2, female: 4, total: 6 },
  };

  test('produces a workbook with title, header, data, and TOTAL rows', async () => {
    const wb = tableToWorkbook(sample);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe(sample.title);
    expect(String(ws.getCell('A2').value)).toMatch(/^As of /);
    expect(ws.getRow(4).getCell(1).value).toBe('No.');
    expect(ws.getRow(4).getCell(2).value).toBe('Barangay');
    expect(ws.getRow(5).getCell(2).value).toBe('Abagon');
    expect(ws.getRow(5).getCell(5).value).toBe(5);
    const totalRow = ws.getRow(5 + sample.rows.length);
    expect(totalRow.getCell(2).value).toBe('TOTAL');
    expect(totalRow.getCell(5).value).toBe(6);
  });

  test('can write to a buffer', async () => {
    const wb = tableToWorkbook(sample);
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});

const supertest = require('supertest');
const app = require('../../src/app');
const { createTestUser, getToken } = require('../testHelpers');

describe('Reports API', () => {
  async function adminToken(dept, username) {
    await createTestUser({ username, role: 'ADMIN', department: dept });
    return getToken(app, username);
  }

  test('GET /api/reports lists per-barangay for the admin dept', async () => {
    const token = await adminToken('PWD', 'rep_pwd');
    const res = await supertest(app).get('/api/reports').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.reports.some((r) => r.id === 'per-barangay')).toBe(true);
    const r = res.body.reports.find((x) => x.id === 'per-barangay');
    expect(r.title).toBe('Persons with Disability per Barangay');
  });

  test('GET /api/reports/per-barangay returns the structure', async () => {
    const token = await adminToken('SOLO_PARENT', 'rep_sp');
    await Applicant.create([applicant({ department: 'SOLO_PARENT', barangay: 'Abagon', sex: 'Female' })]);
    const res = await supertest(app).get('/api/reports/per-barangay').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(44);
    expect(res.body.title).toBe('Solo Parents per Barangay');
    expect(res.body.totals.female).toBe(1);
  });

  test('GET /api/reports/per-barangay/export returns an xlsx attachment', async () => {
    const token = await adminToken('SENIOR_CITIZEN', 'rep_sc');
    const res = await supertest(app).get('/api/reports/per-barangay/export').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('per-barangay-SENIOR_CITIZEN');
  });

  test('GET /api/reports/unknown-id returns 404', async () => {
    const token = await adminToken('PWD', 'rep_pwd2');
    const res = await supertest(app).get('/api/reports/unknown-id').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

const { buildDisabilityByBarangayReport } = require('../../src/lib/reports/disabilityByBarangay');

describe('buildDisabilityByBarangayReport', () => {
  function pwdDis(barangay, sex, disabilityType) {
    return {
      department: 'PWD', recordStatus: 'ACTIVE',
      lastName: 'X', firstName: 'Y', birthdate: new Date('1980-01-01'),
      encodedById: new (require('mongoose').Types.ObjectId)(),
      sex, barangay, pwd: { disabilityType },
    };
  }

  test('pivots barangay x disability x sex with grand totals, 44 alphabetical rows', async () => {
    await Applicant.create([
      pwdDis('Abagon', 'Male', '8. Visual Disability'),
      pwdDis('Abagon', 'F', '8. Visual Disability'),
      pwdDis('Abagon', 'Female', '1. Deaf or Hard of Hearing'),
      pwdDis('Luna', 'Male', '1. Deaf or Hard of Hearing'),
    ]);
    const report = await buildDisabilityByBarangayReport();
    expect(report.id).toBe('disability-by-barangay');
    expect(report.title).toBe('Type of Disability per Barangay');
    expect(report.rows).toHaveLength(44);
    expect(report.rows[0].barangay).toBe('Abagon');
    expect(report.rows[0].no).toBe(1);
    const abagon = report.rows.find((r) => r.barangay === 'Abagon');
    expect(abagon).toMatchObject({ d7_m: 1, d7_f: 1, d7_t: 2, d0_m: 0, d0_f: 1, d0_t: 1 });
    expect(abagon).toMatchObject({ all_m: 1, all_f: 2, all_t: 3 });
    const luna = report.rows.find((r) => r.barangay === 'Luna');
    expect(luna).toMatchObject({ d0_m: 1, d0_f: 0, d0_t: 1, all_m: 1, all_f: 0, all_t: 1 });
    expect(report.totals).toMatchObject({ d7_m: 1, d7_f: 1, d0_m: 1, d0_f: 1, all_m: 2, all_f: 2, all_t: 4 });
  });

  test('columnGroups: leading + 10 disability + Total (PWD) groups', async () => {
    const report = await buildDisabilityByBarangayReport();
    expect(report.columns).toBeUndefined();
    expect(report.columnGroups).toHaveLength(12);
    expect(report.columnGroups[0].label).toBeNull();
    expect(report.columnGroups[0].columns.map((c) => c.key)).toEqual(['no', 'barangay']);
    expect(report.columnGroups[1].label).toBe('Deaf or Hard of Hearing');
    expect(report.columnGroups[8].label).toBe('Visual Disability');
    expect(report.columnGroups[11].label).toBe('Total (PWD)');
    expect(report.columnGroups[11].columns.map((c) => c.key)).toEqual(['all_m', 'all_f', 'all_t']);
  });
});

describe('tableToWorkbook — grouped (columnGroups)', () => {
  const grouped = {
    title: 'Type of Disability per Barangay',
    asOf: '2026-06-02T00:00:00.000Z',
    columnGroups: [
      { label: null, columns: [{ key: 'no', label: 'No.', align: 'right' }, { key: 'barangay', label: 'Barangay' }] },
      { label: 'Deaf or Hard of Hearing', columns: [{ key: 'd0_m', label: 'M', align: 'right' }, { key: 'd0_f', label: 'F', align: 'right' }, { key: 'd0_t', label: 'Total', align: 'right' }] },
      { label: 'Total (PWD)', columns: [{ key: 'all_m', label: 'M', align: 'right' }, { key: 'all_f', label: 'F', align: 'right' }, { key: 'all_t', label: 'Total', align: 'right' }] },
    ],
    rows: [{ no: 1, barangay: 'Abagon', d0_m: 4, d0_f: 3, d0_t: 7, all_m: 4, all_f: 3, all_t: 7 }],
    totals: { d0_m: 4, d0_f: 3, d0_t: 7, all_m: 4, all_f: 3, all_t: 7 },
  };

  test('renders two header rows, data, and TOTAL for grouped structure', async () => {
    const wb = tableToWorkbook(grouped);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe(grouped.title);
    expect(ws.getRow(4).getCell(3).value).toBe('Deaf or Hard of Hearing');
    expect(ws.getRow(5).getCell(3).value).toBe('M');
    expect(ws.getRow(5).getCell(5).value).toBe('Total');
    expect(ws.getRow(4).getCell(1).value).toBe('No.');
    expect(ws.getRow(4).getCell(2).value).toBe('Barangay');
    expect(ws.getRow(6).getCell(2).value).toBe('Abagon');
    expect(ws.getRow(6).getCell(5).value).toBe(7);
    expect(ws.getRow(7).getCell(2).value).toBe('TOTAL');
    expect(ws.getRow(7).getCell(8).value).toBe(7);
  });
});

describe('Reports API — disability cross-tab', () => {
  async function adminToken2(dept, username) {
    await createTestUser({ username, role: 'ADMIN', department: dept });
    return getToken(app, username);
  }

  test('PWD admin lists BOTH reports', async () => {
    const token = await adminToken2('PWD', 'rep_pwd_x');
    const res = await supertest(app).get('/api/reports').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.reports.map((r) => r.id);
    expect(ids).toContain('per-barangay');
    expect(ids).toContain('disability-by-barangay');
  });

  test('GET disability-by-barangay returns columnGroups + export works', async () => {
    const token = await adminToken2('PWD', 'rep_pwd_y');
    const res = await supertest(app).get('/api/reports/disability-by-barangay').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.columnGroups).toHaveLength(12);
    expect(res.body.rows).toHaveLength(44);
    const exp = await supertest(app).get('/api/reports/disability-by-barangay/export').set('Authorization', `Bearer ${token}`);
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('spreadsheetml');
  });

  test('SOLO_PARENT admin does NOT get disability-by-barangay', async () => {
    const token = await adminToken2('SOLO_PARENT', 'rep_sp_x');
    const res = await supertest(app).get('/api/reports/disability-by-barangay').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

const { buildPensionByBarangayReport } = require('../../src/lib/reports/pensionByBarangay');

describe('buildPensionByBarangayReport', () => {
  function scPen(barangay, sex, pensionType) {
    return {
      department: 'SENIOR_CITIZEN', recordStatus: 'ACTIVE',
      lastName: 'X', firstName: 'Y', birthdate: new Date('1955-01-01'),
      encodedById: new (require('mongoose').Types.ObjectId)(),
      sex, barangay, seniorCitizen: { pensionType },
    };
  }

  test('pivots barangay x pension x sex, Other bucket, grand totals, 44 rows', async () => {
    await Applicant.create([
      scPen('Abagon', 'Male', 'SSS'),
      scPen('Abagon', 'F', 'SSS'),
      scPen('Abagon', 'Female', 'GSIS'),
      scPen('Abagon', 'Male', 'WeirdValue'), // -> Other/Unspecified (index 7)
      scPen('Luna', 'Female', undefined),     // -> Other/Unspecified
    ]);
    const report = await buildPensionByBarangayReport();
    expect(report.id).toBe('pension-by-barangay');
    expect(report.rows).toHaveLength(44);
    expect(report.rows[0].barangay).toBe('Abagon');

    const abagon = report.rows.find((r) => r.barangay === 'Abagon');
    // SSS is index 2 (p2); GSIS index 3 (p3); Other is index 7 (p7)
    expect(abagon).toMatchObject({ p2_m: 1, p2_f: 1, p2_t: 2, p3_m: 0, p3_f: 1, p3_t: 1, p7_m: 1, p7_t: 1 });
    expect(abagon).toMatchObject({ all_m: 2, all_f: 2, all_t: 4 });

    const luna = report.rows.find((r) => r.barangay === 'Luna');
    expect(luna).toMatchObject({ p7_f: 1, p7_t: 1, all_f: 1, all_t: 1 });

    expect(report.totals).toMatchObject({ p2_m: 1, p2_f: 1, all_m: 2, all_f: 3, all_t: 5 });
  });

  test('columnGroups: leading + 8 pension (7 + Other) + Total (SC) with friendly labels', async () => {
    const report = await buildPensionByBarangayReport();
    expect(report.columnGroups).toHaveLength(10); // 1 leading + 8 + 1 total
    expect(report.columnGroups[0].label).toBeNull();
    expect(report.columnGroups[1].label).toBe("Social Pension (Nat'l)");
    expect(report.columnGroups[3].label).toBe('SSS Pensioner');
    expect(report.columnGroups[8].label).toBe('Other/Unspecified');
    expect(report.columnGroups[9].label).toBe('Total (SC)');
    expect(report.columnGroups[9].columns.map((c) => c.key)).toEqual(['all_m', 'all_f', 'all_t']);
  });
});

describe('Reports API — pension cross-tab', () => {
  async function adminToken3(dept, username) {
    await createTestUser({ username, role: 'ADMIN', department: dept });
    return getToken(app, username);
  }

  test('SC admin lists pension-by-barangay and gets columnGroups + export', async () => {
    const token = await adminToken3('SENIOR_CITIZEN', 'rep_sc_p');
    const list = await supertest(app).get('/api/reports').set('Authorization', `Bearer ${token}`);
    expect(list.body.reports.map((r) => r.id)).toContain('pension-by-barangay');

    const res = await supertest(app).get('/api/reports/pension-by-barangay').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.columnGroups).toHaveLength(10);
    expect(res.body.rows).toHaveLength(44);

    const exp = await supertest(app).get('/api/reports/pension-by-barangay/export').set('Authorization', `Bearer ${token}`);
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('spreadsheetml');
  });

  test('PWD admin does NOT get pension-by-barangay', async () => {
    const token = await adminToken3('PWD', 'rep_pwd_p');
    const res = await supertest(app).get('/api/reports/pension-by-barangay').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

const { buildCategoryByStatusReport } = require('../../src/lib/reports/categoryByStatus');

describe('buildCategoryByStatusReport', () => {
  function spCat(sex, categoryCode, spicStatus) {
    return {
      department: 'SOLO_PARENT', recordStatus: 'ACTIVE',
      lastName: 'X', firstName: 'Y', birthdate: new Date('1990-01-01'),
      encodedById: new (require('mongoose').Types.ObjectId)(),
      sex, barangay: 'Abagon', soloParent: { categoryCode, spicStatus },
    };
  }

  test('pivots category x New/Renewal x sex with per-category + grand totals (13 categories)', async () => {
    await Applicant.create([
      spCat('Male', 'A2', 'New'),
      spCat('Female', 'A2', 'New'),
      spCat('Female', 'A2', 'Renewal'),
      spCat('Male', 'C', 'New'),
    ]);
    const report = await buildCategoryByStatusReport();
    expect(report.id).toBe('category-by-status');
    expect(report.title).toBe('Solo Parents per Category (New vs Renewal)');
    expect(report.rows).toHaveLength(13);

    const widow = report.rows.find((r) => r.category === 'Widow / Widower'); // A2
    expect(widow).toMatchObject({ nm: 1, nf: 1, nt: 2, rm: 0, rf: 1, rt: 1, am: 1, af: 2, at: 3 });
    const unmarried = report.rows.find((r) => r.category === 'Unmarried person'); // C
    expect(unmarried).toMatchObject({ nm: 1, nf: 0, nt: 1, rm: 0, rf: 0, rt: 0, am: 1, af: 0, at: 1 });

    expect(report.totals).toMatchObject({ nm: 2, nf: 1, rm: 0, rf: 1, am: 2, af: 2, at: 4 });
  });

  test('columnGroups: leading + New + Renewal + Total', async () => {
    const report = await buildCategoryByStatusReport();
    expect(report.columnGroups).toHaveLength(4);
    expect(report.columnGroups[0].columns.map((c) => c.key)).toEqual(['no', 'category']);
    expect(report.columnGroups[1].label).toBe('New');
    expect(report.columnGroups[2].label).toBe('Renewal');
    expect(report.columnGroups[3].label).toBe('Total');
    expect(report.columnGroups[3].columns.map((c) => c.key)).toEqual(['am', 'af', 'at']);
  });

  test('exported workbook places TOTAL label in the Category column (generalized labelIdx)', async () => {
    const report = await buildCategoryByStatusReport();
    const wb = tableToWorkbook(report);
    const ws = wb.worksheets[0];
    const totalRow = ws.getRow(6 + report.rows.length); // grouped: data starts row 6
    expect(totalRow.getCell(2).value).toBe('TOTAL'); // col 2 = Category (not 'no')
    expect(totalRow.getCell(1).value == null || totalRow.getCell(1).value === '').toBe(true);
  });
});

describe('Reports API — category cross-tab', () => {
  async function adminToken4(dept, username) {
    await createTestUser({ username, role: 'ADMIN', department: dept });
    return getToken(app, username);
  }

  test('SOLO_PARENT admin lists category-by-status + gets columnGroups + export', async () => {
    const token = await adminToken4('SOLO_PARENT', 'rep_sp_c');
    const list = await supertest(app).get('/api/reports').set('Authorization', `Bearer ${token}`);
    expect(list.body.reports.map((r) => r.id)).toContain('category-by-status');

    const res = await supertest(app).get('/api/reports/category-by-status').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.columnGroups).toHaveLength(4);
    expect(res.body.rows).toHaveLength(13);

    const exp = await supertest(app).get('/api/reports/category-by-status/export').set('Authorization', `Bearer ${token}`);
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('spreadsheetml');
  });

  test('PWD admin does NOT get category-by-status', async () => {
    const token = await adminToken4('PWD', 'rep_pwd_c');
    const res = await supertest(app).get('/api/reports/category-by-status').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

const { buildPwdSummaryReport } = require('../../src/lib/reports/pwdSummary');
const IDRecordModel = require('../../src/models/IDRecord');

describe('buildPwdSummaryReport', () => {
  function pwdRec(overrides = {}) {
    return {
      department: 'PWD', recordStatus: 'ACTIVE', transactionType: 'New',
      lastName: 'X', firstName: 'Y', birthdate: new Date('1980-01-01'),
      encodedById: new (require('mongoose').Types.ObjectId)(),
      sex: 'Male', barangay: 'Abagon',
      pwd: { disabilityType: '8. Visual Disability' },
      ...overrides,
    };
  }

  test('counts statuses, transaction types, DOH, and Without ID Number', async () => {
    const withId = await Applicant.create(pwdRec({ transactionType: 'New', pwd: { disabilityType: '8. Visual Disability', uploadedToDOH: true } }));
    await Applicant.create(pwdRec({ transactionType: 'Renew' }));      // renewal, active, no ID
    await Applicant.create(pwdRec({ recordStatus: 'EXPIRED' }));        // expired
    await Applicant.create(pwdRec({ recordStatus: 'DECEASED' }));       // deceased
    await Applicant.create(pwdRec({ department: 'SOLO_PARENT' }));      // excluded (other dept)
    await IDRecordModel.create({ applicantId: withId._id, department: 'PWD', idNumber: 'PWD-S1', qrToken: 'qs1' });

    const report = await buildPwdSummaryReport();
    expect(report.id).toBe('pwd-summary');
    expect(report.columns.map((c) => c.key)).toEqual(['metric', 'count']);
    expect(report.totals).toBeNull();

    const m = {};
    report.rows.forEach((r) => { m[r.metric] = r.count; });
    expect(m['Total Registered']).toBe(4);     // 4 PWD (SP excluded)
    expect(m['New Issuances']).toBe(3);          // New: withId, expired, deceased default 'New'
    expect(m.Renewals).toBe(1);
    expect(m.Active).toBe(2);                    // withId + renewal
    expect(m.Expired).toBe(1);
    expect(m.Deceased).toBe(1);
    expect(m['Encoded to DOH']).toBe(1);
    expect(m['Without ID Number']).toBe(3);      // 4 PWD - 1 with IDRecord
  });
});

describe('Reports API — PWD summary', () => {
  async function adminToken5(dept, username) {
    await createTestUser({ username, role: 'ADMIN', department: dept });
    return getToken(app, username);
  }

  test('PWD admin gets pwd-summary (flat columns) + export', async () => {
    const token = await adminToken5('PWD', 'rep_pwd_s');
    const list = await supertest(app).get('/api/reports').set('Authorization', `Bearer ${token}`);
    expect(list.body.reports.map((r) => r.id)).toContain('pwd-summary');

    const res = await supertest(app).get('/api/reports/pwd-summary').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.columns.map((c) => c.key)).toEqual(['metric', 'count']);
    expect(res.body.columnGroups).toBeUndefined();
    expect(res.body.rows.length).toBeGreaterThanOrEqual(10);

    const exp = await supertest(app).get('/api/reports/pwd-summary/export').set('Authorization', `Bearer ${token}`);
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('spreadsheetml');
  });

  test('SOLO_PARENT admin does NOT get pwd-summary', async () => {
    const token = await adminToken5('SOLO_PARENT', 'rep_sp_s');
    const res = await supertest(app).get('/api/reports/pwd-summary').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

const { buildSoloParentPerYearReport } = require('../../src/lib/reports/soloParentPerYear');

describe('buildSoloParentPerYearReport', () => {
  function spYear(sex, year) {
    return {
      department: 'SOLO_PARENT', recordStatus: 'ACTIVE',
      lastName: 'X', firstName: 'Y', birthdate: new Date('1990-01-01'),
      encodedById: new (require('mongoose').Types.ObjectId)(),
      sex, barangay: 'Abagon',
      soloParent: { categoryCode: 'A2', dateSpicIssued: year == null ? undefined : new Date(`${year}-06-15`) },
    };
  }

  test('groups by year of dateSpicIssued (sorted asc), M/F totals, excludes no-date', async () => {
    await Applicant.create([
      spYear('Female', 2024),
      spYear('M', 2024),
      spYear('Female', 2025),
      spYear('Female', null), // no dateSpicIssued -> excluded
    ]);
    const report = await buildSoloParentPerYearReport();
    expect(report.id).toBe('solo-parent-per-year');
    expect(report.columns.map((c) => c.key)).toEqual(['year', 'male', 'female', 'total']);
    expect(report.rows).toEqual([
      { year: 2024, male: 1, female: 1, total: 2 },
      { year: 2025, male: 0, female: 1, total: 1 },
    ]);
    expect(report.totals).toEqual({ male: 1, female: 2, total: 3 });
  });

  test('empty when no records have a SPIC date', async () => {
    await Applicant.create([spYear('Female', null)]);
    const report = await buildSoloParentPerYearReport();
    expect(report.rows).toEqual([]);
    expect(report.totals).toEqual({ male: 0, female: 0, total: 0 });
  });
});

describe('Reports API — Solo Parent per-year', () => {
  async function adminToken6(dept, username) {
    await createTestUser({ username, role: 'ADMIN', department: dept });
    return getToken(app, username);
  }

  test('SOLO_PARENT admin gets solo-parent-per-year (flat) + export', async () => {
    const token = await adminToken6('SOLO_PARENT', 'rep_sp_yr');
    const list = await supertest(app).get('/api/reports').set('Authorization', `Bearer ${token}`);
    expect(list.body.reports.map((r) => r.id)).toContain('solo-parent-per-year');

    const res = await supertest(app).get('/api/reports/solo-parent-per-year').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.columns.map((c) => c.key)).toEqual(['year', 'male', 'female', 'total']);

    const exp = await supertest(app).get('/api/reports/solo-parent-per-year/export').set('Authorization', `Bearer ${token}`);
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('spreadsheetml');
  });

  test('SENIOR_CITIZEN admin does NOT get solo-parent-per-year', async () => {
    const token = await adminToken6('SENIOR_CITIZEN', 'rep_sc_yr');
    const res = await supertest(app).get('/api/reports/solo-parent-per-year').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

const { buildAgeByBarangayReport } = require('../../src/lib/reports/ageByBarangay');

describe('buildAgeByBarangayReport', () => {
  function pwdAge(barangay, ageYears, disabilityType) {
    const yr = new Date().getFullYear() - ageYears;
    return {
      department: 'PWD', recordStatus: 'ACTIVE',
      lastName: 'X', firstName: 'Y',
      birthdate: ageYears == null ? undefined : new Date(yr, 0, 1),
      encodedById: new (require('mongoose').Types.ObjectId)(),
      sex: 'Male', barangay,
      pwd: { disabilityType },
    };
  }

  test('cross-tabs barangay x disability x age range with all-ages + total PWD', async () => {
    await Applicant.create([
      pwdAge('Abagon', 10, '8. Visual Disability'),  // d7, 0-17
      pwdAge('Abagon', 25, '8. Visual Disability'),  // d7, 18-30
      pwdAge('Abagon', 40, '1. Deaf or Hard of Hearing'), // d0, 31-59
      pwdAge('Luna', 70, '1. Deaf or Hard of Hearing'),   // d0, 60+
    ]);
    const report = await buildAgeByBarangayReport();
    expect(report.id).toBe('age-by-barangay');
    expect(report.rows).toHaveLength(44);

    const abagon = report.rows.find((r) => r.barangay === 'Abagon');
    expect(abagon).toMatchObject({ d7_a0: 1, d7_a1: 1, d7_a2: 0, d7_a3: 0, d0_a2: 1 });
    expect(abagon).toMatchObject({ all_a0: 1, all_a1: 1, all_a2: 1, all_a3: 0, total_pwd: 3 });

    const luna = report.rows.find((r) => r.barangay === 'Luna');
    expect(luna).toMatchObject({ d0_a3: 1, all_a3: 1, total_pwd: 1 });

    expect(report.totals).toMatchObject({ total_pwd: 4, all_a0: 1, all_a1: 1, all_a2: 1, all_a3: 1, d7_a0: 1, d0_a3: 1 });
  });

  test('columnGroups: leading(no,barangay,total_pwd) + All + 10 disability = 12 groups', async () => {
    const report = await buildAgeByBarangayReport();
    expect(report.columnGroups).toHaveLength(12);
    expect(report.columnGroups[0].columns.map((c) => c.key)).toEqual(['no', 'barangay', 'total_pwd']);
    expect(report.columnGroups[1].label).toBe('All Disabilities (Age)');
    expect(report.columnGroups[1].columns.map((c) => c.label)).toEqual(['0-17', '18-30', '31-59', '60+']);
    expect(report.columnGroups[2].label).toBe('Deaf or Hard of Hearing'); // d0
    expect(report.columnGroups[9].label).toBe('Visual Disability');       // d7
    expect(report.columnGroups[9].columns.map((c) => c.key)).toEqual(['d7_a0', 'd7_a1', 'd7_a2', 'd7_a3']);
  });

  test('exported workbook has the wide grouped header (47 cols) + TOTAL row', async () => {
    const report = await buildAgeByBarangayReport();
    const wb = tableToWorkbook(report);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe('PWD Age Segregation per Barangay');
    // leading + All(4) + 10*4 = 47 columns
    expect(ws.columnCount).toBeGreaterThanOrEqual(47);
    // row 4 group label for the All-Disabilities group starts at col 4 (after no,barangay,total_pwd)
    expect(ws.getRow(4).getCell(4).value).toBe('All Disabilities (Age)');
    // row 5 sub-labels for that group
    expect(ws.getRow(5).getCell(4).value).toBe('0-17');
    const totalRow = ws.getRow(6 + report.rows.length);
    expect(totalRow.getCell(2).value).toBe('TOTAL'); // barangay column
  });
});

describe('Reports API — PWD age segregation', () => {
  async function adminToken7(dept, username) {
    await createTestUser({ username, role: 'ADMIN', department: dept });
    return getToken(app, username);
  }

  test('PWD admin gets age-by-barangay (12 groups) + export', async () => {
    const token = await adminToken7('PWD', 'rep_pwd_age');
    const list = await supertest(app).get('/api/reports').set('Authorization', `Bearer ${token}`);
    expect(list.body.reports.map((r) => r.id)).toContain('age-by-barangay');

    const res = await supertest(app).get('/api/reports/age-by-barangay').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.columnGroups).toHaveLength(12);
    expect(res.body.rows).toHaveLength(44);

    const exp = await supertest(app).get('/api/reports/age-by-barangay/export').set('Authorization', `Bearer ${token}`);
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('spreadsheetml');
  });

  test('SOLO_PARENT admin does NOT get age-by-barangay', async () => {
    const token = await adminToken7('SOLO_PARENT', 'rep_sp_age');
    const res = await supertest(app).get('/api/reports/age-by-barangay').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

const { buildSeniorMasterlistReport } = require('../../src/lib/reports/seniorMasterlist');

describe('buildSeniorMasterlistReport', () => {
  function senior(overrides = {}) {
    const { seniorCitizen: sc = {}, ...rest } = overrides;
    return {
      department: 'SENIOR_CITIZEN', recordStatus: 'ACTIVE',
      lastName: 'Reyes', firstName: 'Maria', middleName: 'S',
      birthdate: new Date(1955, 2, 10),
      encodedById: new (require('mongoose').Types.ObjectId)(),
      sex: 'Female', barangay: 'Abagon', contactNumber: '0917',
      seniorCitizen: {
        oscaNumber: 'OSCA-1', maritalStatus: 'Widowed', isPensioner: true,
        pensionType: 'SSS', pensionAmount: 1000, rrn: 'RRN-1',
        registrationCategory: 'Walk-In', livingStatus: 'Owned',
        occupation: 'Retired', medicalCondition: 'Hypertension', medicine: 'Losartan',
        isDisabled: false,
        ...sc,
      },
      ...rest,
    };
  }

  test('one row per senior with mapped/formatted fields, sorted, flat columns, no totals', async () => {
    await Applicant.create([
      senior({ lastName: 'Santos', firstName: 'Ben', barangay: 'Luna', sex: 'M', seniorCitizen: { isPensioner: false, isDisabled: true, pensionType: 'None' } }),
      senior({ lastName: 'Reyes', firstName: 'Maria', barangay: 'Abagon' }),
      senior({ department: 'PWD' }), // excluded (other dept)
    ]);
    const report = await buildSeniorMasterlistReport();
    expect(report.id).toBe('senior-masterlist');
    expect(report.totals).toBeNull();
    expect(report.columnGroups).toBeUndefined();
    expect(report.rows).toHaveLength(2);

    // sorted by barangay then name: Abagon/Reyes first, Luna/Santos second
    expect(report.rows[0]).toMatchObject({ lastName: 'Reyes', barangay: 'Abagon', sex: 'Female', pensioner: 'Yes', pensionType: 'SSS', disabled: 'No' });
    expect(typeof report.rows[0].age).toBe('number');
    expect(report.rows[0].age).toBeGreaterThanOrEqual(70);
    expect(report.rows[0].birthday).toBe('03/10/1955');
    expect(report.rows[1]).toMatchObject({ lastName: 'Santos', barangay: 'Luna', sex: 'Male', pensioner: 'No', disabled: 'Yes' });

    expect(report.columns.map((c) => c.key)).toContain('oscaNumber');
    expect(report.columns.map((c) => c.key)).toContain('medicalCondition');
  });
});

describe('Reports API — Senior masterlist', () => {
  async function adminToken8(dept, username) {
    await createTestUser({ username, role: 'ADMIN', department: dept });
    return getToken(app, username);
  }

  test('SC admin gets senior-masterlist (flat) + export', async () => {
    const token = await adminToken8('SENIOR_CITIZEN', 'rep_sc_ml');
    const list = await supertest(app).get('/api/reports').set('Authorization', `Bearer ${token}`);
    expect(list.body.reports.map((r) => r.id)).toContain('senior-masterlist');

    const res = await supertest(app).get('/api/reports/senior-masterlist').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.columnGroups).toBeUndefined();
    expect(res.body.columns.length).toBeGreaterThanOrEqual(20);

    const exp = await supertest(app).get('/api/reports/senior-masterlist/export').set('Authorization', `Bearer ${token}`);
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('spreadsheetml');
  });

  test('PWD admin does NOT get senior-masterlist', async () => {
    const token = await adminToken8('PWD', 'rep_pwd_ml');
    const res = await supertest(app).get('/api/reports/senior-masterlist').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
