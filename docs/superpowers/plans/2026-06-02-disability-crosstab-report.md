# PWD Disability-per-Barangay Cross-Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> **Git note:** NOT a git repo — skip commits. Run backend cmds from `backend/`, frontend from `frontend/`.

**Goal:** Add the PWD "Type of Disability per Barangay" cross-tab report (grouped column headers), reusing the Reports framework. Establishes the grouped-header machinery (Excel exporter + ReportTable) that future cross-tabs reuse.

**Architecture:** Extend the normalized report structure with an optional `columnGroups` (alternative to flat `columns`). A `flattenColumns(structure)` helper feeds data/total iteration; header rendering branches on `columnGroups`. New PWD-only registry entry. Generic endpoints already serve it.

**Tech Stack:** Node + Express + Mongoose + exceljs; Jest; React + recharts-free table + react-query.

**Reference:** builds on `2026-06-02-reports-tab-framework.md`. Existing: `lib/reports/{perBarangay,excel,index}.js`, `components/reports/ReportTable.jsx`, `aggHelpers.js` (SEX_NORMALIZE), `tests/integration/reports.test.js`.

---

## Task DX1: Backend — builder + grouped Excel + registry (TDD)

**Files:** NEW `backend/src/lib/reports/disabilityByBarangay.js`; MODIFY `backend/src/lib/reports/excel.js`, `backend/src/lib/reports/index.js`, `backend/tests/integration/reports.test.js`

- [ ] **Step 1: Write failing builder tests** — append to `reports.test.js`:
```js
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
    // Visual Disability is index 7 (d7); Deaf is index 0 (d0)
    expect(abagon).toMatchObject({ d7_m: 1, d7_f: 1, d7_t: 2, d0_m: 0, d0_f: 1, d0_t: 1 });
    // per-barangay grand total: 2 visual + 1 deaf = 3 (M:1, F:2)
    expect(abagon).toMatchObject({ all_m: 1, all_f: 2, all_t: 3 });

    const luna = report.rows.find((r) => r.barangay === 'Luna');
    expect(luna).toMatchObject({ d0_m: 1, d0_f: 0, d0_t: 1, all_m: 1, all_f: 0, all_t: 1 });

    // grand totals across all barangays
    expect(report.totals).toMatchObject({ d7_m: 1, d7_f: 1, d0_m: 1, d0_f: 1, all_m: 2, all_f: 2, all_t: 4 });
  });

  test('columnGroups: leading + 10 disability + Total (PWD) groups', async () => {
    const report = await buildDisabilityByBarangayReport();
    expect(report.columns).toBeUndefined();
    expect(report.columnGroups).toHaveLength(12); // 1 leading + 10 + 1 total
    expect(report.columnGroups[0].label).toBeNull();
    expect(report.columnGroups[0].columns.map((c) => c.key)).toEqual(['no', 'barangay']);
    expect(report.columnGroups[1].label).toBe('Deaf or Hard of Hearing'); // stripped "1. "
    expect(report.columnGroups[8].label).toBe('Visual Disability');
    expect(report.columnGroups[11].label).toBe('Total (PWD)');
    expect(report.columnGroups[11].columns.map((c) => c.key)).toEqual(['all_m', 'all_f', 'all_t']);
  });
});
```

- [ ] **Step 2: Run to confirm failure** — `npx jest tests/integration/reports.test.js -t buildDisabilityByBarangayReport --runInBand --forceExit` → FAIL.

