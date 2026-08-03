# PWD & Senior Citizen Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **Git note:** This project is NOT a git repository. Skip commit steps — treat them as review checkpoints.
> **Run backend commands from `backend/`. Backend tests run on Windows via the existing sharp/@napi-rs/canvas jest mocks; the full suite also runs in WSL2.**

**Goal:** Add live overview report sections to the PWD (PDAO) and Senior Citizen (OSCA) admin dashboards, reusing the existing chart primitives.

**Architecture:** Approach B (unchanged). Backend adds `buildPwdReports()` / `buildSeniorReports()` to `dashboardReports.js`, dispatched by department in `getAdminDashboard`. Frontend adds `PwdReports.jsx` / `SeniorCitizenReports.jsx` composing existing primitives plus one new `StatTiles` primitive.

**Tech Stack:** Node + Express + Mongoose, Jest + mongodb-memory-server; React 18 + Vite + Tailwind v4 + recharts v3 + lucide-react.

**Reference:** mirrors `2026-06-01-solo-parent-dashboard.md`. The existing `dashboardReports.js` already exports `SEX_NORMALIZE`-based helpers `buildPerBarangay(agg)` and `buildSexSplit(agg)` (module-private) — this plan reuses them within the same file.

---

## File Structure

**Backend**
- `backend/src/lib/dashboardReports.js` (MODIFY) — add helpers (`computeAge`, `normSexJs`, `bucketAges`, age brackets, `stripNumPrefix`), `buildPerDisability`, `buildPerPension`, `buildRegistration`, and `buildPwdReports` / `buildSeniorReports`; export the two builders.
- `backend/src/controllers/dashboardController.js` (MODIFY) — dispatch PWD / SENIOR_CITIZEN.
- `backend/tests/integration/dashboardReports.test.js` (MODIFY) — add PWD + SC describe blocks.

**Frontend**
- `frontend/src/components/dashboard/StatTiles.jsx` (NEW)
- `frontend/src/components/dashboard/PwdReports.jsx` (NEW)
- `frontend/src/components/dashboard/SeniorCitizenReports.jsx` (NEW)
- `frontend/src/pages/admin/DashboardPage.jsx` (MODIFY) — render section per department.

---

## Task 1: PWD report builder + shared helpers (TDD)

**Files:** MODIFY `backend/src/lib/dashboardReports.js`; MODIFY `backend/tests/integration/dashboardReports.test.js`

- [ ] **Step 1: Write the failing tests** — append to `dashboardReports.test.js`:

```js
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
      pwd({ sex: 'Male',   birthdate: yrsAgo(10) }),  // 0-17
      pwd({ sex: 'Female', birthdate: yrsAgo(25) }),  // 18-30
      pwd({ sex: 'Male',   birthdate: yrsAgo(40) }),  // 31-59
      pwd({ sex: 'Female', birthdate: yrsAgo(70) }),  // 60+
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
    await Applicant.create(pwd({ sex: 'Female' }));                 // active, no ID -> withoutId
    await Applicant.create(pwd({ recordStatus: 'EXPIRED' }));        // expired
    await Applicant.create(pwd({ recordStatus: 'DECEASED' }));       // deceased
    await IDRecord.create({ applicantId: withId._id, department: 'PWD', idNumber: 'PWD-1', qrToken: 'q1' });

    const { statusSummary } = await buildPwdReports();
    expect(statusSummary).toMatchObject({ encodedToDOH: 1, withoutId: 1, expired: 1, deceased: 1 });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest tests/integration/dashboardReports.test.js -t buildPwdReports --runInBand --forceExit`. Expected: FAIL (`buildPwdReports` not a function).

- [ ] **Step 3: Implement** — in `backend/src/lib/dashboardReports.js`:

Add to the requires at top:
```js
const IDRecord = require('../models/IDRecord');
const { SOLO_PARENT_CATEGORIES, BARANGAYS, PWD_DISABILITY_TYPES, PENSION_TYPES } = require('./constants');
```
(Replace the existing `const { SOLO_PARENT_CATEGORIES, BARANGAYS } = require('./constants');` line with the line above — keep SOLO_PARENT_CATEGORIES and BARANGAYS, add the two new ones and the IDRecord require.)

