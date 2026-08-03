# Reports Tab — Framework + Per-Barangay Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> **Git note:** NOT a git repo — skip commits (treat as checkpoints).
> **Run backend cmds from `backend/`, frontend from `frontend/`. Backend tests run on Windows (existing sharp/canvas jest mocks) or WSL2.**

**Goal:** Build an extensible Reports framework (admin page + server-side Excel export) and the first report — Per-Barangay (Male/Female/Total) — shared across all 3 departments.

**Architecture:** A server-side report registry; each report's `build(dept)` returns a normalized `{ id, title, asOf, columns, rows, totals }` consumed by both a JSON preview endpoint and a generic `exceljs` exporter. Frontend adds an `/admin/reports` page with an on-screen preview table + "Export to Excel" button.

**Tech Stack:** Node + Express + Mongoose + exceljs (new); Jest + mongodb-memory-server; React 18 + Vite + Tailwind v4 + @tanstack/react-query + axios + lucide-react.

---

## Task 1: Extract `SEX_NORMALIZE` to shared `aggHelpers.js`

**Files:** NEW `backend/src/lib/aggHelpers.js`; MODIFY `backend/src/lib/dashboardReports.js`

- [ ] **Step 1: Create `backend/src/lib/aggHelpers.js`**
```js
'use strict';

// `sex` is a mixed enum ('Male'/'Female' and legacy 'M'/'F'). Normalize in aggregation pipelines.
const SEX_NORMALIZE = {
  $cond: [
    { $in: ['$sex', ['Male', 'M']] },
    'Male',
    { $cond: [{ $in: ['$sex', ['Female', 'F']] }, 'Female', 'Unknown'] },
  ],
};

module.exports = { SEX_NORMALIZE };
```

- [ ] **Step 2: Update `dashboardReports.js` to import it.** Read the file; near the top requires add:
```js
const { SEX_NORMALIZE } = require('./aggHelpers');
```
and DELETE the local `const SEX_NORMALIZE = { $cond: [...] };` block (the ~8 lines defining it, including its comment). Leave everything else unchanged.

- [ ] **Step 3: Verify no regression** — `npx jest tests/integration/dashboardReports.test.js --runInBand --forceExit`. Expected: all 17 pass (proves SEX_NORMALIZE still resolves and dashboards unaffected).

- [ ] **Step 4: Commit** — `git commit -am "refactor: extract SEX_NORMALIZE to aggHelpers"`

---

## Task 2: `buildPerBarangayReport(dept)` builder (TDD)

**Files:** NEW `backend/src/lib/reports/perBarangay.js`; NEW `backend/tests/integration/reports.test.js`

- [ ] **Step 1: Write the failing test** — create `backend/tests/integration/reports.test.js`:
```js
'use strict';

const db = require('../dbHelpers');
const Applicant = require('../../src/models/Applicant');
const { buildPerBarangayReport } = require('../../src/lib/reports/perBarangay');

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
      applicant({ barangay: 'Abagon', sex: 'F' }),     // normalizes to Female
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
    // alphabetical (canonical BARANGAYS order), NOT sorted by total
    expect(report.rows.map((r) => r.barangay)).toEqual([...report.rows].map((r) => r.barangay));
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
```

- [ ] **Step 2: Run to confirm failure** — `npx jest tests/integration/reports.test.js --runInBand --forceExit` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `backend/src/lib/reports/perBarangay.js`:
```js
'use strict';

const Applicant = require('../../models/Applicant');
const { BARANGAYS } = require('../constants');
const { SEX_NORMALIZE } = require('../aggHelpers');

const DEPT_NOUN = {
  SOLO_PARENT: 'Solo Parents',
  PWD: 'Persons with Disability',
  SENIOR_CITIZEN: 'Senior Citizens',
};

async function buildPerBarangayReport(dept) {
  const agg = await Applicant.aggregate([
    { $match: { department: dept, recordStatus: 'ACTIVE' } },
    { $addFields: { _sex: SEX_NORMALIZE } },
    { $group: { _id: { barangay: '$barangay', sex: '$_sex' }, count: { $sum: 1 } } },
  ]);

  const lookup = {};
  agg.forEach(({ _id, count }) => {
    if (!_id.barangay) return;
    lookup[_id.barangay] = lookup[_id.barangay] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[_id.barangay].male += count;
    else if (_id.sex === 'Female') lookup[_id.barangay].female += count;
  });

  let tMale = 0;
  let tFemale = 0;
  const rows = BARANGAYS.map((barangay, i) => {
    const v = lookup[barangay] || { male: 0, female: 0 };
    tMale += v.male;
    tFemale += v.female;
    return { no: i + 1, barangay, male: v.male, female: v.female, total: v.male + v.female };
  });

  return {
    id: 'per-barangay',
    title: `${DEPT_NOUN[dept]} per Barangay`,
    asOf: new Date().toISOString(),
    columns: [
      { key: 'no', label: 'No.', align: 'right' },
      { key: 'barangay', label: 'Barangay' },
      { key: 'male', label: 'Male', align: 'right' },
      { key: 'female', label: 'Female', align: 'right' },
      { key: 'total', label: 'Total', align: 'right' },
    ],
    rows,
    totals: { male: tMale, female: tFemale, total: tMale + tFemale },
  };
}

module.exports = { buildPerBarangayReport, DEPT_NOUN };
```