- [ ] **Step 3: Implement the builder** — create `backend/src/lib/reports/disabilityByBarangay.js`:
```js
'use strict';

const Applicant = require('../../models/Applicant');
const { BARANGAYS, PWD_DISABILITY_TYPES } = require('../constants');
const { SEX_NORMALIZE } = require('../aggHelpers');

const stripNumPrefix = (s) => (s || '').replace(/^\d+\.\s*/, '');

async function buildDisabilityByBarangayReport() {
  const agg = await Applicant.aggregate([
    { $match: { department: 'PWD', recordStatus: 'ACTIVE' } },
    { $addFields: { _sex: SEX_NORMALIZE } },
    { $group: { _id: { barangay: '$barangay', type: '$pwd.disabilityType', sex: '$_sex' }, count: { $sum: 1 } } },
  ]);

  const typeIndex = {};
  PWD_DISABILITY_TYPES.forEach((t, i) => { typeIndex[t] = i; });

  const lookup = {};
  agg.forEach(({ _id, count }) => {
    if (!_id.barangay || typeIndex[_id.type] === undefined) return;
    const b = _id.barangay;
    const di = typeIndex[_id.type];
    lookup[b] = lookup[b] || {};
    lookup[b][di] = lookup[b][di] || { male: 0, female: 0 };
    if (_id.sex === 'Male') lookup[b][di].male += count;
    else if (_id.sex === 'Female') lookup[b][di].female += count;
  });

  const totals = {};
  PWD_DISABILITY_TYPES.forEach((t, i) => { totals[`d${i}_m`] = 0; totals[`d${i}_f`] = 0; totals[`d${i}_t`] = 0; });
  totals.all_m = 0; totals.all_f = 0; totals.all_t = 0;

  const rows = BARANGAYS.map((barangay, bi) => {
    const row = { no: bi + 1, barangay };
    let aM = 0;
    let aF = 0;
    PWD_DISABILITY_TYPES.forEach((t, i) => {
      const v = (lookup[barangay] && lookup[barangay][i]) || { male: 0, female: 0 };
      row[`d${i}_m`] = v.male;
      row[`d${i}_f`] = v.female;
      row[`d${i}_t`] = v.male + v.female;
      aM += v.male;
      aF += v.female;
      totals[`d${i}_m`] += v.male;
      totals[`d${i}_f`] += v.female;
      totals[`d${i}_t`] += v.male + v.female;
    });
    row.all_m = aM;
    row.all_f = aF;
    row.all_t = aM + aF;
    totals.all_m += aM;
    totals.all_f += aF;
    totals.all_t += aM + aF;
    return row;
  });

  const columnGroups = [
    {
      label: null,
      columns: [
        { key: 'no', label: 'No.', align: 'right' },
        { key: 'barangay', label: 'Barangay' },
      ],
    },
    ...PWD_DISABILITY_TYPES.map((t, i) => ({
      label: stripNumPrefix(t),
      columns: [
        { key: `d${i}_m`, label: 'M', align: 'right' },
        { key: `d${i}_f`, label: 'F', align: 'right' },
        { key: `d${i}_t`, label: 'Total', align: 'right' },
      ],
    })),
    {
      label: 'Total (PWD)',
      columns: [
        { key: 'all_m', label: 'M', align: 'right' },
        { key: 'all_f', label: 'F', align: 'right' },
        { key: 'all_t', label: 'Total', align: 'right' },
      ],
    },
  ];

  return {
    id: 'disability-by-barangay',
    title: 'Type of Disability per Barangay',
    asOf: new Date().toISOString(),
    columnGroups,
    rows,
    totals,
  };
}

module.exports = { buildDisabilityByBarangayReport };
```

- [ ] **Step 4: Run builder tests** — `npx jest tests/integration/reports.test.js -t buildDisabilityByBarangayReport --runInBand --forceExit` → 2 pass.

- [ ] **Step 5: Write failing grouped-Excel test** — append to `reports.test.js` inside the existing `tableToWorkbook` describe (or a new one):
```js
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
    // group header row 4: col 3 = 'Deaf or Hard of Hearing'
    expect(ws.getRow(4).getCell(3).value).toBe('Deaf or Hard of Hearing');
    // sub header row 5: cols 3,4,5 = M,F,Total
    expect(ws.getRow(5).getCell(3).value).toBe('M');
    expect(ws.getRow(5).getCell(5).value).toBe('Total');
    // leading No./Barangay appear in row 4 (vertically merged), col 1 & 2
    expect(ws.getRow(4).getCell(1).value).toBe('No.');
    expect(ws.getRow(4).getCell(2).value).toBe('Barangay');
    // data row 6
    expect(ws.getRow(6).getCell(2).value).toBe('Abagon');
    expect(ws.getRow(6).getCell(5).value).toBe(7);
    // TOTAL row 7
    expect(ws.getRow(7).getCell(2).value).toBe('TOTAL');
    expect(ws.getRow(7).getCell(8).value).toBe(7); // all_t column (col 8)
  });
});
```

- [ ] **Step 6: Run to confirm failure** — fails (grouped path not implemented).