Add these shared helpers (after the existing `SEX_NORMALIZE` constant):
```js
const PWD_AGE_BRACKETS = [
  { label: '0-17', min: 0, max: 17 },
  { label: '18-30', min: 18, max: 30 },
  { label: '31-59', min: 31, max: 59 },
  { label: '60+', min: 60, max: null },
];
const SC_AGE_BRACKETS = [
  { label: '60-69', min: 60, max: 69 },
  { label: '70-79', min: 70, max: 79 },
  { label: '80-89', min: 80, max: 89 },
  { label: '90+', min: 90, max: null },
];

function normSexJs(s) {
  if (s === 'Male' || s === 'M') return 'Male';
  if (s === 'Female' || s === 'F') return 'Female';
  return 'Unknown';
}

function computeAge(birthdate, now) {
  const b = new Date(birthdate);
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

function bucketAges(docs, brackets) {
  const now = new Date();
  const lookup = {};
  brackets.forEach((b) => { lookup[b.label] = { male: 0, female: 0 }; });
  docs.forEach((d) => {
    if (!d.birthdate) return;
    const sex = normSexJs(d.sex);
    if (sex === 'Unknown') return;
    const age = computeAge(d.birthdate, now);
    const b = brackets.find((br) => age >= br.min && (br.max == null || age <= br.max));
    if (!b) return;
    lookup[b.label][sex === 'Male' ? 'male' : 'female'] += 1;
  });
  return brackets.map((b) => ({
    bracket: b.label,
    male: lookup[b.label].male,
    female: lookup[b.label].female,
    total: lookup[b.label].male + lookup[b.label].female,
  }));
}

const stripNumPrefix = (s) => (s || '').replace(/^\d+\.\s*/, '');

function buildPerDisability(agg) {
  const lookup = {};
  agg.forEach(({ _id, count }) => {
    if (!_id.type) return;
    lookup[_id.type] = lookup[_id.type] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[_id.type].male += count;
    else if (_id.sex === 'Female') lookup[_id.type].female += count;
  });
  return PWD_DISABILITY_TYPES.map((code) => {
    const v = lookup[code] || { male: 0, female: 0 };
    return { code, label: stripNumPrefix(code), male: v.male, female: v.female, total: v.male + v.female };
  });
}
```

Add the PWD builder:
```js
async function buildPwdReports() {
  const active = { department: 'PWD', recordStatus: 'ACTIVE' };

  const [disabilityAgg, barangayAgg, sexAgg, ageDocs, dohCount, statusAgg, idApplicantIds, activeIdDocs] =
    await Promise.all([
      Applicant.aggregate([
        { $match: active },
        { $addFields: { _sex: SEX_NORMALIZE } },
        { $group: { _id: { type: '$pwd.disabilityType', sex: '$_sex' }, count: { $sum: 1 } } },
      ]),
      Applicant.aggregate([
        { $match: active },
        { $addFields: { _sex: SEX_NORMALIZE } },
        { $group: { _id: { barangay: '$barangay', sex: '$_sex' }, count: { $sum: 1 } } },
      ]),
      Applicant.aggregate([
        { $match: active },
        { $addFields: { _sex: SEX_NORMALIZE } },
        { $group: { _id: '$_sex', count: { $sum: 1 } } },
      ]),
      Applicant.find(active).select('birthdate sex').lean(),
      Applicant.countDocuments({ ...active, 'pwd.uploadedToDOH': true }),
      Applicant.aggregate([
        { $match: { department: 'PWD' } },
        { $group: { _id: '$recordStatus', count: { $sum: 1 } } },
      ]),
      IDRecord.distinct('applicantId', { department: 'PWD' }),
      Applicant.find(active).select('_id').lean(),
    ]);

  const statusMap = {};
  statusAgg.forEach(({ _id, count }) => { statusMap[_id] = count; });
  const idSet = new Set(idApplicantIds.map((x) => String(x)));
  const withoutId = activeIdDocs.filter((a) => !idSet.has(String(a._id))).length;

  return {
    perDisability: buildPerDisability(disabilityAgg),
    perBarangay: buildPerBarangay(barangayAgg),
    ageDistribution: bucketAges(ageDocs, PWD_AGE_BRACKETS),
    sexSplit: buildSexSplit(sexAgg),
    statusSummary: {
      encodedToDOH: dohCount,
      withoutId,
      expired: statusMap.EXPIRED || 0,
      deceased: statusMap.DECEASED || 0,
    },
  };
}
```

