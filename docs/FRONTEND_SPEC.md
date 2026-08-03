# FRONTEND SPECIFICATION — MSWDO ID Management System

**Framework:** React 18 + Vite  
**Styling:** Tailwind CSS v4 (`@tailwindcss/vite`, no config file) + shadcn/ui  
**Routing:** React Router v6  
**State:** Zustand (auth/global) + React Query (server data)

---

## Route Structure

```
/login
/superadmin/dashboard
/superadmin/users
/superadmin/audit-logs
/admin/dashboard
/admin/staff
/admin/templates
/admin/templates/editor/:id
/admin/audit-logs
/staff/applicants
/staff/applicants/new
/staff/applicants/:id
/staff/applicants/:id/id-card
/staff/templates
```

> ⚠️ SuperAdmin firstName = "Super", lastName = "Admin" — greeting reads "Good morning, Super"

---

## Global Layout

### Sidebar
- Fixed 256px, `#0F1623` background, always visible on desktop
- **Logo area:** 32px Gerona seal (`/GERONA-LOGO-small-scaled.png`) + "MSWDO" text + dept/role subtitle
- **Nav section labels:** 10px uppercase tracked, `text-white/30`
- **Nav items:** Lucide icon (20px) + label. Default: `#A8B4CC`. Active: dept-color left border (3px) + `bg-white/10 text-white`
- **Bottom:** Avatar circle (initials) + name + role badge + Sign Out with LogOut icon

### Dept CSS classes (apply to root layout element)
`.dept-pwd` / `.dept-solo-parent` / `.dept-senior` / `.role-superadmin`
Each exposes: `--dept-primary`, `--dept-gradient`, `--dept-light`, `--dept-text`

### Vite proxy
`/api/*` → `http://localhost:5000` — configured in `vite.config.js`

---

## Shared Components

### `<PageBanner>`
Reusable gradient banner used on every page. Props: `title`, `subtitle`, `children` (for action buttons).
- Dept gradient background from `var(--dept-gradient)`
- Dot grid texture overlay at ~5% opacity
- Large faint initials overlay (decorative, aria-hidden)
- Title in DM Serif Display, subtitle muted white

### `<BarangayCombobox>`
Searchable dropdown for 44 Gerona barangays. Custom implementation (no Radix dependency).
Used in all 3 dept quick-encode forms.

### `<PhotoEditor>`
Drop zone → ReactCrop (3:4 locked) → canvas blob → POST to backend → done state.
Handles loading state, fallback if bg removal fails.

### `<SignaturePad>`
Tabs: Draw (`react-signature-canvas`) / Upload. Shows saved state with replace option.

### `<ChildrenForm>` (Solo Parent only)
Dynamic add/remove rows, max 6 (only 6 print on ID back). Age auto-computed from birthdate.
Warning shown if >6 children added.

### `<SectionAccordion>`
Reusable accordion for Applicant Detail. Props: `title`, `status` (complete/partial/empty), `missingCount`, `defaultOpen`.
- Status icon: green check (complete), amber alert (partial), grey dash (empty)
- Status badge: "Complete" / "X missing" / "Not started"
- Animates on open/close

### `<ProfileCompletionBar>`
Progress bar showing overall completion % for a partial applicant record.

### `<StatusBadge>`
Props: `status` — PARTIAL shows amber with animate-pulse dot. COMPLETE shows calm green.

### `<DeptBadge>`
Props: `department` — colored pill badge.

### Dept-specific quick-encode field components
- `<PWDQuickEncodeFields>` — 10 fields: name, birthdate, barangay, disability type, emergency contact
- `<SoloParentQuickEncodeFields>` — 15+ fields: name, birthdate/birthplace, barangay, category, children (dynamic), emergency contact
- `<SeniorCitizenQuickEncodeFields>` — 6 fields: name, birthdate (with live age chip), barangay

---

## Page Specs

### LOGIN (`/login`)
Split layout: left 40% slate gradient panel, right 60% form (max-w-sm centered).
Left panel: Gerona seal (96px) + "Municipality of Gerona" (DM Serif) + "MSWDO ID Management System".
Form: "Welcome Back" heading (DM Serif), username + password (show/hide), full-width button.
Error: inline alert under form. Loading: spinner in button, form disabled.

---

### SUPERADMIN DASHBOARD (`/superadmin/dashboard`)
PageBanner: "Good {timeOfDay}, Super" (DM Serif text-4xl) + date.
3 dept stat cards in a row — each card has colored top accent strip, dept icon, 3 stats side by side (Total / Active IDs / Partial).
Below: ID Issuance Trend line chart (Recharts, last 12 months, 3 lines) + User Distribution donut chart.

---

### SUPERADMIN MANAGE ADMINS (`/superadmin/users`)
PageBanner with "+ Add Admin" button (white/15 bg).
Table: Department badge | Admin Name | Username | Email | Status | Actions (edit, reset password, deactivate).
Add Admin modal: firstName, lastName, username, email, department (dropdown), password, confirm.
Dept badges use exact dept colors. Row hover: `bg-slate-50`.

---

### ADMIN DASHBOARD (`/admin/dashboard`)
PageBanner: "Good {timeOfDay}, {firstName}" + dept name + date.
4 stat cards with dept-color left border: Total Applicants / Active IDs / Needs Completion (amber) / Revoked.
Below: Monthly Bar Chart (Recharts, 6 months) + Recent Activity Feed (last 10 audit entries, timeline style).

---

