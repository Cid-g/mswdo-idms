'use strict';

const supertest = require('supertest');
const app = require('../../src/app');
const db = require('../dbHelpers');
const Applicant = require('../../src/models/Applicant');
const { buildSoloParentReports } = require('../../src/lib/dashboardReports');
const { createTestUser, getToken } = require('../testHelpers');

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.disconnect(); });
afterEach(async () => { await db.clear(); });

// Helper: minimal valid Solo Parent applicant
function sp(overrides = {}) {
  const { soloParent = {}, ...rest } = overrides;
  return {
    department: 'SOLO_PARENT',
    recordStatus: 'ACTIVE',
    lastName: 'Cruz',
    firstName: 'Maria',
    birthdate: new Date('1990-01-01'),
    encodedById: new (require('mongoose').Types.ObjectId)(),
    sex: 'Female',
    barangay: 'Abagon',
    soloParent: { categoryCode: 'A2', spicStatus: 'New', ...soloParent },
    ...rest,
  };
}

describe('buildSoloParentReports', () => {
  test('perCategory: zero-filled for all 13 categories, splits New/Renew', async () => {
    await Applicant.create([
      sp({ soloParent: { categoryCode: 'A2', spicStatus: 'New' } }),
      sp({ soloParent: { categoryCode: 'A2', spicStatus: 'New' } }),
      sp({ soloParent: { categoryCode: 'A2', spicStatus: 'Renewal' } }),
      sp({ soloParent: { categoryCode: 'C',  spicStatus: 'New' } }),
    ]);

    const { perCategory } = await buildSoloParentReports();

    expect(perCategory).toHaveLength(13);
    const a2 = perCategory.find((r) => r.code === 'A2');
    expect(a2).toMatchObject({ label: 'Widow / Widower', new: 2, renew: 1, total: 3 });
    const c = perCategory.find((r) => r.code === 'C');
    expect(c).toMatchObject({ new: 1, renew: 0, total: 1 });
    const a1 = perCategory.find((r) => r.code === 'A1');
    expect(a1).toMatchObject({ new: 0, renew: 0, total: 0 });
  });

  test('perBarangay: zero-filled for all 44 barangays, sorted desc by total, normalizes M/F', async () => {
    await Applicant.create([
      sp({ barangay: 'Luna', sex: 'Female' }),
      sp({ barangay: 'Luna', sex: 'M' }),       // short form normalizes to Male
      sp({ barangay: 'Abagon', sex: 'Female' }),
    ]);

    const { perBarangay } = await buildSoloParentReports();

    expect(perBarangay).toHaveLength(44);
    expect(perBarangay[0]).toMatchObject({ barangay: 'Luna', male: 1, female: 1, total: 2 });
    const abagon = perBarangay.find((r) => r.barangay === 'Abagon');
    expect(abagon).toMatchObject({ male: 0, female: 1, total: 1 });
    const bawa = perBarangay.find((r) => r.barangay === 'Bawa');
    expect(bawa).toMatchObject({ male: 0, female: 0, total: 0 });
  });

  test('perYear: groups by year of dateSpicIssued, excludes records without it', async () => {
    await Applicant.create([
      sp({ sex: 'Female', soloParent: { categoryCode: 'A2', dateSpicIssued: new Date('2024-03-01') } }),
      sp({ sex: 'M',      soloParent: { categoryCode: 'A2', dateSpicIssued: new Date('2024-07-01') } }),
      sp({ sex: 'Female', soloParent: { categoryCode: 'A2', dateSpicIssued: new Date('2025-02-01') } }),
      sp({ sex: 'Female', soloParent: { categoryCode: 'A2' } }), // no dateSpicIssued -> excluded
    ]);

    const { perYear } = await buildSoloParentReports();

    expect(perYear).toEqual([
      { year: 2024, male: 1, female: 1, total: 2 },
      { year: 2025, male: 0, female: 1, total: 1 },
    ]);
  });

  test('sexSplit: overall normalized totals', async () => {
    await Applicant.create([
      sp({ sex: 'Female' }), sp({ sex: 'F' }), sp({ sex: 'Male' }),
    ]);

    const { sexSplit } = await buildSoloParentReports();

    expect(sexSplit).toEqual({ male: 1, female: 2, total: 3 });
  });

  test('spicExpiry: buckets by days remaining (1-year validity)', async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    await Applicant.create([
      sp({ soloParent: { categoryCode: 'A2', spicNumber: 'SP-1', dateSpicIssued: new Date(now - 396 * day) } }),
      sp({ soloParent: { categoryCode: 'A2', spicNumber: 'SP-2', dateSpicIssued: new Date(now - 350 * day) } }),
      sp({ soloParent: { categoryCode: 'A2', spicNumber: 'SP-3', dateSpicIssued: new Date(now - 300 * day) } }),
      sp({ soloParent: { categoryCode: 'A2', spicNumber: 'SP-4', dateSpicIssued: new Date(now) } }),
    ]);

    const { spicExpiry } = await buildSoloParentReports();

    expect(spicExpiry.buckets).toEqual({ expired: 1, days30: 1, days90: 1, valid: 1 });
    expect(spicExpiry.soon.map((r) => r.spicNumber)).toEqual(['SP-1', 'SP-2', 'SP-3']);
    expect(spicExpiry.soon[0].status).toBe('expired');
    expect(spicExpiry.soon[0].name).toBe('Cruz, Maria');
  });

  test('only counts ACTIVE records in SOLO_PARENT department', async () => {
    await Applicant.create([
      sp({ sex: 'Female' }),
      sp({ sex: 'Female', recordStatus: 'REVOKED' }),
      sp({ sex: 'Female', department: 'PWD' }),
    ]);

    const { sexSplit } = await buildSoloParentReports();
    expect(sexSplit.total).toBe(1);
  });
});

