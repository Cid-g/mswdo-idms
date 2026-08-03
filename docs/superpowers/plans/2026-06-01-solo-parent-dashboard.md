# Solo Parent Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git note:** This project is not currently a git repository. If `git` commands error, skip the commit steps — treat them as review checkpoints instead.

**Goal:** Add live, DB-computed statistical reports (per category, per barangay, per year, sex split, SPIC expiry) to the Solo Parent admin dashboard with a polished UI.

**Architecture:** Approach B — the backend attaches a department-aware `reports` object to the existing `/dashboard/admin` response; the frontend renders it through a set of reusable chart primitives composed by a per-department section component. Reusable layer = chart primitives (so PWD/SC reuse them later).

**Tech Stack:** Node.js + Express + Mongoose (backend), Jest + mongodb-memory-server (tests), React 18 + Vite + Tailwind v4 + recharts + lucide-react (frontend).

---

## File Structure

**Backend**
- `backend/src/lib/dashboardReports.js` (NEW) — `buildSoloParentReports()` + report helpers + category labels. One responsibility: turn `Applicant` records into Solo Parent report data.
- `backend/src/controllers/dashboardController.js` (MODIFY) — dispatch to the report builder and attach `reports` to the admin response.
- `backend/tests/integration/dashboardReports.test.js` (NEW) — seeds applicants, asserts every report block.

**Frontend** (`frontend/src/components/dashboard/`)
- `ReportCard.jsx` (NEW) — card wrapper (title/subtitle/body).
- `GroupedBarChart.jsx` (NEW) — recharts grouped bars (Per Year, Per Category).
- `DonutChart.jsx` (NEW) — recharts donut (sex split).
- `RankedBarList.jsx` (NEW) — CSS horizontal M/F bar list (Per Barangay).
- `ExpiryPanel.jsx` (NEW) — expiry stat tiles + soon-to-expire list.
- `SoloParentReports.jsx` (NEW) — composes the primitives from `reports`.
- `frontend/src/pages/admin/DashboardPage.jsx` (MODIFY) — render `SoloParentReports` for `SOLO_PARENT`.

---

## Task 1: Backend report builder (`dashboardReports.js`) with tests

**Files:**
- Create: `backend/src/lib/dashboardReports.js`
- Test: `backend/tests/integration/dashboardReports.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/integration/dashboardReports.test.js`:

```js
'use strict';

const db = require('../dbHelpers');
const Applicant = require('../../src/models/Applicant');
const { buildSoloParentReports } = require('../../src/lib/dashboardReports');

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
      // issued 13 months ago -> expired
      sp({ soloParent: { categoryCode: 'A2', spicNumber: 'SP-1', dateSpicIssued: new Date(now - 396 * day) } }),
      // issued 11.5 months ago -> expires in ~15 days (days30)
      sp({ soloParent: { categoryCode: 'A2', spicNumber: 'SP-2', dateSpicIssued: new Date(now - 350 * day) } }),
      // issued 10 months ago -> expires in ~65 days (days90)
      sp({ soloParent: { categoryCode: 'A2', spicNumber: 'SP-3', dateSpicIssued: new Date(now - 300 * day) } }),
      // issued today -> valid
      sp({ soloParent: { categoryCode: 'A2', spicNumber: 'SP-4', dateSpicIssued: new Date(now) } }),
    ]);

    const { spicExpiry } = await buildSoloParentReports();

    expect(spicExpiry.buckets).toEqual({ expired: 1, days30: 1, days90: 1, valid: 1 });
    // soon list = expired + days30 + days90, sorted by daysLeft asc, valid excluded
    expect(spicExpiry.soon.map((r) => r.spicNumber)).toEqual(['SP-1', 'SP-2', 'SP-3']);
    expect(spicExpiry.soon[0].status).toBe('expired');
    expect(spicExpiry.soon[0].name).toBe('Cruz, Maria');
  });

  test('only counts ACTIVE records in SOLO_PARENT department', async () => {
    await Applicant.create([
      sp({ sex: 'Female' }),
      sp({ sex: 'Female', recordStatus: 'ARCHIVED' }),   // excluded
      sp({ sex: 'Female', department: 'PWD' }),           // excluded
    ]);

    const { sexSplit } = await buildSoloParentReports();
    expect(sexSplit.total).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest tests/integration/dashboardReports.test.js --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../../src/lib/dashboardReports'`.

