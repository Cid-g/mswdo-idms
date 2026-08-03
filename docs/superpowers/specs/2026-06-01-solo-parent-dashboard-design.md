# Solo Parent Admin Dashboard — Design

**Date:** 2026-06-01
**Author:** Cedrick (via Claude Code)
**Status:** Approved (design phase)

## Problem

The MSWDO Solo Parent admin currently produces statistical reports manually in an
Excel workbook (`templates/Gerona Database of Solo Parents as of 12-31-2025.xlsx`).
The existing admin dashboard (`frontend/src/pages/admin/DashboardPage.jsx`) is generic
across all three departments and only shows: 4 stat cards (Total Applicants, Active IDs,
Needs Completion, Revoked IDs), a "Monthly ID Issuance" bar chart, and a Recent Activity
feed. It does not surface the aggregate reports the Solo Parent admin actually relies on.

This work adds those reports to the Solo Parent admin dashboard, computed live from the
encoded `Applicant` records, with a polished UI. PWD and Senior Citizen dashboards will
follow later and reuse the same chart components.

## Decisions (locked during brainstorming)

| Decision | Choice |
| --- | --- |
| Data source | Live from MongoDB `Applicant` records (auto-updates as staff encode) |
| Placement | Extend the existing admin `DashboardPage.jsx` (one scrollable dashboard) |
| Architecture | Approach B — dept-specific section components + shared reusable chart primitives |
| SPIC validity | 1 year from `dateSpicIssued` (RA 11861 IRR default), expiry computed |
| Year basis | `soloParent.dateSpicIssued`; records without it are excluded from the year chart |
| Record scope | All `department: SOLO_PARENT` records with `recordStatus: ACTIVE` (includes PARTIAL) |

## Reports included

1. **Per Category (NEW vs RENEW)** — 12 categories (a1–a7 reasons, b–f), separate New/Renew counts.
2. **Per Barangay** — count per 44 barangays with Male/Female breakdown.
3. **Per Year of Registration** — count per year, split Male/Female, by `dateSpicIssued`.
4. **Male vs Female totals** — overall gender split.
5. **SPIC Expiry / Renewal** — actionable tracking of expired / soon-to-expire Solo Parent IDs.

## Architecture — Approach B

Reusable layer is a set of small chart **primitive components**. Each department gets its
own **section component** that composes those primitives. The backend exposes department-aware
report data through the existing dashboard endpoint.

### Backend

Extend `getAdminDashboard` in `backend/src/controllers/dashboardController.js`. When
`req.user.department === 'SOLO_PARENT'`, attach a `reports` object to the existing JSON
response. No new endpoint. Aggregation logic lives in a new module
`backend/src/lib/dashboardReports.js`, exporting `buildSoloParentReports(dept)` so that
`buildPwdReports()` / `buildSeniorReports()` can be added later without touching the controller
beyond a dispatch switch.

Response shape (`reports`):

```js
reports: {
  perCategory: [
    { code: 'a2', label: 'Widow/widower', new: 24, renew: 15, total: 39 },
    // ...all 12 categories, zero-filled
  ],
  perBarangay: [
    { barangay: 'ABAGON', male: 5, female: 54, total: 59 },
    // ...all 44 barangays, zero-filled, sorted desc by total
  ],
  perYear: [
    { year: 2016, male: 2, female: 26, total: 28 },
    // ...sorted asc; records without dateSpicIssued excluded
  ],
  sexSplit: { male: 87, female: 718, total: 805 },
  spicExpiry: {
    buckets: { expired, days30, days90, valid }, // expiry = dateSpicIssued + 1 year
    soon: [
      { name, spicNumber, dateSpicIssued, expiry, daysLeft, status },
      // expired + expiring within 90 days, sorted ascending by expiry
    ],
  },
}
```

Aggregation notes:
- `perCategory`, `perBarangay`, `perYear`, `sexSplit` use MongoDB aggregation pipelines with
  `$match: { department: 'SOLO_PARENT', recordStatus: 'ACTIVE' }`. Category and barangay results
  are zero-filled against the canonical lists in `lib/constants` so every category/barangay shows.