Update `module.exports` at the bottom to include the new builder:
```js
module.exports = { buildSoloParentReports, buildPwdReports };
```

- [ ] **Step 4: Run to verify pass** — `npx jest tests/integration/dashboardReports.test.js -t buildPwdReports --runInBand --forceExit`. Expected: 4 PWD tests PASS (and the existing Solo Parent tests still pass when running the full file).

- [ ] **Step 5: Commit** — `git add backend/src/lib/dashboardReports.js backend/tests/integration/dashboardReports.test.js && git commit -m "feat(dashboard): add PWD report builder"`

---

## Task 2: Senior Citizen report builder (TDD)

**Files:** MODIFY `backend/src/lib/dashboardReports.js`; MODIFY `backend/tests/integration/dashboardReports.test.js`

- [ ] **Step 1: Write the failing tests** — append:

```js
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
      sc({ sex: 'Male',   seniorCitizen: { pensionType: 'WeirdValue' } }), // -> Other/Unspecified
      sc({ sex: 'Female', seniorCitizen: { pensionType: undefined } }),    // -> Other/Unspecified
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
      sc({ sex: 'Female', birthdate: ageBday(65) }),  // 60-69
      sc({ sex: 'Male',   birthdate: ageBday(75) }),  // 70-79
      sc({ sex: 'Female', birthdate: ageBday(95) }),  // 90+
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
```

- [ ] **Step 2: Run to verify failure** — `npx jest tests/integration/dashboardReports.test.js -t buildSeniorReports --runInBand --forceExit`. Expected: FAIL.

- [ ] **Step 3: Implement** — in `dashboardReports.js`, add:

```js
function buildPerPension(agg) {
  const known = new Set(PENSION_TYPES);
  const lookup = {};
  agg.forEach(({ _id, count }) => {
    const raw = _id.type;
    const key = known.has(raw) ? raw : 'Other/Unspecified';
    lookup[key] = lookup[key] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[key].male += count;
    else if (_id.sex === 'Female') lookup[key].female += count;
  });
  const list = [...PENSION_TYPES, 'Other/Unspecified'];
  return list.map((type) => {
    const v = lookup[type] || { male: 0, female: 0 };
    return { type, label: type, male: v.male, female: v.female, total: v.male + v.female };
  });
}

function buildRegistration(agg) {
  let walkIn = 0; let caravan = 0; let unspecified = 0;
  agg.forEach(({ _id, count }) => {
    if (_id === 'Walk-In') walkIn += count;
    else if (_id === 'Caravan') caravan += count;
    else unspecified += count;
  });
  return { walkIn, caravan, unspecified };
}

async function buildSeniorReports() {
  const active = { department: 'SENIOR_CITIZEN', recordStatus: 'ACTIVE' };

  const [pensionAgg, barangayAgg, sexAgg, ageDocs, registrationAgg] = await Promise.all([
    Applicant.aggregate([
      { $match: active },
      { $addFields: { _sex: SEX_NORMALIZE } },
      { $group: { _id: { type: '$seniorCitizen.pensionType', sex: '$_sex' }, count: { $sum: 1 } } },
    ]),
    Applicant.aggregate([
      { $match: active },
      { $addFields: { _sex: SEX_NORMALIZE } },
      { $group: { _id: { barangay: '$barangay', sex: '$_sex' }, count: { $sum: 1 } } },
    ]),
    Applicant.aggregate([
      { $match: active },
      { $addFields: { _sex: SEX_NORMALIZE } },
      { $group: { _id: '$_sex', count: { $sum: 1 } } },
    ]),
    Applicant.find(active).select('birthdate sex').lean(),
    Applicant.aggregate([
      { $match: active },
      { $group: { _id: '$seniorCitizen.registrationCategory', count: { $sum: 1 } } },
    ]),
  ]);

  return {
    perPension: buildPerPension(pensionAgg),
    perBarangay: buildPerBarangay(barangayAgg),
    ageDistribution: bucketAges(ageDocs, SC_AGE_BRACKETS),
    sexSplit: buildSexSplit(sexAgg),
    registration: buildRegistration(registrationAgg),
  };
}
```

