# PWD Disability-per-Barangay Cross-Tab Report — Design

**Date:** 2026-06-02
**Author:** Cedrick (via Claude Code) — Claude chose this report per delegation
**Status:** Design phase

## Problem

The Reports framework + first flat report (Per-Barangay) is done. The next report is the first
**cross-tab** with **grouped column headers**: PWD "Summary of Type of Disability per Barangay"
(the Excel "Disability" tab). Goal: apply that exact Excel report into the system and view it
visually in the UI, plus Excel export.

Building this establishes the **grouped-header extension** that AGE SEGGREGATION and SC Pension
Data will reuse.

## Excel layout (PDAO "Disability" tab, 38 cols)

- Group header row: `No. | Barangay | <10 disability types, each spanning M/F/Total> | Total Number of PWD (M/F/Total)`
- Sub-header row: `M | F | Total` under each disability group.
- Data row per barangay: counts per disability (M/F/Total) + a per-barangay grand total (M/F/Total).
- 10 disability types in `PWD_DISABILITY_TYPES` order (labels = enum string minus the leading "N. ").

## Structure extension (backward-compatible)

A report's normalized structure gains an OPTIONAL `columnGroups` as an alternative to flat `columns`:

```js
{
  id, title, asOf,
  // grouped (cross-tab) form:
  columnGroups: [
    { label: null, columns: [ { key:'no', label:'No.', align:'right' }, { key:'barangay', label:'Barangay' } ] },
    { label: 'Deaf or Hard of Hearing', columns: [ {key:'d0_m',label:'M',align:'right'}, {key:'d0_f',label:'F',align:'right'}, {key:'d0_t',label:'Total',align:'right'} ] },
    // ...one group per disability (d0..d9)...
    { label: 'Total (PWD)', columns: [ {key:'all_m',label:'M',align:'right'}, {key:'all_f',label:'F',align:'right'}, {key:'all_t',label:'Total',align:'right'} ] },
  ],
  rows:   [ { no, barangay, d0_m, d0_f, d0_t, ..., all_m, all_f, all_t } ],
  totals: { d0_m, d0_f, d0_t, ..., all_m, all_f, all_t },
}
```

- A group with `label: null` = leading ungrouped columns (No./Barangay); they span both header rows.
- A group with a `label` renders the label merged across its sub-columns (row 1) + the sub-labels
  M/F/Total (row 2).
- Flat reports keep using `columns` and are unaffected.
- A shared helper `flattenColumns(structure)` returns `structure.columns ?? columnGroups.flatMap(g => g.columns)`
  — used by data/total rendering in both the exporter and the table; header rendering branches on
  whether `columnGroups` is present.

## Backend

- `src/lib/reports/disabilityByBarangay.js` — `buildDisabilityByBarangayReport()`:
  aggregate `{ barangay, type: '$pwd.disabilityType', _sex }` over `{ department:'PWD',
  recordStatus:'ACTIVE' }` (reuse `SEX_NORMALIZE`); pivot into rows in canonical `BARANGAYS`
  alphabetical order with `no` 1–44; per disability `d{i}_m/_f/_t`; per-barangay grand total
  `all_m/_f/_t`; `totals` = grand totals for every numeric key. Title: `Type of Disability per
  Barangay`. Columns built from `PWD_DISABILITY_TYPES` (group label = `stripNumPrefix(code)`).
  Export `stripNumPrefix` from a shared spot or duplicate the 1-liner locally.
- `src/lib/reports/excel.js` — extend `tableToWorkbook` to support `columnGroups`: when present,
  render TWO header rows (row 4 group labels with horizontal merges for labeled groups and a
  vertical merge for null-label leading columns; row 5 sub-labels), data from row 6, totals after.
  Flat path (single header row at 4, data at 5) unchanged. Use a `flattenColumns` helper for data
  + totals iteration. Keep numeric `mergeCells`.
- `src/lib/reports/index.js` — add registry entry `'disability-by-barangay'` with
  `departments: ['PWD']`, dept-aware `title`, `build`.
- No controller/route changes needed (generic endpoints already serve any registry id).

## Frontend

- `src/components/reports/ReportTable.jsx` — extend to render grouped headers when `columnGroups`
  is present: a first `<tr>` of group `<th colSpan>` (labeled groups) / `<th rowSpan=2>` (null-label
  leading columns), a second `<tr>` of sub-label `<th>` for labeled groups; data + totals iterate
  the flattened column list. Flat reports render the existing single header row. The table already
  has `overflow-x-auto` for the wide cross-tab.
- `ReportsPage.jsx` — no change required; it already lists all reports for the dept and shows the
  selector when there is more than one. (A PWD admin will now see two reports → the selector
  appears, which we also want to verify.)

## Testing

- **Backend (TDD):** `buildDisabilityByBarangayReport` — seed PWD applicants across barangays +
  disability types + sexes; assert pivot counts for a known cell, per-barangay grand total, the
  `totals` row, alphabetical 44 rows, columnGroups shape (12 groups: leading + 10 + total), and
  dept-aware title. Extend `tableToWorkbook` test for the grouped path: assert group label cell,
  sub-label row, a data cell at the correct (row,col), and the TOTAL row. Endpoint:
  `GET /api/reports` for a PWD admin lists both reports; `GET /api/reports/disability-by-barangay`
  returns columnGroups; `/export` returns xlsx.
- **Frontend:** manual visual (PWD admin → Reports → selector → grouped table renders + export
  downloads a valid grouped .xlsx) + `vite build`.

## Files

**Backend:** NEW `src/lib/reports/disabilityByBarangay.js`; MODIFY `src/lib/reports/excel.js`
(grouped headers + flattenColumns), `src/lib/reports/index.js` (registry entry); MODIFY
`tests/integration/reports.test.js`.

**Frontend:** MODIFY `src/components/reports/ReportTable.jsx` (grouped headers).

## Out of scope (future)

- AGE SEGGREGATION (3-D: barangay × age × disability) and SC Pension Data cross-tabs — will reuse
  this grouped-header machinery (Pension Data is structurally identical; AGE may nest further).
- The stray secondary total column seen in the Excel beyond "Total Number of PWD" — we model the
  10 disability groups + one grand-total group, which is the meaningful content.