### ADMIN STAFF MANAGEMENT (`/admin/staff`)
PageBanner with "+ Add Staff" button.
Search + Role filter + Status filter above table.
Table: Name | Username | Role | Status | Date Added | Actions.
Add Staff modal: name, username (auto-suggest), email, role, password + strength indicator.
Empty state: dept icon + description + "Add First Staff Member" button.

---

### ADMIN ID TEMPLATES (`/admin/templates`)
Shows current active template (if uploaded): thumbnail + name + version + upload date.
Action buttons: Upload New / Configure Placeholders / Preview with Sample Data.
If no template: empty state card with dashed border, CreditCard icon, description.

### TEMPLATE PLACEHOLDER EDITOR (`/admin/templates/editor/:id`)
Split view: left canvas (template image + draggable placeholder boxes) / right panel (placeholder list + config).
Placeholders by dept — see MASTER_PLAN.md for full list.
`CHILDREN_TABLE` is a special placeholder that renders a 6-row table on ID back.

---

### STAFF APPLICANTS LIST (`/staff/applicants`)
Header: "Applicants" (DM Serif) + dept + total count + "+ New Applicant" button.
Search (debounced 300ms) + Status filter.
Table: Case/Control No. (monospace) | Full Name (LASTNAME, Firstname) | Barangay | Age/Sex | Status | Date | Actions.
PARTIAL badge has animate-pulse dot. Full row is clickable → navigates to detail.
Empty state: dept icon + "No applicants yet" + New Applicant button.

---

### NEW APPLICANT — QUICK ENCODE (`/staff/applicants/new`)
3-step wizard on single page — step tracked with `useState`, no route changes between steps.
Form card: centered, max-w-[560px], colored top strip, border + shadow.
Page title: left dept-color border accent + "New Applicant" (DM Serif).

**Step 1: Basic Info** — dept-specific fields via `<PWDQuickEncodeFields>`, `<SoloParentQuickEncodeFields>`, or `<SeniorCitizenQuickEncodeFields>`.
Below required fields: dashed "Complete full profile now" accordion button (optional, shows all remaining fields for that dept if no queue).
Save & Continue button: pill shape, dept-color.

**Step 2: Photo & Signature** — `<PhotoEditor>` + `<SignaturePad>` side by side. Next button enabled only when both done.

**Step 3: Confirm & Generate** — summary card (photo thumbnail + name + dept badge + key fields). "Generate ID Now" large pill button.

On generate: POST /applicants → POST /photo → POST /signature → POST /id-records → navigate to id-card page.

---

### APPLICANT DETAIL (`/staff/applicants/:id`)
**Accordion-based layout** (not tabs — see MASTER_PLAN.md for rationale).

**Header card:** circular photo (56px, dept-color border) + full name (DM Serif) + dept badge + control number + status badge + progress bar.
Status badge: PARTIAL = amber with warning icon "Needs Completion". COMPLETE = green "Complete".

**Accordion sections** — each is a `<SectionAccordion>`:
- Sections with empty fields auto-expand on load
- Sections that are complete auto-collapse
- Each section auto-saves when collapsed (PATCH /applicants/:id)
- Section header shows status icon + title + "X missing" or "Complete" badge

**PWD sections:** Personal Info | Photo & Signature | Socio-Economic | Organization & Skills | Case Management | Form Tracking | ID Record

**Solo Parent sections:** Personal Info | Children | Emergency Contact | Photo & Signature | Additional Personal Details | Employment | Program Participation | Children Summary Counts | Case Management | ID Record

**Senior Citizen sections:** Personal Info | Photo & Signature | Personal Details | Health | ID Registration Details | Pension | Status & Remarks | ID Record

**Incomplete field highlighting:** When a section is open and a field is empty, it gets amber border + `<span className="field-incomplete">` wrapper + "Not yet filled" hint text.

**"Complete Full Profile" button:** Dashed border, bottom of page, expands all sections with missing fields simultaneously. Only visible when record is PARTIAL.

**Blockchain status** (in ID Record section): shows anchored/pending/not-anchored with TX ID if anchored.

---

### ID CARD VIEW (`/staff/applicants/:id/id-card`)
Centered, max-w-lg. ID image in a card with strong shadow.
Front/Back tabs: Solo Parent (both have variable fields) + PWD (back has emergency contact). Senior: front only.
Actions: Print (dept-color button) + Download PNG + Download PDF.
Blockchain status card below ID image.
Print CSS: `.id-card-print { width: 85.6mm; height: 54mm; }`

---

### AUDIT LOG (`/superadmin/audit-logs` or `/admin/audit-logs`)
Filter bar: date range + action dropdown + user search + dept (SA only).
Timeline-style list: action icon + description + timestamp + user name + IP.
CSV export button.

---

## State Management

```js
// authStore.js (Zustand + persist)
{ user, accessToken, refreshToken, isAuthenticated }
actions: setAuth, setTokens, logout

// uiStore.js
{ sidebarOpen, toggleSidebar }
```

## API Layer
`services/api.js` — Axios instance, baseURL `/api`, Bearer token interceptor, silent refresh on 401 (concurrent request queue pattern).

## Form Validation
Zod schemas in `lib/validations/`: loginSchema, createUserSchema, applicantBaseSchema, pwdDetailsSchema, soloParentDetailsSchema, seniorCitizenDetailsSchema

## Loading & Error States
- Lists: skeleton rows (animate-pulse), not spinners
- Buttons: spinner + disabled during async
- Empty states: always icon + DM Serif heading + description + action
- Errors: toast (sonner) for system errors, inline for form errors

---

*See API_SPEC.md for endpoints | See USER_FLOWS.md for step-by-step workflows | See UIUX_SPEC.md for design tokens*