Update exports:
```js
module.exports = { buildSoloParentReports, buildPwdReports, buildSeniorReports };
```

- [ ] **Step 4: Run to verify pass** — `npx jest tests/integration/dashboardReports.test.js --runInBand --forceExit`. Expected: ALL pass (Solo Parent + PWD + SC).

- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): add Senior Citizen report builder"`

---

## Task 3: Controller dispatch + endpoint tests

**Files:** MODIFY `backend/src/controllers/dashboardController.js`; MODIFY `backend/tests/integration/dashboardReports.test.js`

- [ ] **Step 1: Write failing tests** — append:

```js
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
```
(`supertest`, `app`, `createTestUser`, `getToken`, `pwd`, `sc` are already defined earlier in the file.)

- [ ] **Step 2: Run to verify failure** — `npx jest tests/integration/dashboardReports.test.js -t "PWD & SC" --runInBand --forceExit`. Expected: FAIL (`reports.perDisability` undefined — controller still only handles SOLO_PARENT).

- [ ] **Step 3: Implement** — in `dashboardController.js`:

Replace the require line `const { buildSoloParentReports } = require('../lib/dashboardReports');` with:
```js
const { buildSoloParentReports, buildPwdReports, buildSeniorReports } = require('../lib/dashboardReports');
```

In `getAdminDashboard`, the report builder currently runs inside `Promise.all` as:
`dept === 'SOLO_PARENT' ? buildSoloParentReports() : Promise.resolve(null)`.
Replace that single ternary array element with a call to a small dispatch helper. Add this helper near the top of the file (after requires):
```js
function reportsBuilderFor(dept) {
  if (dept === 'SOLO_PARENT')     return buildSoloParentReports();
  if (dept === 'PWD')             return buildPwdReports();
  if (dept === 'SENIOR_CITIZEN')  return buildSeniorReports();
  return Promise.resolve(null);
}
```
and change the `Promise.all` element to:
```js
      reportsBuilderFor(dept),
```

- [ ] **Step 4: Run to verify pass** — `npx jest tests/integration/dashboardReports.test.js --runInBand --forceExit`. Expected: ALL pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): dispatch PWD/SC report builders in admin endpoint"`

---

## Task 4: `StatTiles` primitive

**Files:** NEW `frontend/src/components/dashboard/StatTiles.jsx`

- [ ] **Step 1: Create the component**

```jsx
export default function StatTiles({ tiles, columns = 2 }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {tiles.map(({ key, label, value, color, Icon }) => (
        <div key={key} className="rounded-lg p-3" style={{ background: 'var(--color-surface)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
            {Icon && <Icon className="w-3.5 h-3.5" style={{ color: color || 'var(--color-muted)' }} strokeWidth={2} />}
          </div>
          <span className="font-serif text-xl" style={{ color: 'var(--color-text-1)' }}>{(value ?? 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles** — `cd frontend && npx vite build`. Expected: no error referencing `StatTiles`.
- [ ] **Step 3: Commit** — `git add frontend/src/components/dashboard/StatTiles.jsx && git commit -m "feat(dashboard): add StatTiles primitive"`

---

## Task 5: `PwdReports` section + integration

**Files:** NEW `frontend/src/components/dashboard/PwdReports.jsx`; MODIFY `frontend/src/pages/admin/DashboardPage.jsx`

- [ ] **Step 1: Create `PwdReports.jsx`**

```jsx
import { Send, IdCard, CalendarX, HeartCrack } from 'lucide-react';
import ReportCard from './ReportCard';
import GroupedBarChart from './GroupedBarChart';
import DonutChart from './DonutChart';
import RankedBarList from './RankedBarList';
import StatTiles from './StatTiles';