- [ ] **Step 4: Run to confirm pass** — `npx jest tests/integration/reports.test.js --runInBand --forceExit` → 3 pass.
- [ ] **Step 5: Commit** — `git commit -am "feat(reports): per-barangay report builder"`

---

## Task 3: Excel exporter `tableToWorkbook` + exceljs dependency (TDD)

**Files:** MODIFY `backend/package.json` (add exceljs); NEW `backend/src/lib/reports/excel.js`; MODIFY `backend/tests/integration/reports.test.js`

- [ ] **Step 1: Install exceljs** — from `backend/`: `npm install exceljs`. Confirm it appears in `package.json` dependencies.

- [ ] **Step 2: Write the failing test** — append to `reports.test.js`:
```js
const { tableToWorkbook } = require('../../src/lib/reports/excel');

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
    // header row = row 4
    expect(ws.getRow(4).getCell(1).value).toBe('No.');
    expect(ws.getRow(4).getCell(2).value).toBe('Barangay');
    // first data row = row 5
    expect(ws.getRow(5).getCell(2).value).toBe('Abagon');
    expect(ws.getRow(5).getCell(5).value).toBe(5);
    // TOTAL row = row 5 + rows.length = 7
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
```

- [ ] **Step 3: Run to confirm failure** — `npx jest tests/integration/reports.test.js -t tableToWorkbook --runInBand --forceExit` → FAIL (module not found).

- [ ] **Step 4: Implement** — create `backend/src/lib/reports/excel.js`:
```js
'use strict';

const ExcelJS = require('exceljs');

const THIN = { style: 'thin' };
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

function formatAsOf(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

function tableToWorkbook({ title, asOf, columns, rows, totals }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');
  const lastCol = String.fromCharCode(64 + columns.length); // supports up to 26 columns

  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };

  ws.mergeCells(`A2:${lastCol}2`);
  const asOfCell = ws.getCell('A2');
  asOfCell.value = `As of ${formatAsOf(asOf)}`;
  asOfCell.font = { italic: true, size: 10 };
  asOfCell.alignment = { horizontal: 'center' };

  const alignOf = (c) => ({ horizontal: c.align === 'right' ? 'right' : 'left' });

  const header = ws.getRow(4);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true };
    cell.alignment = alignOf(c);
    cell.border = BORDER;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F1F1' } };
  });

  rows.forEach((r, ri) => {
    const row = ws.getRow(5 + ri);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = r[c.key];
      cell.alignment = alignOf(c);
      cell.border = BORDER;
    });
  });

  if (totals) {
    const labelIdx = Math.max(0, columns.findIndex((c) => c.key === 'barangay'));
    const trow = ws.getRow(5 + rows.length);
    columns.forEach((c, i) => {
      const cell = trow.getCell(i + 1);
      if (c.key in totals) cell.value = totals[c.key];
      else if (i === labelIdx) cell.value = 'TOTAL';
      cell.font = { bold: true };
      cell.alignment = alignOf(c);
      cell.border = BORDER;
    });
  }

  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.key === 'barangay' ? 24 : 10;
  });

  return wb;
}

module.exports = { tableToWorkbook };
```

- [ ] **Step 5: Run to confirm pass** — `npx jest tests/integration/reports.test.js --runInBand --forceExit` → all pass.
- [ ] **Step 6: Commit** — `git commit -am "feat(reports): exceljs table exporter"`

---

## Task 4: Registry + controller + route + endpoint tests (TDD)

**Files:** NEW `backend/src/lib/reports/index.js`, `backend/src/controllers/reportsController.js`, `backend/src/routes/reports.js`; MODIFY `backend/src/app.js`; MODIFY `backend/tests/integration/reports.test.js`

- [ ] **Step 1: Write failing endpoint tests** — append to `reports.test.js`:
```js
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
```

- [ ] **Step 2: Run to confirm failure** — `npx jest tests/integration/reports.test.js -t "Reports API" --runInBand --forceExit` → FAIL (404/route missing).