const { buildPwdReports } = require('../../src/lib/dashboardReports');

function pwd(overrides = {}) {
  const { pwd: pwdSub = {}, ...rest } = overrides;
  return {
    department: 'PWD', recordStatus: 'ACTIVE',
    lastName: 'Santos', firstName: 'Pedro',
    birthdate: new Date('1980-01-01'),
    encodedById: new (require('mongoose').Types.ObjectId)(),
    sex: 'Male', barangay: 'Abagon',
    pwd: { disabilityType: '8. Visual Disability', ...pwdSub },
    ...rest,
  };
}

describe('buildPwdReports', () => {
  test('perDisability: zero-filled for all 10 types, M/F, label strips number prefix', async () => {
    await Applicant.create([
      pwd({ sex: 'Male',   pwd: { disabilityType: '8. Visual Disability' } }),
      pwd({ sex: 'F',      pwd: { disabilityType: '8. Visual Disability' } }),
      pwd({ sex: 'Female', pwd: { disabilityType: '1. Deaf or Hard of Hearing' } }),
    ]);
    const { perDisability } = await buildPwdReports();
    expect(perDisability).toHaveLength(10);
    const vis = perDisability.find((r) => r.code === '8. Visual Disability');
    expect(vis).toMatchObject({ label: 'Visual Disability', male: 1, female: 1, total: 2 });
    const deaf = perDisability.find((r) => r.code === '1. Deaf or Hard of Hearing');
    expect(deaf).toMatchObject({ label: 'Deaf or Hard of Hearing', male: 0, female: 1, total: 1 });
  });

  test('ageDistribution: buckets 0-17/18-30/31-59/60+ from birthdate', async () => {
    const yrsAgo = (n) => new Date(new Date().getFullYear() - n, 5, 15);
    await Applicant.create([
      pwd({ sex: 'Male',   birthdate: yrsAgo(10) }),
      pwd({ sex: 'Female', birthdate: yrsAgo(25) }),
      pwd({ sex: 'Male',   birthdate: yrsAgo(40) }),
      pwd({ sex: 'Female', birthdate: yrsAgo(70) }),
    ]);
    const { ageDistribution } = await buildPwdReports();
    expect(ageDistribution.map((b) => b.bracket)).toEqual(['0-17', '18-30', '31-59', '60+']);
    expect(ageDistribution.find((b) => b.bracket === '0-17')).toMatchObject({ male: 1, total: 1 });
    expect(ageDistribution.find((b) => b.bracket === '60+')).toMatchObject({ female: 1, total: 1 });
  });

  test('perBarangay + sexSplit reuse shared shape', async () => {
    await Applicant.create([pwd({ barangay: 'Luna', sex: 'Male' }), pwd({ barangay: 'Luna', sex: 'Female' })]);
    const { perBarangay, sexSplit } = await buildPwdReports();
    expect(perBarangay).toHaveLength(44);
    expect(perBarangay[0]).toMatchObject({ barangay: 'Luna', male: 1, female: 1, total: 2 });
    expect(sexSplit).toEqual({ male: 1, female: 1, total: 2 });
  });

  test('statusSummary: DOH, withoutId, expired (all-status), deceased', async () => {
    const IDRecord = require('../../src/models/IDRecord');
    const withId = await Applicant.create(pwd({ sex: 'Male', pwd: { disabilityType: '8. Visual Disability', uploadedToDOH: true } }));
    await Applicant.create(pwd({ sex: 'Female' }));
    await Applicant.create(pwd({ recordStatus: 'EXPIRED' }));
    await Applicant.create(pwd({ recordStatus: 'DECEASED' }));
    await IDRecord.create({ applicantId: withId._id, department: 'PWD', idNumber: 'PWD-1', qrToken: 'q1' });

    const { statusSummary } = await buildPwdReports();
    expect(statusSummary).toMatchObject({ encodedToDOH: 1, withoutId: 1, expired: 1, deceased: 1 });
  });
});

const { buildSeniorReports } = require('../../src/lib/dashboardReports');

function sc(overrides = {}) {
  const { seniorCitizen: scSub = {}, ...rest } = overrides;
  return {
    department: 'SENIOR_CITIZEN', recordStatus: 'ACTIVE',
    lastName: 'Reyes', firstName: 'Maria',
    birthdate: new Date(new Date().getFullYear() - 65, 1, 1),
    encodedById: new (require('mongoose').Types.ObjectId)(),
    sex: 'Female', barangay: 'Abagon',
    seniorCitizen: { pensionType: 'SSS', registrationCategory: 'Walk-In', ...scSub },
    ...rest,
  };
}

