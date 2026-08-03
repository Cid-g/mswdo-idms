# PWD & Senior Citizen Admin Dashboards — Design

**Date:** 2026-06-02
**Author:** Cedrick (via Claude Code)
**Status:** Approved report sets (design phase) — pending spec review

## Problem

The Solo Parent admin dashboard now shows live statistical reports (see
`2026-06-01-solo-parent-dashboard-design.md`). The PWD (PDAO) and Senior Citizen (OSCA)
admins need the same kind of **overview** dashboard, computed live from the encoded
`Applicant` records, reusing the chart primitives already built for Solo Parent.

Scope of THIS work = the **dashboard overview** (visual summary charts) for PWD and SC.

**Out of scope (explicitly NEXT, after this):** a dedicated, printable/exportable **Reports
tab** that reproduces the office's official Excel report tabs verbatim (e.g. PWD "SEX SEG",
"Disability per barangay", "AGE SEGGREGATION", "SUMMARY"; SC "Pension Data", "Senior Data").
Those are the formatted tabular reports the offices submit. The dashboard is the overview;
the Reports tab is the detailed deliverable — a separate future project.

## Architecture (reuse — Approach B, unchanged)

Backend: add `buildPwdReports()` and `buildSeniorReports()` to the existing
`backend/src/lib/dashboardReports.js`; the controller dispatches by `req.user.department`.
Frontend: add `PwdReports.jsx` and `SeniorCitizenReports.jsx` section components that compose
the **existing** primitives (`ReportCard`, `GroupedBarChart`, `DonutChart`, `RankedBarList`)
plus one new generic primitive `StatTiles` (a labeled count-tile grid). `ExpiryPanel` stays
Solo-Parent-specific and is not reused.

## Reports — PWD (PDAO)

Source sheets: SEX SEG, Disability, AGE SEGGREGATION, SUMMARY. Schema fields:
`pwd.disabilityType` (enum `PWD_DISABILITY_TYPES`, 10 values), `pwd.uploadedToDOH`, `barangay`,
`sex`, `birthdate`, `recordStatus`, linked `IDRecord.applicantId`.

1. **Per Disability Type (M/F)** — `perDisability: [{ code, label, male, female, total }]` over
   all 10 `PWD_DISABILITY_TYPES` (zero-filled, enum order). `code`/`label` = the enum string
   (label may strip the leading "N. " for the axis). → `GroupedBarChart` (vertical).
2. **Per Barangay (M/F)** — `perBarangay: [{ barangay, male, female, total }]`, all 44, sorted
   desc by total. Identical shape to Solo Parent. → `RankedBarList`.
3. **Age Distribution** — `ageDistribution: [{ bracket, male, female, total }]` for brackets
   `0-17`, `18-30`, `31-59`, `60+` (age computed in JS from `birthdate`). → `GroupedBarChart`.
4. **Gender split** — `sexSplit: { male, female, total }`. → `DonutChart`.
5. **ID / Status summary** — `statusSummary: { encodedToDOH, withoutId, expired, deceased }`.
   → new `StatTiles` primitive.

## Reports — Senior Citizen (OSCA)

Source sheets: Senior Data, Pension Data, Sheet2. Schema fields:
`seniorCitizen.pensionType` (free String), `seniorCitizen.registrationCategory`
(enum `Walk-In`/`Caravan`), `barangay`, `sex`, `birthdate`.

1. **Per Pension Type (M/F)** — `perPension: [{ type, label, male, female, total }]` grouped by
   `seniorCitizen.pensionType`, zero-filled against `PENSION_TYPES`
   (`socpen, local socpen, SSS, GSIS, PVAO, Socpen/SSS, None`) plus an `Other/Unspecified`
   bucket for any value not in that list (including null). → `GroupedBarChart` (vertical).
2. **Per Barangay (M/F)** — `perBarangay: [{ barangay, male, female, total }]`, all 44, sorted
   desc. → `RankedBarList`.
3. **Age Distribution** — `ageDistribution: [{ bracket, male, female, total }]` for brackets
   `60-69`, `70-79`, `80-89`, `90+` (computed in JS from `birthdate`; the `90+` bucket includes
   centenarians). → `GroupedBarChart`.
4. **Gender split** — `sexSplit: { male, female, total }`. → `DonutChart`.
5. **Registration** — `registration: { walkIn, caravan, unspecified }` from
   `seniorCitizen.registrationCategory`. → `DonutChart`.

## Data scope / assumptions (please confirm during review)

- **Sex normalization** reused from Solo Parent: `'Male'/'M' → Male`, `'Female'/'F' → Female`,
  others excluded from M/F totals (consistent with existing behavior).