- [ ] **Step 3: Implement the builder**

Create `backend/src/lib/dashboardReports.js`:

```js
'use strict';

const Applicant = require('../models/Applicant');
const { SOLO_PARENT_CATEGORIES, BARANGAYS } = require('./constants');

const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * DAY_MS;

// `sex` is a mixed enum ('Male'/'Female' and legacy 'M'/'F'). Normalize in-pipeline.
const SEX_NORMALIZE = {
  $cond: [
    { $in: ['$sex', ['Male', 'M']] },
    'Male',
    { $cond: [{ $in: ['$sex', ['Female', 'F']] }, 'Female', 'Unknown'] },
  ],
};

function buildPerCategory(agg) {
  const lookup = {};
  agg.forEach(({ _id, count }) => {
    if (!_id.code) return;
    lookup[_id.code] = lookup[_id.code] || { New: 0, Renewal: 0 };
    // null/undefined spicStatus is treated as New (transactionType defaults to New)
    if (_id.status === 'Renewal') lookup[_id.code].Renewal += count;
    else lookup[_id.code].New += count;
  });
  return SOLO_PARENT_CATEGORIES.map(({ code, label }) => {
    const c = lookup[code] || { New: 0, Renewal: 0 };
    return { code, label, new: c.New, renew: c.Renewal, total: c.New + c.Renewal };
  });
}

function buildPerBarangay(agg) {
  const lookup = {};
  agg.forEach(({ _id, count }) => {
    if (!_id.barangay) return;
    lookup[_id.barangay] = lookup[_id.barangay] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[_id.barangay].male += count;
    else if (_id.sex === 'Female') lookup[_id.barangay].female += count;
  });
  return BARANGAYS
    .map((barangay) => {
      const v = lookup[barangay] || { male: 0, female: 0 };
      return { barangay, male: v.male, female: v.female, total: v.male + v.female };
    })
    .sort((a, b) => b.total - a.total);
}

function buildPerYear(agg) {
  const lookup = {};
  agg.forEach(({ _id, count }) => {
    lookup[_id.year] = lookup[_id.year] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[_id.year].male += count;
    else if (_id.sex === 'Female') lookup[_id.year].female += count;
  });
  return Object.keys(lookup)
    .map(Number)
    .sort((a, b) => a - b)
    .map((year) => ({
      year,
      male: lookup[year].male,
      female: lookup[year].female,
      total: lookup[year].male + lookup[year].female,
    }));
}

function buildSexSplit(agg) {
  let male = 0;
  let female = 0;
  agg.forEach(({ _id, count }) => {
    if (_id === 'Male') male += count;
    else if (_id === 'Female') female += count;
  });
  return { male, female, total: male + female };
}

function buildSpicExpiry(docs) {
  const now = Date.now();
  const buckets = { expired: 0, days30: 0, days90: 0, valid: 0 };
  const soon = [];
  docs.forEach((d) => {
    const issued = new Date(d.soloParent.dateSpicIssued).getTime();
    const expiry = issued + ONE_YEAR_MS;
    const daysLeft = Math.ceil((expiry - now) / DAY_MS);
    let status;
    if (daysLeft < 0) { buckets.expired += 1; status = 'expired'; }
    else if (daysLeft <= 30) { buckets.days30 += 1; status = 'days30'; }
    else if (daysLeft <= 90) { buckets.days90 += 1; status = 'days90'; }
    else { buckets.valid += 1; status = 'valid'; }

    if (status !== 'valid') {
      soon.push({
        name: `${d.lastName}, ${d.firstName}`,
        spicNumber: d.soloParent.spicNumber || null,
        dateSpicIssued: d.soloParent.dateSpicIssued,
        expiry: new Date(expiry),
        daysLeft,
        status,
      });
    }
  });
  soon.sort((a, b) => a.daysLeft - b.daysLeft);
  return { buckets, soon };
}

async function buildSoloParentReports() {
  const match = { department: 'SOLO_PARENT', recordStatus: 'ACTIVE' };

  const [categoryAgg, barangayAgg, yearAgg, sexAgg, spicDocs] = await Promise.all([
    Applicant.aggregate([
      { $match: match },
      { $group: { _id: { code: '$soloParent.categoryCode', status: '$soloParent.spicStatus' }, count: { $sum: 1 } } },
    ]),
    Applicant.aggregate([
      { $match: match },
      { $addFields: { _sex: SEX_NORMALIZE } },
      { $group: { _id: { barangay: '$barangay', sex: '$_sex' }, count: { $sum: 1 } } },
    ]),
    Applicant.aggregate([
      { $match: { ...match, 'soloParent.dateSpicIssued': { $ne: null } } },
      { $addFields: { _sex: SEX_NORMALIZE, _year: { $year: '$soloParent.dateSpicIssued' } } },
      { $group: { _id: { year: '$_year', sex: '$_sex' }, count: { $sum: 1 } } },
    ]),
    Applicant.aggregate([
      { $match: match },
      { $addFields: { _sex: SEX_NORMALIZE } },
      { $group: { _id: '$_sex', count: { $sum: 1 } } },
    ]),
    Applicant.find({ ...match, 'soloParent.dateSpicIssued': { $ne: null } })
      .select('firstName lastName soloParent.spicNumber soloParent.dateSpicIssued')
      .lean(),
  ]);

  return {
    perCategory: buildPerCategory(categoryAgg),
    perBarangay: buildPerBarangay(barangayAgg),
    perYear: buildPerYear(yearAgg),
    sexSplit: buildSexSplit(sexAgg),
    spicExpiry: buildSpicExpiry(spicDocs),
  };
}

module.exports = { buildSoloParentReports };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest tests/integration/dashboardReports.test.js --runInBand --forceExit`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/dashboardReports.js backend/tests/integration/dashboardReports.test.js
git commit -m "feat(dashboard): add Solo Parent report builder"
```

---

## Task 2: Wire the builder into the admin dashboard endpoint

**Files:**
- Modify: `backend/src/controllers/dashboardController.js`
- Test: `backend/tests/integration/dashboardReports.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/integration/dashboardReports.test.js`:

```js
const supertest = require('supertest');
const app = require('../../src/app');
const { createTestUser, getToken } = require('../testHelpers');

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

  test('non-SOLO_PARENT admin response has reports = null', async () => {
    await createTestUser({ username: 'pwd_admin', role: 'ADMIN', department: 'PWD' });
    const token = await getToken(app, 'pwd_admin');

    const res = await supertest(app)
      .get('/api/dashboard/admin')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.reports).toBeNull();
  });
});
```

> Note: this `describe` block creates users and does not clear them in `afterEach` (only applicants/sequences/auditlogs are cleared by `db.clear()` which wipes all collections — acceptable here since each test re-creates its user before use).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest tests/integration/dashboardReports.test.js -t "reports object" --runInBand --forceExit`
Expected: FAIL — `res.body.reports` is `undefined`.