- Category labels (a1–f) come from a label map derived from the Excel workbook, kept in
  `dashboardReports.js` (or `lib/constants`).
- `spicExpiry` is computed in JS: fetch minimal fields
  (`firstName`, `lastName`, `spicNumber`, `dateSpicIssued`) for the matched records, compute
  `expiry = dateSpicIssued + 1 year`, bucket by days remaining, and build the `soon` list.
  Record volume (~800) makes JS computation acceptable and clearer than date pipelines.

### Frontend — reusable chart primitives

New directory `frontend/src/components/dashboard/`:

- **`ReportCard.jsx`** — white card wrapper (title + subtitle + body) matching the existing card
  style (`bg-white rounded-xl`, `shadow-card`, font-serif title).
- **`GroupedBarChart.jsx`** — recharts grouped bars; used for Per Year (M/F) and Per Category (New/Renew).
- **`DonutChart.jsx`** — recharts donut; used for Sex split.
- **`RankedBarList.jsx`** — custom CSS horizontal bar list with Male/Female segments, sorted,
  scrollable; used for Per Barangay (cleaner than recharts for 44 rows).
- **`ExpiryPanel.jsx`** — 4 mini-stat tiles (Expired / ≤30d / ≤90d / Valid) plus a scrollable list
  of soon-to-expire records with day-countdown badges.

All primitives accept `accent` / `barFill` (and a secondary series color) via props, supplied by
the department config, so PWD/SC reuse them with their own palettes.

### Section component + integration

- **`frontend/src/components/dashboard/SoloParentReports.jsx`** — composes the primitives using
  `data.reports`. Responsive grid:
  - Row 1: `[Per Year — grouped bar (2fr)]  [Sex split — donut (1fr)]`
  - Row 2: `[Per Category NEW vs RENEW — grouped bar (2fr)]  [SPIC Expiry panel (1fr)]`
  - Row 3: `[Per Barangay — ranked bar list (full width)]`
- **`DashboardPage.jsx`** (edit) — after the existing chart+activity grid, render:
  ```jsx
  {user.department === 'SOLO_PARENT' && data?.reports && (
    <SoloParentReports reports={data.reports} dept={dept} />
  )}
  ```

States:
- Loading → skeletons consistent with the existing dashboard (`animate-pulse`).
- Empty (no records, or no `dateSpicIssued` for the year chart) → friendly per-card empty state.

The final palette, spacing, and animation polish are finalized during the build using the
`ui-ux-pro-max` and `frontend-design` skills, staying within the existing Tailwind v4 design
tokens (`--color-*`, `--shadow-*`, font-serif headings).

## Testing

- **Backend (TDD):** `backend/tests/integration/dashboardReports.test.js` — seed known
  Solo Parent fixtures and assert `perCategory`, `perBarangay`, `perYear`, `sexSplit`, and
  `spicExpiry` buckets. Tests written before implementation.
- **Frontend:** manual visual verification by running the app — confirm every section renders
  with live/mock data and that loading and empty states behave.

## Files

**Backend**
- NEW `src/lib/dashboardReports.js` — `buildSoloParentReports` + category label map
- EDIT `src/controllers/dashboardController.js` — dispatch to report builder, attach `reports`
- NEW `tests/integration/dashboardReports.test.js`

**Frontend**
- NEW `src/components/dashboard/ReportCard.jsx`
- NEW `src/components/dashboard/GroupedBarChart.jsx`
- NEW `src/components/dashboard/DonutChart.jsx`
- NEW `src/components/dashboard/RankedBarList.jsx`
- NEW `src/components/dashboard/ExpiryPanel.jsx`
- NEW `src/components/dashboard/SoloParentReports.jsx`
- EDIT `src/pages/admin/DashboardPage.jsx` — render the Solo Parent section

## Out of scope (future)

- PWD (PDAO) and Senior Citizen dashboards — will reuse the chart primitives, each with its own
  section component and report builder (`buildPwdReports`, `buildSeniorReports`).
- Importing/overlaying historical Excel totals not yet encoded in the DB.
- Manual `dateOfValidity` field on the schema (current design computes expiry from `dateSpicIssued`).