- **Population charts** (disability, pension, barangay, age, gender, registration) count records
  with `recordStatus: 'ACTIVE'` for the department — the currently-valid population.
- **PWD `statusSummary` is the exception:** it counts across **all** `recordStatus` values for
  `department: 'PWD'` (so EXPIRED and DECEASED are visible). Definitions:
  - `expired` = `recordStatus: 'EXPIRED'`
  - `deceased` = `recordStatus: 'DECEASED'`
  - `encodedToDOH` = `pwd.uploadedToDOH === true` (among active records)
  - `withoutId` = active PWD applicants with **no linked `IDRecord`** (no `IDRecord.applicantId`
    pointing to them)
- **Age** computed at query time from `birthdate`; records without a birthdate are excluded from
  the age chart only.

## Backend response shape

The controller returns `reports` (already wired). Shape per department:

```js
// PWD
reports = {
  perDisability:   [{ code, label, male, female, total }],   // 10, enum order
  perBarangay:     [{ barangay, male, female, total }],       // 44, sorted desc
  ageDistribution: [{ bracket, male, female, total }],        // 4 brackets
  sexSplit:        { male, female, total },
  statusSummary:   { encodedToDOH, withoutId, expired, deceased },
};

// Senior Citizen
reports = {
  perPension:      [{ type, label, male, female, total }],    // PENSION_TYPES + Other
  perBarangay:     [{ barangay, male, female, total }],        // 44, sorted desc
  ageDistribution: [{ bracket, male, female, total }],         // 4 brackets
  sexSplit:        { male, female, total },
  registration:    { walkIn, caravan, unspecified },
};
```

The controller dispatch:

```js
let reports = null;
if (dept === 'SOLO_PARENT')        reports = await buildSoloParentReports();
else if (dept === 'PWD')           reports = await buildPwdReports();
else if (dept === 'SENIOR_CITIZEN') reports = await buildSeniorReports();
```

## Frontend

- **New primitive** `components/dashboard/StatTiles.jsx` — props `{ tiles: [{ key, label, value,
  color, Icon }] }`, renders a responsive grid of count tiles (generalizes the tile pattern
  already in `ExpiryPanel`). Accent colors via props.
- **`components/dashboard/PwdReports.jsx`** — composes: Row 1 `[Per Disability (2fr)] [Gender donut (1fr)]`;
  Row 2 `[Age Distribution (2fr)] [Status summary tiles (1fr)]`; Row 3 `[Per Barangay (full)]`.
- **`components/dashboard/SeniorCitizenReports.jsx`** — Row 1 `[Per Pension (2fr)] [Gender donut (1fr)]`;
  Row 2 `[Age Distribution (2fr)] [Registration donut (1fr)]`; Row 3 `[Per Barangay (full)]`.
- **`pages/admin/DashboardPage.jsx`** — extend the existing department guard to render the
  matching section: `PWD → PwdReports`, `SENIOR_CITIZEN → SeniorCitizenReports`,
  `SOLO_PARENT → SoloParentReports` (existing). Dept colors come from the existing `DEPT_CONFIG`
  (PWD blue `#3B82F6`, SC amber `#D97706`), so charts adopt each department's palette.

Empty states reuse the per-card pattern from `SoloParentReports`.

## Testing

- **Backend (TDD):** extend `backend/tests/integration/dashboardReports.test.js` with
  `buildPwdReports` and `buildSeniorReports` describe blocks — seed PWD/SC fixtures and assert
  perDisability/perPension, perBarangay, ageDistribution, sexSplit, statusSummary/registration,
  plus the endpoint returning the right shape for a PWD admin and a SC admin.
- **Frontend:** manual visual verification (run app, log in as PWD admin and SC admin) plus
  `vite build`.

## Files

**Backend**
- MODIFY `src/lib/dashboardReports.js` — add `buildPwdReports`, `buildSeniorReports`, age-bucket
  + IDRecord helpers; export them.
- MODIFY `src/controllers/dashboardController.js` — dispatch PWD / SENIOR_CITIZEN.
- MODIFY `tests/integration/dashboardReports.test.js` — new describe blocks.

**Frontend**
- NEW `src/components/dashboard/StatTiles.jsx`
- NEW `src/components/dashboard/PwdReports.jsx`
- NEW `src/components/dashboard/SeniorCitizenReports.jsx`
- MODIFY `src/pages/admin/DashboardPage.jsx` — render the matching section per department.

## Out of scope (future, after this)

- The dedicated **Reports tab** (printable/exportable official tables matching the Excel tabs).
- Importing historical Excel totals not yet encoded.