- [ ] **Step 3: Implement the wiring**

In `backend/src/controllers/dashboardController.js`:

Add the require near the top (after the existing model requires, around line 4):

```js
const { buildSoloParentReports } = require('../lib/dashboardReports');
```

In `getAdminDashboard`, replace the final `res.json({ ... })` block (currently lines ~152-160) with:

```js
    let reports = null;
    if (dept === 'SOLO_PARENT') {
      reports = await buildSoloParentReports();
    }

    res.json({
      department: dept,
      totalApplicants,
      activeIDs,
      partialRecords,
      revokedIDs,
      recentActivity,
      monthlyTrend,
      reports,
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest tests/integration/dashboardReports.test.js --runInBand --forceExit`
Expected: PASS — all tests green (Task 1 + Task 2).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/dashboardController.js backend/tests/integration/dashboardReports.test.js
git commit -m "feat(dashboard): attach Solo Parent reports to admin endpoint"
```

---

## Task 3: `ReportCard` primitive

**Files:**
- Create: `frontend/src/components/dashboard/ReportCard.jsx`

- [ ] **Step 1: Create the component**

```jsx
export default function ReportCard({ title, subtitle, children, className = '', style }) {
  return (
    <div className={`bg-white rounded-xl p-6 flex flex-col ${className}`} style={{ boxShadow: 'var(--shadow-card)', ...style }}>
      <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-text-1)' }}>{title}</p>
      {subtitle && <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>{subtitle}</p>}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx vite build` (or rely on the dev server later in Task 8).
Expected: no build error referencing `ReportCard`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/ReportCard.jsx
git commit -m "feat(dashboard): add ReportCard primitive"
```

---

## Task 4: `GroupedBarChart` primitive

**Files:**
- Create: `frontend/src/components/dashboard/GroupedBarChart.jsx`

- [ ] **Step 1: Create the component**

Renders two side-by-side bar series. `data` is an array of objects; `xKey` is the category axis field; `series` is `[{ key, name, color }, ...]`. `layout="vertical"` supports horizontal bars (used for Per Category).

```jsx
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--color-text-1)', color: '#fff', boxShadow: 'var(--shadow-md)' }}>
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: '#fff' }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
}

export default function GroupedBarChart({ data, xKey, series, height = 220, layout = 'horizontal', barSize = 16 }) {
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={layout}
        margin={vertical ? { top: 4, right: 16, bottom: 0, left: 8 } : { top: 4, right: 8, bottom: 0, left: -20 }}
        barGap={2}
        barCategoryGap={vertical ? 6 : '20%'}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={!vertical} vertical={vertical} />
        {vertical ? (
          <>
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey={xKey} width={150} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
          </>
        )}
        <Tooltip content={<Tip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} barSize={barSize} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Verify it compiles** — `cd frontend && npx vite build`. Expected: no error referencing `GroupedBarChart`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/GroupedBarChart.jsx
git commit -m "feat(dashboard): add GroupedBarChart primitive"
```

---

## Task 5: `DonutChart` primitive

**Files:**
- Create: `frontend/src/components/dashboard/DonutChart.jsx`

- [ ] **Step 1: Create the component**

`data` is `[{ name, value, color }, ...]`. Renders a donut with a centered total.

```jsx
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export default function DonutChart({ data, height = 200, centerLabel = 'Total' }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="90%" paddingAngle={2} stroke="none">
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip
            formatter={(value, name) => [`${value} (${total ? Math.round((value / total) * 100) : 0}%)`, name]}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: 'var(--shadow-md)', fontSize: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="font-serif text-2xl leading-none" style={{ color: 'var(--color-text-1)' }}>{total.toLocaleString()}</span>
        <span className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{centerLabel}</span>
      </div>
      <div className="flex justify-center gap-4 mt-3">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{d.name} · {d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles** — `cd frontend && npx vite build`. Expected: no error referencing `DonutChart`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/DonutChart.jsx
git commit -m "feat(dashboard): add DonutChart primitive"
```

---

## Task 6: `RankedBarList` primitive

**Files:**
- Create: `frontend/src/components/dashboard/RankedBarList.jsx`

- [ ] **Step 1: Create the component**

Horizontal stacked Male/Female bars for each barangay. `items` is `[{ barangay, male, female, total }]` (already sorted). Scrollable container; bar width is relative to the max total.

```jsx
export default function RankedBarList({ items, maleColor, femaleColor, maxHeight = 360 }) {
  const max = Math.max(1, ...items.map((i) => i.total));
  return (
    <div className="overflow-y-auto pr-1" style={{ maxHeight }}>
      <div className="flex items-center gap-3 mb-3">
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: maleColor }} /> Male
        </span>
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: femaleColor }} /> Female
        </span>
      </div>
      <div className="space-y-2.5">
        {items.map((i) => (
          <div key={i.barangay} className="flex items-center gap-3">
            <span className="text-xs w-28 flex-shrink-0 truncate" style={{ color: 'var(--color-text-1)' }} title={i.barangay}>
              {i.barangay}
            </span>
            <div className="flex-1 h-5 rounded-full overflow-hidden flex" style={{ background: 'var(--color-surface)' }}>
              <div style={{ width: `${(i.male / max) * 100}%`, background: maleColor }} className="h-full transition-all" />
              <div style={{ width: `${(i.female / max) * 100}%`, background: femaleColor }} className="h-full transition-all" />
            </div>
            <span className="text-xs w-8 text-right flex-shrink-0 font-medium" style={{ color: 'var(--color-text-1)' }}>{i.total}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles** — `cd frontend && npx vite build`. Expected: no error referencing `RankedBarList`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/RankedBarList.jsx
git commit -m "feat(dashboard): add RankedBarList primitive"
```

---

## Task 7: `ExpiryPanel` primitive

**Files:**
- Create: `frontend/src/components/dashboard/ExpiryPanel.jsx`

- [ ] **Step 1: Create the component**

`buckets` is `{ expired, days30, days90, valid }`; `soon` is the list of soon/expired records. Four tiles on top, scrollable list below with day-countdown badges.

```jsx
import { AlertTriangle, Clock, CalendarClock, ShieldCheck } from 'lucide-react';

const TILES = [
  { key: 'expired', label: 'Expired',     Icon: AlertTriangle, color: '#DC2626' },
  { key: 'days30',  label: '≤ 30 days',   Icon: Clock,         color: '#D97706' },
  { key: 'days90',  label: '≤ 90 days',   Icon: CalendarClock, color: '#CA8A04' },
  { key: 'valid',   label: 'Valid',       Icon: ShieldCheck,   color: '#059669' },
];

const STATUS_STYLE = {
  expired: { bg: '#FEE2E2', fg: '#DC2626' },
  days30:  { bg: '#FEF3C7', fg: '#D97706' },
  days90:  { bg: '#FEF9C3', fg: '#CA8A04' },
};

function badgeText(r) {
  if (r.daysLeft < 0) return `${Math.abs(r.daysLeft)}d overdue`;
  return `${r.daysLeft}d left`;
}

export default function ExpiryPanel({ buckets, soon, maxHeight = 240 }) {
  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-2 gap-2 mb-4">
        {TILES.map(({ key, label, Icon, color }) => (
          <div key={key} className="rounded-lg p-3" style={{ background: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
              <Icon className="w-3.5 h-3.5" style={{ color }} strokeWidth={2} />
            </div>
            <span className="font-serif text-xl" style={{ color: 'var(--color-text-1)' }}>{buckets[key] ?? 0}</span>
          </div>
        ))}
      </div>

      <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text-1)' }}>For renewal</p>
      {soon.length === 0 ? (
        <div className="flex-1 flex items-center justify-center rounded-lg" style={{ background: 'var(--color-surface)', minHeight: 80 }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No IDs expiring soon</p>
        </div>
      ) : (
        <div className="overflow-y-auto pr-1 space-y-2" style={{ maxHeight }}>
          {soon.map((r, idx) => {
            const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.days90;
            return (
              <div key={`${r.spicNumber ?? 'na'}-${idx}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs truncate" style={{ color: 'var(--color-text-1)' }}>{r.name}</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{r.spicNumber ?? 'No SPIC #'}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0 font-medium" style={{ background: s.bg, color: s.fg }}>
                  {badgeText(r)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles** — `cd frontend && npx vite build`. Expected: no error referencing `ExpiryPanel`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/ExpiryPanel.jsx
git commit -m "feat(dashboard): add ExpiryPanel primitive"
```

---

## Task 8: `SoloParentReports` section + dashboard integration

**Files:**
- Create: `frontend/src/components/dashboard/SoloParentReports.jsx`
- Modify: `frontend/src/pages/admin/DashboardPage.jsx`

- [ ] **Step 1: Create the section component**

Composes the primitives. `dept` is the `DEPT_CONFIG` entry (has `accent`, `barFill`). Male/Female and New/Renew use the dept accent plus a paired secondary color derived locally.

```jsx
import ReportCard from './ReportCard';
import GroupedBarChart from './GroupedBarChart';
import DonutChart from './DonutChart';
import RankedBarList from './RankedBarList';
import ExpiryPanel from './ExpiryPanel';

export default function SoloParentReports({ reports, dept }) {
  const primary = dept.barFill;     // e.g. #E11D48
  const secondary = '#64748B';      // slate — paired neutral for the 2nd series

  const { perCategory, perBarangay, perYear, sexSplit, spicExpiry } = reports;

  const yearData = perYear.map((r) => ({ ...r, label: String(r.year) }));
  const categoryData = perCategory.map((r) => ({ ...r, label: r.code }));

  return (
    <div className="mt-5 space-y-5 animate-fade-up">
      {/* Row 1: Per Year (wide) + Sex split (narrow) */}
      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <ReportCard title="Solo Parents per Year of Registration" subtitle="By SPIC issuance year · Male vs Female">
          {yearData.length === 0 ? (
            <EmptyBox text="No records with an issued SPIC date yet" />
          ) : (
            <GroupedBarChart
              data={yearData}
              xKey="label"
              series={[{ key: 'male', name: 'Male', color: primary }, { key: 'female', name: 'Female', color: secondary }]}
            />
          )}
        </ReportCard>

        <ReportCard title="Gender Distribution" subtitle="All registered solo parents">
          {sexSplit.total === 0 ? (
            <EmptyBox text="No records yet" />
          ) : (
            <DonutChart
              centerLabel="Solo Parents"
              data={[
                { name: 'Male', value: sexSplit.male, color: primary },
                { name: 'Female', value: sexSplit.female, color: secondary },
              ]}
            />
          )}
        </ReportCard>
      </div>

      {/* Row 2: Per Category (wide) + SPIC expiry (narrow) */}
      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <ReportCard title="Solo Parents per Category" subtitle="New vs Renewal · DILG MC 2023-140 codes">
          <GroupedBarChart
            data={categoryData}
            xKey="label"
            layout="vertical"
            height={420}
            barSize={9}
            series={[{ key: 'new', name: 'New', color: primary }, { key: 'renew', name: 'Renewal', color: secondary }]}
          />
        </ReportCard>

        <ReportCard title="SPIC Status" subtitle="ID validity · 1 year from issuance">
          <ExpiryPanel buckets={spicExpiry.buckets} soon={spicExpiry.soon} />
        </ReportCard>
      </div>

      {/* Row 3: Per Barangay (full width) */}
      <ReportCard title="Solo Parents per Barangay" subtitle="44 barangays · sorted by total · Male vs Female">
        {perBarangay.every((b) => b.total === 0) ? (
          <EmptyBox text="No records yet" />
        ) : (
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

Add the import at the top of `frontend/src/pages/admin/DashboardPage.jsx` (after the existing service import, line ~10):

```jsx
import SoloParentReports from '../../components/dashboard/SoloParentReports';
```

Then insert the section just before the final closing `</div>` of the returned JSX (after the chart + activity feed grid closes, around line 274):

```jsx
      {/* ── Department-specific reports ─────────────────────────────── */}
      {!isLoading && user?.department === 'SOLO_PARENT' && data?.reports && (
        <SoloParentReports reports={data.reports} dept={dept} />
      )}
```

- [ ] **Step 3: Run the app and verify visually**

Run backend: `cd backend && npm run dev`
Run frontend: `cd frontend && npm run dev`
Log in as a SOLO_PARENT admin and open the dashboard.
Expected:
- Existing banner, 4 stat cards, ID issuance chart, and activity feed still render.
- Below them: Per Year grouped bars + Gender donut; Per Category horizontal bars + SPIC Status panel; Per Barangay ranked list.
- Empty states show gracefully if a section has no data.
- Logging in as a PWD or SENIOR_CITIZEN admin shows NO report section (no errors).

- [ ] **Step 4: Verify the production build compiles**

Run: `cd frontend && npx vite build`
Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dashboard/SoloParentReports.jsx frontend/src/pages/admin/DashboardPage.jsx
git commit -m "feat(dashboard): render Solo Parent reports section"
```

---

## Final Verification

- [ ] Backend tests pass: `cd backend && npx jest tests/integration/dashboardReports.test.js --runInBand --forceExit`
- [ ] Full backend suite still passes: `cd backend && npm test`
- [ ] Frontend builds: `cd frontend && npx vite build`
- [ ] Manual: SOLO_PARENT admin dashboard shows all five report sections with live data; PWD/SC admins unaffected.

## Notes for the future (out of scope here)

- PWD and Senior Citizen reports reuse Tasks 3–7 primitives; add `buildPwdReports()` / `buildSeniorReports()` to `dashboardReports.js` and matching section components, then dispatch by `dept` in the controller.
- `secondary` series color is hardcoded slate in `SoloParentReports`; when PWD/SC arrive, consider moving the paired secondary color into `DEPT_CONFIG`.