- [ ] **Step 7: Extend `excel.js`** — replace the body of `tableToWorkbook` to handle both flat and grouped. New full file `backend/src/lib/reports/excel.js`:
```js
'use strict';

const ExcelJS = require('exceljs');

const THIN = { style: 'thin' };
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

function formatAsOf(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

function flattenColumns(structure) {
  return structure.columns || structure.columnGroups.flatMap((g) => g.columns);
}

const alignOf = (c) => ({ horizontal: c && c.align === 'right' ? 'right' : 'left' });

function styleHeaderCell(cell, align) {
  cell.font = { bold: true };
  cell.alignment = { horizontal: align, vertical: 'middle' };
  cell.border = BORDER;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F1F1' } };
}

function tableToWorkbook(structure) {
  const { title, asOf, rows, totals, columnGroups } = structure;
  const columns = flattenColumns(structure);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');

  ws.mergeCells(1, 1, 1, columns.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };

  ws.mergeCells(2, 1, 2, columns.length);
  const asOfCell = ws.getCell(2, 1);
  asOfCell.value = `As of ${formatAsOf(asOf)}`;
  asOfCell.font = { italic: true, size: 10 };
  asOfCell.alignment = { horizontal: 'center' };

  let dataStartRow;
  if (columnGroups) {
    let col = 1;
    columnGroups.forEach((g) => {
      const span = g.columns.length;
      if (g.label == null) {
        g.columns.forEach((c) => {
          ws.mergeCells(4, col, 5, col);
          const cell = ws.getCell(4, col);
          cell.value = c.label;
          styleHeaderCell(cell, alignOf(c).horizontal);
          col += 1;
        });
      } else {
        ws.mergeCells(4, col, 4, col + span - 1);
        const gcell = ws.getCell(4, col);
        gcell.value = g.label;
        styleHeaderCell(gcell, 'center');
        g.columns.forEach((c, j) => {
          const sub = ws.getCell(5, col + j);
          sub.value = c.label;
          styleHeaderCell(sub, alignOf(c).horizontal);
        });
        col += span;
      }
    });
    dataStartRow = 6;
  } else {
    const header = ws.getRow(4);
    columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.label;
      styleHeaderCell(cell, alignOf(c).horizontal);
    });
    dataStartRow = 5;
  }

  rows.forEach((r, ri) => {
    const row = ws.getRow(dataStartRow + ri);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = r[c.key];
      cell.alignment = alignOf(c);
      cell.border = BORDER;
    });
  });

  if (totals) {
    const labelIdx = Math.max(0, columns.findIndex((c) => c.key === 'barangay'));
    const trow = ws.getRow(dataStartRow + rows.length);
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
    ws.getColumn(i + 1).width = c.key === 'barangay' ? 24 : 8;
  });

  return wb;
}

module.exports = { tableToWorkbook, flattenColumns };
```

- [ ] **Step 8: Register the report** — in `backend/src/lib/reports/index.js`, add the require and a registry entry. Add to requires:
```js
const { buildDisabilityByBarangayReport } = require('./disabilityByBarangay');
```
Add to the `REPORTS` object (after `'per-barangay'`):
```js
  'disability-by-barangay': {
    departments: ['PWD'],
    title: () => 'Type of Disability per Barangay',
    build: () => buildDisabilityByBarangayReport(),
  },
```