- [ ] **Step 3: Implement registry** — create `backend/src/lib/reports/index.js`:
```js
'use strict';

const { buildPerBarangayReport, DEPT_NOUN } = require('./perBarangay');

const REPORTS = {
  'per-barangay': {
    departments: ['SOLO_PARENT', 'PWD', 'SENIOR_CITIZEN'],
    title: (dept) => `${DEPT_NOUN[dept]} per Barangay`,
    build: (dept) => buildPerBarangayReport(dept),
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
```

- [ ] **Step 4: Implement controller** — create `backend/src/controllers/reportsController.js`:
```js
'use strict';

const { listReportsForDept, isAvailable, getReport } = require('../lib/reports');
const { tableToWorkbook } = require('../lib/reports/excel');

function listReports(req, res, next) {
  try {
    res.json({ reports: listReportsForDept(req.user.department) });
  } catch (err) { next(err); }
}

async function getReportData(req, res, next) {
  try {
    const dept = req.user.department;
    if (!isAvailable(req.params.id, dept)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not available' } });
    }
    res.json(await getReport(req.params.id, dept));
  } catch (err) { next(err); }
}

async function exportReport(req, res, next) {
  try {
    const dept = req.user.department;
    const { id } = req.params;
    if (!isAvailable(id, dept)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not available' } });
    }
    const data = await getReport(id, dept);
    const wb = tableToWorkbook(data);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${id}-${dept}-${date}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
}

module.exports = { listReports, getReportData, exportReport };
```

- [ ] **Step 5: Implement route** — create `backend/src/routes/reports.js`:
```js
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { listReports, getReportData, exportReport } = require('../controllers/reportsController');

router.get('/',           authenticate, requireRole('ADMIN'), listReports);
router.get('/:id',        authenticate, requireRole('ADMIN'), getReportData);
router.get('/:id/export', authenticate, requireRole('ADMIN'), exportReport);

module.exports = router;
```

- [ ] **Step 6: Mount in `app.js`** — after the dashboard mount line, add:
```js
app.use('/api/reports',     require('./routes/reports'));      // Reports tab
```

- [ ] **Step 7: Run full file** — `npx jest tests/integration/reports.test.js --runInBand --forceExit` → all pass.
- [ ] **Step 8: Commit** — `git commit -am "feat(reports): registry, controller, route"`

---

## Task 5: Frontend service + `ReportTable` component

**Files:** NEW `frontend/src/services/reportsService.js`, `frontend/src/components/reports/ReportTable.jsx`

- [ ] **Step 1: Create `frontend/src/services/reportsService.js`**
```js
import api from './api';

export const reportsService = {
  listReports: () => api.get('/reports').then((r) => r.data.reports),
  getReport: (id) => api.get(`/reports/${id}`).then((r) => r.data),
  downloadReport: async (id) => {
    const res = await api.get(`/reports/${id}/export`, { responseType: 'blob' });
    const cd = res.headers['content-disposition'] || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `${id}.xlsx`;
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};
```
(Confirm `frontend/src/services/api.js` exports a default axios instance — `dashboardService.js` imports it the same way.)