describe('buildSeniorReports', () => {
  test('perPension: zero-filled vs PENSION_TYPES + Other bucket, M/F', async () => {
    await Applicant.create([
      sc({ sex: 'Male',   seniorCitizen: { pensionType: 'SSS' } }),
      sc({ sex: 'Female', seniorCitizen: { pensionType: 'SSS' } }),
      sc({ sex: 'Female', seniorCitizen: { pensionType: 'GSIS' } }),
      sc({ sex: 'Male',   seniorCitizen: { pensionType: 'WeirdValue' } }),
      sc({ sex: 'Female', seniorCitizen: { pensionType: undefined } }),
    ]);
    const { perPension } = await buildSeniorReports();
    const sss = perPension.find((r) => r.type === 'SSS');
    expect(sss).toMatchObject({ male: 1, female: 1, total: 2 });
    const other = perPension.find((r) => r.type === 'Other/Unspecified');
    expect(other).toMatchObject({ male: 1, female: 1, total: 2 });
    const pvao = perPension.find((r) => r.type === 'PVAO');
    expect(pvao).toMatchObject({ male: 0, female: 0, total: 0 });
    expect(perPension[perPension.length - 1].type).toBe('Other/Unspecified');
  });

  test('ageDistribution: 60-69/70-79/80-89/90+', async () => {
    const ageBday = (n) => new Date(new Date().getFullYear() - n, 1, 1);
    await Applicant.create([
      sc({ sex: 'Female', birthdate: ageBday(65) }),
      sc({ sex: 'Male',   birthdate: ageBday(75) }),
      sc({ sex: 'Female', birthdate: ageBday(95) }),
    ]);
    const { ageDistribution } = await buildSeniorReports();
    expect(ageDistribution.map((b) => b.bracket)).toEqual(['60-69', '70-79', '80-89', '90+']);
    expect(ageDistribution.find((b) => b.bracket === '90+')).toMatchObject({ female: 1, total: 1 });
  });

  test('registration: Walk-In / Caravan / unspecified', async () => {
    await Applicant.create([
      sc({ seniorCitizen: { registrationCategory: 'Walk-In' } }),
      sc({ seniorCitizen: { registrationCategory: 'Caravan' } }),
      sc({ seniorCitizen: { registrationCategory: 'Caravan' } }),
      sc({ seniorCitizen: { registrationCategory: undefined } }),
    ]);
    const { registration, sexSplit, perBarangay } = await buildSeniorReports();
    expect(registration).toEqual({ walkIn: 1, caravan: 2, unspecified: 1 });
    expect(sexSplit.total).toBe(4);
    expect(perBarangay).toHaveLength(44);
  });
});

describe('GET /api/dashboard/admin reports', () => {
  test('SOLO_PARENT admin response includes reports object', async () => {
    await createTestUser({ username: 'sp_admin', role: 'ADMIN', department: 'SOLO_PARENT' });
    const token = await getToken(app, 'sp_admin');

    await Applicant.create([
      sp({ sex: 'Female' }),
      sp({ sex: 'Male' }),
    ]);

    const res = await supertest(app)
      .get('/api/dashboard/admin')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.reports).toBeTruthy();
    expect(res.body.reports.sexSplit).toEqual({ male: 1, female: 1, total: 2 });
    expect(res.body.reports.perCategory).toHaveLength(13);
  });

  test('PWD admin response includes reports object', async () => {
    await createTestUser({ username: 'pwd_admin', role: 'ADMIN', department: 'PWD' });
    const token = await getToken(app, 'pwd_admin');

    const res = await supertest(app)
      .get('/api/dashboard/admin')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.reports).toBeTruthy();
    expect(res.body.reports.perDisability).toHaveLength(10);
  });
});

describe('GET /api/dashboard/admin reports — PWD & SC', () => {
  test('PWD admin gets perDisability + statusSummary', async () => {
    await createTestUser({ username: 'pwd_admin2', role: 'ADMIN', department: 'PWD' });
    const token = await getToken(app, 'pwd_admin2');
    await Applicant.create([pwd({ sex: 'Male' }), pwd({ sex: 'Female' })]);
    const res = await supertest(app).get('/api/dashboard/admin').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.reports.perDisability).toHaveLength(10);
    expect(res.body.reports.statusSummary).toBeTruthy();
  });

  test('SENIOR_CITIZEN admin gets perPension + registration', async () => {
    await createTestUser({ username: 'sc_admin', role: 'ADMIN', department: 'SENIOR_CITIZEN' });
    const token = await getToken(app, 'sc_admin');
    await Applicant.create([sc({ sex: 'Female' })]);
    const res = await supertest(app).get('/api/dashboard/admin').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.reports.perPension).toBeTruthy();
    expect(res.body.reports.registration).toBeTruthy();
  });
});