- [ ] **Step 9: Write failing endpoint test** — append to `reports.test.js`:
```js
describe('Reports API — disability cross-tab', () => {
  async function adminToken(dept, username) {
    await createTestUser({ username, role: 'ADMIN', department: dept });
    return getToken(app, username);
  }

  test('PWD admin lists BOTH reports', async () => {
    const token = await adminToken('PWD', 'rep_pwd_x');
    const res = await supertest(app).get('/api/reports').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.reports.map((r) => r.id);
    expect(ids).toContain('per-barangay');
    expect(ids).toContain('disability-by-barangay');
  });

  test('GET disability-by-barangay returns columnGroups + export works', async () => {
    const token = await adminToken('PWD', 'rep_pwd_y');
    const res = await supertest(app).get('/api/reports/disability-by-barangay').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.columnGroups).toHaveLength(12);
    expect(res.body.rows).toHaveLength(44);

    const exp = await supertest(app).get('/api/reports/disability-by-barangay/export').set('Authorization', `Bearer ${token}`);
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('spreadsheetml');
  });

  test('SOLO_PARENT admin does NOT get disability-by-barangay', async () => {
    const token = await adminToken('SOLO_PARENT', 'rep_sp_x');
    const res = await supertest(app).get('/api/reports/disability-by-barangay').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 10: Run the whole file** — `npx jest tests/integration/reports.test.js --runInBand --forceExit` → ALL pass (existing + new builder + grouped-excel + endpoint). Also run `npx jest tests/integration/dashboardReports.test.js --runInBand --forceExit` → still green.

- [ ] **Step 11: Commit** — `git commit -am "feat(reports): PWD disability-by-barangay cross-tab + grouped Excel"`

---

## Task DX2: Frontend — grouped headers in `ReportTable`

**Files:** MODIFY `frontend/src/components/reports/ReportTable.jsx`

- [ ] **Step 1: Replace `ReportTable.jsx`** with a version that supports both flat `columns` and grouped `columnGroups`:
```jsx
export default function ReportTable({ columns, columnGroups, rows, totals }) {
  const flatCols = columns || (columnGroups ? columnGroups.flatMap((g) => g.columns) : []);
  const alignCls = (c) => (c.align === 'right' ? 'text-right' : 'text-left');
  const labelIdx = Math.max(0, flatCols.findIndex((x) => x.key === 'barangay'));

  const thBase = 'px-3 py-2 font-semibold whitespace-nowrap';
  const thStyle = { color: 'var(--color-text-1)', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' };

  return (
    <div className="overflow-x-auto rounded-xl bg-white" style={{ boxShadow: 'var(--shadow-card)' }}>
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          {columnGroups ? (
            <>
              <tr>
                {columnGroups.map((g, gi) =>
                  g.label == null
                    ? g.columns.map((c) => (
                        <th key={c.key} rowSpan={2} className={`${thBase} ${alignCls(c)}`} style={thStyle}>{c.label}</th>
                      ))
                    : (
                        <th key={`g${gi}`} colSpan={g.columns.length} className={`${thBase} text-center`} style={{ ...thStyle, borderLeft: '1px solid var(--color-border)' }}>
                          {g.label}
                        </th>
                      )
                )}
              </tr>
              <tr>
                {columnGroups.filter((g) => g.label != null).flatMap((g) =>
                  g.columns.map((c) => (
                    <th key={c.key} className={`${thBase} ${alignCls(c)}`} style={thStyle}>{c.label}</th>
                  ))
                )}
              </tr>
            </>
          ) : (
            <tr>
              {flatCols.map((c) => (
                <th key={c.key} className={`${thBase} ${alignCls(c)}`} style={thStyle}>{c.label}</th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {flatCols.map((c) => (
                <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${alignCls(c)}`} style={{ color: 'var(--color-text-1)', borderBottom: '1px solid var(--color-border)' }}>
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              {flatCols.map((c, i) => {
                const val = c.key in totals ? totals[c.key] : (i === labelIdx ? 'TOTAL' : '');
                return (
                  <td key={c.key} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${alignCls(c)}`} style={{ color: 'var(--color-text-1)', background: 'var(--color-surface)', borderTop: '2px solid var(--color-border)' }}>
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

- [ ] **Step 2: Confirm `ReportsPage` passes `columnGroups`** — READ `frontend/src/pages/admin/ReportsPage.jsx`. It currently renders `<ReportTable columns={report.columns} rows={report.rows} totals={report.totals} />`. Change that line to also pass groups:
```jsx
<ReportTable columns={report.columns} columnGroups={report.columnGroups} rows={report.rows} totals={report.totals} />
```

- [ ] **Step 3: Verify build** — `cd frontend && npx vite build` → success.
- [ ] **Step 4: Commit** — `git add -A frontend/src && git commit -m "feat(reports): grouped headers in ReportTable"`

---

## Final Verification
- [ ] `cd backend && npx jest tests/integration/reports.test.js tests/integration/dashboardReports.test.js --runInBand --forceExit` — all green.
- [ ] `cd frontend && npx vite build` — clean.
- [ ] Manual: PWD admin → Reports → report selector shows two reports → select "Type of Disability per Barangay" → grouped two-row header table renders (10 disability groups × M/F/Total + Total (PWD)) → Export downloads a valid grouped .xlsx (open it: group header row, sub-row, 44 data rows, TOTAL row).

## Notes
- `flattenColumns` + `columnGroups` now power any grouped cross-tab; AGE SEGGREGATION and SC Pension Data become new registry entries reusing this exporter + table.
- Column width 8 for numeric cross-tab columns keeps the wide sheet compact; `overflow-x-auto` handles on-screen width.