export default function PwdReports({ reports, dept }) {
  const primary = dept.barFill;   // PWD blue #3B82F6
  const secondary = '#64748B';
  const {
    perDisability = [], perBarangay = [], ageDistribution = [],
    sexSplit = { male: 0, female: 0, total: 0 },
    statusSummary = {},
  } = reports;

  const tiles = [
    { key: 'doh',      label: 'Encoded to DOH', value: statusSummary.encodedToDOH, color: primary,    Icon: Send },
    { key: 'noid',     label: 'Without ID No.', value: statusSummary.withoutId,    color: '#D97706',  Icon: IdCard },
    { key: 'expired',  label: 'Expired',        value: statusSummary.expired,      color: '#DC2626',  Icon: CalendarX },
    { key: 'deceased', label: 'Deceased',       value: statusSummary.deceased,     color: '#6B7280',  Icon: HeartCrack },
  ];

  return (
    <div className="mt-5 space-y-5 animate-fade-up">
      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <ReportCard title="Persons with Disability per Type" subtitle="By disability type · Male vs Female">
          {perDisability.every((d) => d.total === 0) ? (
            <EmptyBox text="No records yet" />
          ) : (
            <GroupedBarChart
              data={perDisability.map((r) => ({ ...r, label: r.label }))}
              xKey="label" layout="vertical" height={360} barSize={10}
              series={[{ key: 'male', name: 'Male', color: primary }, { key: 'female', name: 'Female', color: secondary }]}
            />
          )}
        </ReportCard>
        <ReportCard title="Gender Distribution" subtitle="All registered PWDs">
          {sexSplit.total === 0 ? <EmptyBox text="No records yet" /> : (
            <DonutChart centerLabel="PWDs" data={[
              { name: 'Male', value: sexSplit.male, color: primary },
              { name: 'Female', value: sexSplit.female, color: secondary },
            ]} />
          )}
        </ReportCard>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <ReportCard title="Age Distribution" subtitle="By age range · Male vs Female">
          {ageDistribution.every((b) => b.total === 0) ? <EmptyBox text="No records with a birthdate yet" /> : (
            <GroupedBarChart
              data={ageDistribution.map((r) => ({ ...r, label: r.bracket }))}
              xKey="label" height={220}
              series={[{ key: 'male', name: 'Male', color: primary }, { key: 'female', name: 'Female', color: secondary }]}
            />
          )}
        </ReportCard>
        <ReportCard title="ID & Status Summary" subtitle="Record status overview">
          <StatTiles tiles={tiles} />
        </ReportCard>
      </div>

      <ReportCard title="Persons with Disability per Barangay" subtitle="44 barangays · sorted by total · Male vs Female">
        {perBarangay.every((b) => b.total === 0) ? <EmptyBox text="No records yet" /> : (
          <RankedBarList items={perBarangay} maleColor={primary} femaleColor={secondary} />
        )}
      </ReportCard>
    </div>
  );
}

function EmptyBox({ text }) {
  return (
    <div className="flex items-center justify-center rounded-lg" style={{ background: 'var(--color-surface)', minHeight: 160 }}>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{text}</p>
    </div>
  );
}
```

- [ ] **Step 2: Integrate into `DashboardPage.jsx`**

Add import after the existing `SoloParentReports` import:
```jsx
import PwdReports from '../../components/dashboard/PwdReports';
```
Replace the existing single-branch block:
```jsx
      {!isLoading && user?.department === 'SOLO_PARENT' && data?.reports && (
        <SoloParentReports reports={data.reports} dept={dept} />
      )}
```
with a per-department render:
```jsx
      {!isLoading && data?.reports && (
        <>
          {user?.department === 'SOLO_PARENT' && <SoloParentReports reports={data.reports} dept={dept} />}
          {user?.department === 'PWD' && <PwdReports reports={data.reports} dept={dept} />}
        </>
      )}
```

- [ ] **Step 3: Verify build** — `cd frontend && npx vite build`. Expected: success.
- [ ] **Step 4: Commit** — `git add -A frontend/src && git commit -m "feat(dashboard): render PWD reports section"`

---

## Task 6: `SeniorCitizenReports` section + integration + final verification

**Files:** NEW `frontend/src/components/dashboard/SeniorCitizenReports.jsx`; MODIFY `frontend/src/pages/admin/DashboardPage.jsx`

- [ ] **Step 1: Create `SeniorCitizenReports.jsx`**

```jsx
import ReportCard from './ReportCard';
import GroupedBarChart from './GroupedBarChart';
import DonutChart from './DonutChart';
import RankedBarList from './RankedBarList';

