# Reports Tab — Framework + First Report (Per-Barangay) — Design

**Date:** 2026-06-02
**Author:** Cedrick (via Claude Code)
**Status:** Approved (design phase) — pending spec review

## Problem

The MSWDO offices must submit official statistical reports that today live as formatted tabs in
their Excel workbooks (e.g. PWD "SEX SEG"/"Disability"/"AGE SEGGREGATION"/"SUMMARY", SC
"Pension Data"/"Senior Data", Solo Parent per-category/barangay/year). The dashboards we built
are an **overview**; these are the **detailed, exportable deliverables**.

This project builds the **Reports framework** (an extensible page + Excel-export pipeline) and the
**first report: Per-Barangay (Male/Female/Total)**, which is shared across all three departments.
Once the framework is proven, the remaining (more complex, cross-tab) reports are added as
incremental registry entries — each its own future spec/plan.

## Decisions (locked during brainstorming)

| Decision | Choice |
| --- | --- |
| Decomposition | Framework + ONE report first (Per-Barangay M/F) |
| Export format | Excel `.xlsx`, generated server-side (`exceljs`) |
| Page shape | On-screen preview table + "Export to Excel" button |
| "As of" | Live snapshot = now (date-range filtering is future) |
| Scope | Admin-only, department-scoped (reuses existing auth pattern) |

## Architecture — extensible report registry

A report is defined once, server-side, and produces a **normalized table structure** consumed by
both the JSON preview and the Excel exporter:

```js
{
  id: 'per-barangay',
  title: 'Persons with Disability per Barangay',   // dept-aware
  asOf: '2026-06-02T...Z',                          // ISO; formatted in UI/Excel
  columns: [{ key, label, align? }],
  rows:    [{ ...keyed by column.key }],
  totals:  { ...keyed by numeric column.key },      // null/absent = no totals row
}
```

Adding a future report = adding one registry entry with a `build(dept)` function returning this
shape. Flat reports reuse the generic Excel exporter; complex cross-tabs (grouped headers) will
extend the structure later (out of scope now — YAGNI).

## Backend

### New files
- `src/lib/aggHelpers.js` — extract the existing `SEX_NORMALIZE` aggregation expression here
  (shared by dashboards and reports; prevents normalization drift). `dashboardReports.js` is
  updated to import it instead of defining it locally. *(Small, justified refactor — adding a
  second consumer.)*
- `src/lib/reports/perBarangay.js` — `buildPerBarangayReport(dept)`:
  aggregates `{ barangay, _sex }` over `{ department: dept, recordStatus: 'ACTIVE' }` with
  `SEX_NORMALIZE`; emits rows in **canonical `BARANGAYS` alphabetical order** with a sequential
  `no` (1–44), zero-filled, plus `totals`. (Note: official layout is alphabetical with a No.
  column — deliberately NOT sorted by total like the dashboard.) Title = `${DEPT_NOUN[dept]} per
  Barangay` where `DEPT_NOUN = { SOLO_PARENT:'Solo Parents', PWD:'Persons with Disability',
  SENIOR_CITIZEN:'Senior Citizens' }`. Columns: No. / Barangay / Male / Female / Total.
- `src/lib/reports/excel.js` — `tableToWorkbook({ title, asOf, columns, rows, totals })` returns an
  `exceljs.Workbook`: merged title row, "As of <date>" row, bold header row, data rows, bold
  TOTAL row (when `totals` present), sensible column widths, thin borders.
- `src/lib/reports/index.js` — the registry: `REPORTS = { 'per-barangay': { departments:[3],
  title(dept), build(dept) } }`; helpers `listReportsForDept(dept)` → `[{ id, title }]`,
  `getReport(id, dept)` → normalized structure, `getReportWorkbook(id, dept)` → exceljs Workbook.