- [ ] **Step 2: Create `frontend/src/components/reports/ReportTable.jsx`**
```jsx
export default function ReportTable({ columns, rows, totals }) {
  const alignCls = (c) => (c.align === 'right' ? 'text-right' : 'text-left');
  return (
    <div className="overflow-x-auto rounded-xl bg-white" style={{ boxShadow: 'var(--shadow-card)' }}>
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-4 py-2.5 font-semibold ${alignCls(c)}`}
                style={{ color: 'var(--color-text-1)', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-2 ${alignCls(c)}`}
                  style={{ color: 'var(--color-text-1)', borderBottom: '1px solid var(--color-border)' }}
                >
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              {columns.map((c, i) => {
                const isLabel = i === Math.max(0, columns.findIndex((x) => x.key === 'barangay'));
                const val = c.key in totals ? totals[c.key] : (isLabel ? 'TOTAL' : '');
                return (
                  <td
                    key={c.key}
                    className={`px-4 py-2.5 font-semibold ${alignCls(c)}`}
                    style={{ color: 'var(--color-text-1)', background: 'var(--color-surface)', borderTop: '2px solid var(--color-border)' }}
                  >
                    {val}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Verify build** — `cd frontend && npx vite build`. Expected: success.
- [ ] **Step 4: Commit** — `git add -A frontend/src && git commit -m "feat(reports): service + ReportTable"`

---

## Task 6: `ReportsPage` + route + nav (and final verification)

**Files:** NEW `frontend/src/pages/admin/ReportsPage.jsx`; MODIFY `frontend/src/App.jsx`, `frontend/src/components/layout/Sidebar.jsx`, `frontend/src/components/layout/TopBar.jsx`

- [ ] **Step 1: Create `frontend/src/pages/admin/ReportsPage.jsx`**
```jsx
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet } from 'lucide-react';
import { reportsService } from '../../services/reportsService';
import ReportTable from '../../components/reports/ReportTable';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function ReportsPage() {
  const { data: reports } = useQuery({ queryKey: ['reports-list'], queryFn: reportsService.listReports });
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (reports?.length && !selectedId) setSelectedId(reports[0].id);
  }, [reports, selectedId]);

  const { data: report, isLoading } = useQuery({
    queryKey: ['report', selectedId],
    queryFn: () => reportsService.getReport(selectedId),
    enabled: Boolean(selectedId),
  });

  const [downloading, setDownloading] = useState(false);
  const handleExport = async () => {
    if (!selectedId) return;
    setDownloading(true);
    try { await reportsService.downloadReport(selectedId); }
    finally { setDownloading(false); }
  };

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-2xl" style={{ color: 'var(--color-text-1)' }}>Reports</h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Official statistical reports · export to Excel</p>
        </div>
        <button
          onClick={handleExport}
          disabled={!report || downloading}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          style={{ background: 'var(--color-text-1)' }}
        >
          <Download className="w-4 h-4" />
          {downloading ? 'Exporting…' : 'Export to Excel'}
        </button>
      </div>

      {reports?.length > 1 && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              style={selectedId === r.id
                ? { background: 'var(--color-text-1)', color: '#fff' }
                : { background: 'var(--color-surface)', color: 'var(--color-muted)' }}
            >
              {r.title}
            </button>
          ))}
        </div>
      )}

      {isLoading || !report ? (
        <div className="rounded-xl bg-white p-10 text-center" style={{ boxShadow: 'var(--shadow-card)' }}>
          <FileSpreadsheet className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--color-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading report…</p>
        </div>
      ) : (
        <>
          <div className="mb-3">
            <h2 className="font-serif text-lg" style={{ color: 'var(--color-text-1)' }}>{report.title}</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>As of {formatDate(report.asOf)}</p>
          </div>
          <ReportTable columns={report.columns} rows={report.rows} totals={report.totals} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the route in `frontend/src/App.jsx`** — add an import with the other admin page imports:
```jsx
import ReportsPage          from './pages/admin/ReportsPage';
```
and add a route inside the admin `<Routes>` block (next to the `dashboard` route):
```jsx
                  <Route path="reports"    element={<ReportsPage />} />
```

- [ ] **Step 3: Add the nav item in `frontend/src/components/layout/Sidebar.jsx`** — READ the file. It imports lucide icons at top and has an admin nav config with a "Management" group `{ label: 'Management', items: [...] }`. Add `FileBarChart` to the lucide import line, and add this item to the admin Management `items` array (after 'ID Templates'):
```jsx
      { icon: FileBarChart, label: 'Reports', path: '/admin/reports' },
```

- [ ] **Step 4: Add the same nav item in `frontend/src/components/layout/TopBar.jsx`** — READ the file. Add `FileBarChart` to its lucide import and add to the admin nav array:
```jsx
    { icon: FileBarChart, label: 'Reports', path: '/admin/reports' },
```

- [ ] **Step 5: Verify build** — `cd frontend && npx vite build`. Expected: success (chunk-size advisory is fine).

- [ ] **Step 6: Full backend reports suite** — `cd backend && npx jest tests/integration/reports.test.js --runInBand --forceExit` → all pass.

- [ ] **Step 7: Commit** — `git add -A frontend/src && git commit -m "feat(reports): ReportsPage + route + nav"`

---

## Final Verification
- [ ] `cd backend && npx jest tests/integration/reports.test.js --runInBand --forceExit` — all green.
- [ ] `cd backend && npx jest tests/integration/dashboardReports.test.js --runInBand --forceExit` — still green (SEX_NORMALIZE refactor safe).
- [ ] `cd frontend && npx vite build` — clean.
- [ ] Manual: log in as an admin → "Reports" in sidebar → preview table renders (44 barangays, alphabetical, TOTAL row) → "Export to Excel" downloads a formatted `.xlsx`.

## Notes
- Adding the next report later = one entry in `REPORTS` with a `build(dept)` returning the normalized structure; flat reports reuse `tableToWorkbook` and `ReportTable` for free.
- Cross-tab reports (PWD Disability/AGE, SC Pension Data) will need grouped column headers — a future extension of the structure + exporter.