export default function SeniorCitizenReports({ reports, dept }) {
  const primary = dept.barFill;   // SC amber #D97706
  const secondary = '#64748B';
  const {
    perPension = [], perBarangay = [], ageDistribution = [],
    sexSplit = { male: 0, female: 0, total: 0 },
    registration = { walkIn: 0, caravan: 0, unspecified: 0 },
  } = reports;

  return (
    <div className="mt-5 space-y-5 animate-fade-up">
      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <ReportCard title="Senior Citizens per Pension Type" subtitle="By pension type · Male vs Female">
          {perPension.every((p) => p.total === 0) ? <EmptyBox text="No records yet" /> : (
            <GroupedBarChart
              data={perPension.map((r) => ({ ...r, label: r.label }))}
              xKey="label" layout="vertical" height={320} barSize={11}
              series={[{ key: 'male', name: 'Male', color: primary }, { key: 'female', name: 'Female', color: secondary }]}
            />
          )}
        </ReportCard>
        <ReportCard title="Gender Distribution" subtitle="All registered senior citizens">
          {sexSplit.total === 0 ? <EmptyBox text="No records yet" /> : (
            <DonutChart centerLabel="Seniors" data={[
              { name: 'Male', value: sexSplit.male, color: primary },
              { name: 'Female', value: sexSplit.female, color: secondary },
            ]} />
          )}
        </ReportCard>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <ReportCard title="Age Distribution" subtitle="By age range · Male vs Female">
          {ageDistribution.every((b) => b.total === 0) ? <EmptyBox text="No records with a birthdate yet" /> : (
            <GroupedBarChart
              data={ageDistribution.map((r) => ({ ...r, label: r.bracket }))}
              xKey="label" height={220}
              series={[{ key: 'male', name: 'Male', color: primary }, { key: 'female', name: 'Female', color: secondary }]}
            />
          )}
        </ReportCard>
        <ReportCard title="Registration Type" subtitle="How seniors were registered">
          {(registration.walkIn + registration.caravan + registration.unspecified) === 0 ? (
            <EmptyBox text="No records yet" />
          ) : (
            <DonutChart centerLabel="Seniors" data={[
              { name: 'Walk-In', value: registration.walkIn, color: primary },
              { name: 'Caravan', value: registration.caravan, color: secondary },
              { name: 'Unspecified', value: registration.unspecified, color: '#CBD5E1' },
            ]} />
          )}
        </ReportCard>
      </div>

      <ReportCard title="Senior Citizens per Barangay" subtitle="44 barangays · sorted by total · Male vs Female">
        {perBarangay.every((b) => b.total === 0) ? <EmptyBox text="No records yet" /> : (
          <RankedBarList items={perBarangay} maleColor={primary} femaleColor={secondary} />
        )}
      </ReportCard>
    </div>
  );
}

function EmptyBox({ text }) {
  return (
    <div className="flex items-center justify-center rounded-lg" style={{ background: 'var(--color-surface)', minHeight: 160 }}>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{text}</p>
    </div>
  );
}
```

- [ ] **Step 2: Integrate into `DashboardPage.jsx`**

Add import:
```jsx
import SeniorCitizenReports from '../../components/dashboard/SeniorCitizenReports';
```
Add the SC branch inside the existing fragment from Task 5:
```jsx
          {user?.department === 'SENIOR_CITIZEN' && <SeniorCitizenReports reports={data.reports} dept={dept} />}
```

- [ ] **Step 3: Verify build** — `cd frontend && npx vite build`. Expected: success.

- [ ] **Step 4: Full backend suite** — `cd backend && npx jest tests/integration/dashboardReports.test.js --runInBand --forceExit`. Expected: all pass (Solo Parent + PWD + SC + endpoints).

- [ ] **Step 5: Commit** — `git add -A frontend/src && git commit -m "feat(dashboard): render Senior Citizen reports section"`

---

## Final Verification
- [ ] `cd backend && npx jest tests/integration/dashboardReports.test.js --runInBand --forceExit` — all green.
- [ ] `cd frontend && npx vite build` — builds clean.
- [ ] Manual (controller-run): log in as PWD admin and SC admin; confirm each section renders with correct charts, empty states behave, and Solo Parent is unaffected.

## Notes
- Reuses `buildPerBarangay`/`buildSexSplit`/`SEX_NORMALIZE` already in `dashboardReports.js` (DRY).
- `ExpiryPanel` remains Solo-Parent-only (not reused), as anticipated.
- `secondary = '#64748B'` slate stays hardcoded per section (same as Solo Parent); revisit if a per-dept secondary is wanted later.