- `src/controllers/reportsController.js` — `listReports`, `getReport`, `exportReport` (sets
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and
  `Content-Disposition: attachment; filename="<id>-<dept>-<YYYY-MM-DD>.xlsx"`, streams the workbook
  buffer). Each validates that the requested `id` is available for `req.user.department` (404 if
  not).
- `src/routes/reports.js`:
  ```js
  router.get('/',            authenticate, requireRole('ADMIN'), listReports);
  router.get('/:id',         authenticate, requireRole('ADMIN'), getReport);
  router.get('/:id/export',  authenticate, requireRole('ADMIN'), exportReport);
  ```
  Mounted in `app.js`: `app.use('/api/reports', require('./routes/reports'));`

### New dependency
- `exceljs` (added to `backend/package.json`). Pure JS — works in Jest with no native bindings.

## Frontend

### New files
- `src/services/reportsService.js` — `listReports()`, `getReport(id)`, and
  `downloadReport(id)` which fetches the export endpoint as a **blob with the auth header**
  (via the existing `api` axios instance, `responseType: 'blob'`) and triggers a browser download
  (a plain `<a href>` can't carry the Bearer token).
- `src/components/reports/ReportTable.jsx` — renders `{ columns, rows, totals }`: header row,
  data rows, and a bold TOTAL row when `totals` present. Right-aligns numeric columns. Matches the
  existing table styling (white card, `--color-border`, `--shadow-card`).
- `src/pages/admin/ReportsPage.jsx` — on mount, `listReports()` → a report selector (dropdown or
  segmented control; only one option for now, designed for many). On selection, `getReport(id)` →
  renders title + "As of <date>" + `ReportTable` + an **"Export to Excel"** button calling
  `downloadReport(id)`. Loading + empty states consistent with the dashboard.

### Integration
- `src/App.jsx` — add `<Route path="reports" element={<ReportsPage />} />` under `/admin/*`.
- `src/components/layout/Sidebar.jsx` — add `{ icon: FileBarChart, label: 'Reports', path:
  '/admin/reports' }` to the admin "Management" group.
- `src/components/layout/TopBar.jsx` — add the same item to the admin nav array (mobile parity).

## Testing

- **Backend (TDD):**
  - `buildPerBarangayReport` — 44 rows in alphabetical order, sequential `no` 1–44, zero-fill,
    correct `totals`, dept-aware title; sex normalization (M/Male, F/Female).
  - `tableToWorkbook` — read the workbook back with exceljs: assert title cell, "As of" row,
    header labels, a known data row, and the TOTAL row values.
  - Endpoints — `GET /api/reports` lists `per-barangay` for an admin; `GET /api/reports/per-barangay`
    returns the structure; `GET /api/reports/per-barangay/export` returns 200 with the xlsx
    Content-Type and a non-empty body; unknown id → 404.
- **Frontend:** manual visual verification (log in as an admin, open Reports, preview + export) +
  `vite build`.

## Files summary

**Backend:** NEW `src/lib/aggHelpers.js`, `src/lib/reports/{perBarangay,excel,index}.js`,
`src/controllers/reportsController.js`, `src/routes/reports.js`, tests
`tests/integration/reports.test.js`; MODIFY `src/app.js` (mount route), `src/lib/dashboardReports.js`
(import SEX_NORMALIZE from aggHelpers), `package.json` (exceljs).

**Frontend:** NEW `src/services/reportsService.js`, `src/components/reports/ReportTable.jsx`,
`src/pages/admin/ReportsPage.jsx`; MODIFY `src/App.jsx`, `src/components/layout/Sidebar.jsx`,
`src/components/layout/TopBar.jsx`.

## Out of scope (future registry entries / specs)

- Complex cross-tab reports: PWD Disability-per-barangay, PWD AGE SEGGREGATION, PWD SUMMARY,
  SC Pension Data, SC Senior Data masterlist, Solo Parent per-category/per-year — each added as a
  registry entry (cross-tabs may extend the structure with grouped column headers).
- PDF export, date-range / "as of" historical filtering, staff-role access.
