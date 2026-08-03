# MSWDO ID Management System — Master Plan

## Project Overview
**Full Name:** Secure Municipal ID Issuance and QR-Based Verification System Using Hyperledger Fabric Blockchain
**Client:** MSWDO (Municipal Social Welfare and Development Office) — Gerona, Tarlac
**Thesis Author:** Larsen B. Dignos
**University:** Nueva Ecija University of Science and Technology
**Degree:** Master of Science in Information Technology (System Development)

---

## Tech Stack

### Frontend
- React 18 + Vite
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin — **NO `tailwind.config.js`**, all theme in `index.css` via `@theme {}`
- shadcn/ui
- React Router v6
- Zustand (auth/global state), React Query (server state)
- React Hook Form + Zod validation
- `react-image-crop` — photo cropping
- `react-signature-canvas` — signature pad
- `html5-canvas` (via node-canvas result display) — ID preview
- Recharts — dashboard charts
- Axios + auto-refresh interceptor
- `date-fns` — date utilities (age computation, formatting)
- `sonner` — toast notifications

### Backend
- Node.js (LTS) + Express.js
- **MongoDB** via **Mongoose** (flexible schema, easy to extend fields per dept)
- JWT (access + refresh tokens), bcrypt passwords
- Multer — file uploads (memory storage)
- `@imgly/background-removal-node` — backend BG removal (try/catch, falls back to crop-only)
- `canvas` (node-canvas) — ID image generation (**Phase 7 only** — needs Python 3 + Windows Build Tools)
- `qrcode` — QR code generation
- `uuid` — QR tokens
- `helmet`, `express-rate-limit`, `cors`
- Custom audit log middleware

### Vite Proxy (critical — must exist in vite.config.js)
```js
server: {
  proxy: {
    '/api': { target: 'http://localhost:5000', changeOrigin: true },
    '/uploads': { target: 'http://localhost:5000', changeOrigin: true }
  }
}
```
Frontend axios uses `baseURL: '/api'` — Vite proxies to backend port 5000.

### Blockchain
- Hyperledger Fabric 2.5
- `@hyperledger/fabric-gateway` SDK
- Chaincode: JavaScript (Node.js)
- **On-chain:** SHA-256 hash of canonical record + minimal metadata ONLY
- **Off-chain:** All personal data, photos, files (stays in MongoDB + filesystem)

### Infrastructure
- Docker + Docker Compose (WSL2 on Windows for dev)
- Hyperledger Fabric test-network (2 orgs, 1 orderer, 3 CAs)
- Public Verification App: separate cloud deploy (Vercel or Railway)

---

## User Roles & Hierarchy

```
SuperAdmin
├── Admin (PWD)
│   ├── Encoder
│   └── Releasing Staff
├── Admin (Solo Parent)
│   ├── Encoder
│   └── Releasing Staff
└── Admin (Senior Citizen)
    ├── Encoder
    └── Releasing Staff
```

| Role | Scope | Capabilities |
|------|-------|-------------|
| SuperAdmin | System-wide | Read-only dashboard, manage 3 admins, system audit log |
| Admin | Own dept | Dept dashboard, staff management, ID template, dept audit log |
| Encoder | Own dept | Encode applicants, generate ID, photo/signature, template upload |
| Releasing Staff | Own dept | Same as Encoder (same permissions, different real-world role) |

---

## ID Issuance Workflow (Speed-Optimized)

```
STEP 1 — QUICK ENCODE (at interview, with queue)
  Capture minimum fields → Generate ID → Print → Hand to citizen
  Record status = PARTIAL

STEP 2 — COMPLETE PROFILE (after queue clears)
  Fill remaining fields → Record status = COMPLETE
  → Blockchain anchoring triggered automatically
```

---

## Departments, Fields & ID Cards

### PWD Department

**Quick Encode (10 fields):**
lastName, firstName, middleName, barangay, birthdate, disabilityType,
photo, signature, emergencyContactName, emergencyContactNumber

**Complete Profile adds:** purokStreet, sex, civilStatus, relationshipToHH,
contactNumber, religion, causeOfDisability, educationalAttainment,
educationalStatus, occupation, monthlyIncome, availableSkill, skillsDesired,
organization, hobbies, uploadedToDOH, natFormSubmitted, locFormSubmitted,
servicesAvailed, needsProblems, otherFamilyResources

**PWD ID — FRONT placeholders:**
`PHOTO`, `SIGNATURE`, `FULL_NAME`, `ADDRESS`, `BIRTHDATE`,
`DISABILITY_TYPE`, `ISSUED_DATE`, `ID_NUMBER`, `QR_CODE`

**PWD ID — BACK placeholders:**
`EMERGENCY_CONTACT_NAME`, `EMERGENCY_CONTACT_NUMBER`
(Rest is static: benefits text, "VALID FOR 5 YEARS", mayor signature)

**ID Validity: 5 years**

---

### Solo Parent Department

**Quick Encode (15+ fields):**
lastName, firstName, middleName, birthdate, birthplace, barangay,
categoryCode (a1–a7, b, c, d, e, f),
child[0]: fullName, birthdate, relationship,
emergencyContactName, emergencyContactAddress, emergencyContactNumber,
photo, signature

**Complete Profile adds:** extensionName, sex, civilStatus, educationalAttainment,
religion, employmentStatus, occupation, monthlyIncome, philsysCardNumber,
email, numChildren0to6, numChildren7to22, numChildrenWSN,
additional children, pantawidBeneficiary, indigenousPerson,
lgbtq, isPWD, isSeniorCitizen, modeOfAdmission, psychosocialServices,
referralToAgencies, remarks

**Solo Parent ID — FRONT placeholders:**
`PHOTO`, `SIGNATURE`, `FULL_NAME`, `BIRTHDATE_BIRTHPLACE`,
`ADDRESS`, `CATEGORY_CODE`, `VALID_UNTIL`, `SPIC_NUMBER`, `QR_CODE`

**Solo Parent ID — BACK placeholders:**
`CHILDREN_TABLE` (6-row table: name, birthdate, age, relationship),
`EMERGENCY_CONTACT_NAME`, `EMERGENCY_CONTACT_ADDRESS`, `EMERGENCY_CONTACT_NUMBER`

**ID Validity: 2 years from issuance**

---

### Senior Citizen Department

**Quick Encode (6 fields — fewest):**
lastName, firstName, middleName, barangay, birthdate, photo, signature

**Complete Profile adds:** sex, maritalStatus, contactNumber, livingStatus,
occupation, income, medicalCondition, medicine, isDisabled, oscaNumber,
rrn, dateIssued, registrationCategory (Walk-In/Caravan),
idTransactionType (New/Replace/Loss/Transfer), isPensioner, pensionType, pensionAmount

**Senior Citizen ID — FRONT placeholders:**
`PHOTO`, `SIGNATURE`, `OSCA_NUMBER`, `FULL_NAME`, `ADDRESS`,
`BIRTHDATE`, `AGE` (auto-computed), `ISSUED_DATE`, `QR_CODE`

**Senior Citizen ID — BACK:** Fully static text — no variable placeholders

**ID Validity: No expiry (lifetime)**

---

## ID Number Formats

| Dept | Field | Format | Example |
|------|-------|--------|---------|
| PWD | Control Number | `YYYY-NNN` | `2026-461` |
| PWD | ID Number (printed) | `03-6906-000-NNNNNNN` | `03-6906-000-0002975` |
| Senior Citizen | OSCA Number | `YY-NNNN` | `26-0501` |
| Solo Parent | Case Number | `YYMM-NNNNNN` | `2605-000001` |
| Solo Parent | SPIC Number | `036906000-YYMM-NNNNNN` | `036906000-2605-000001` |

**Age is NEVER stored** — always computed from birthdate at runtime using `computeAge()` util or `differenceInYears` from date-fns.

---

## ID Template System

Admin or staff uploads a blank PNG template. A drag-and-drop configurator
lets them position each placeholder. Config saved as JSON.
At generation time, node-canvas composites everything server-side.

All placeholder keys: `PHOTO`, `SIGNATURE`, `QR_CODE`, `FULL_NAME`, `ADDRESS`,
`BIRTHDATE`, `ISSUED_DATE`, `ID_NUMBER`, `DISABILITY_TYPE`,
`EMERGENCY_CONTACT_NAME`, `EMERGENCY_CONTACT_NUMBER`, `EMERGENCY_CONTACT_ADDRESS`,
`CATEGORY_CODE`, `BIRTHDATE_BIRTHPLACE`, `VALID_UNTIL`, `SPIC_NUMBER`,
`OSCA_NUMBER`, `AGE`, `CHILDREN_TABLE` (special 6-row table, Solo Parent back only)

---

## Applicant Detail — Accordion UI Pattern

The Applicant Detail page (`/staff/applicants/:id`) uses an **accordion-based layout**
instead of tabs. This was decided to support the two-phase encoding workflow:

- **Quick-encode fields** (from wizard) are pre-filled and shown as complete sections
- **Complete-profile fields** are shown in expandable accordion sections
- Sections with empty required fields **auto-expand** and highlight incomplete fields
- A "Complete Full Profile" dashed button at the bottom expands all remaining sections
- **Auto-save** per section when user collapses it
- Status badge updates from PARTIAL → COMPLETE when all fields are filled
- Progress bar shows overall completion percentage

---

## Blockchain Integration

**Trigger:** When applicant status changes from PARTIAL → COMPLETE

**On-chain:** recordRef, idType, soloParentIdType, SHA-256 hash, status, issuingOffice, issuedAt

**Chaincode functions:** issueID, verifyID, revokeID, getIDHistory, expireID

See BLOCKCHAIN_SPEC.md for canonical hash construction.

---

## QR Code & Public Verification

- QR contains: `https://verify.mswdo-gerona.gov.ph/check?token=<uuid-v4>`
- Public page shows: VALID/EXPIRED/REVOKED/NOT FOUND, masked name, ID type, expiry
- No personal details exposed publicly

---

## Security

- JWT access token (15min) + refresh token (7 days), rotation on use
- bcrypt cost factor 12
- RBAC middleware on every API route
- Rate limiting: 10 req/min on login
- Audit log: every state-changing action logged to MongoDB
- QR tokens: UUID v4 (unguessable)
- Blockchain: TLS gRPC

---

## Modules Per Role

### SuperAdmin
- Dashboard (read-only): counts per dept, trend chart, user counts
- User Management: view/create/deactivate the 3 dept admins
- Audit Log: system-wide

### Admin (per dept)
- Dashboard: dept summary, monthly chart, recent activity
- Staff Management: create/deactivate Encoder + Releasing Staff
- ID Template: upload template, configure placeholders
- Audit Log: dept-level

### Staff (Encoder & Releasing Staff — identical permissions)
- Applicant List: search, filter by status, view
- New Applicant: 3-step quick-encode wizard
- Applicant Detail: accordion-based full profile editor
- ID Card View: preview, print, download
- ID Template: can also upload/configure template

---

## Environment Setup

```bash
# Backend (.env): PORT=5000, MONGODB_URI, JWT_SECRET, JWT_REFRESH_SECRET
# Frontend (.env): VITE_API_URL=/api

cd backend && npm run dev     # port 5000
cd frontend && npm run dev    # port 5173, proxies /api → 5000
```

node-canvas (Phase 7 only): requires Python 3 + Windows Build Tools (node-gyp).
Ask user to confirm these are installed before Phase 7.

---

## File Structure

```
mswdo-idms/
├── frontend/
│   ├── vite.config.js          ← proxy /api → localhost:5000
│   ├── index.html              ← Google Fonts preconnect + DM Sans/DM Serif Display
│   ├── src/
│   │   ├── pages/
│   │   │   ├── superadmin/
│   │   │   ├── admin/
│   │   │   └── staff/
│   │   ├── components/
│   │   │   ├── ui/             # shadcn components
│   │   │   ├── layout/         # Sidebar, AppLayout, PageBanner
│   │   │   ├── forms/          # PWDQuickEncodeFields, SoloParentQuickEncodeFields, SeniorCitizenQuickEncodeFields
│   │   │   ├── PhotoEditor.jsx
│   │   │   ├── SignaturePad.jsx
│   │   │   ├── ChildrenForm.jsx
│   │   │   └── ui/BarangayCombobox.jsx
│   │   ├── hooks/
│   │   ├── stores/             # authStore.js, uiStore.js
│   │   ├── services/           # api.js, applicantService.js, userService.js, etc.
│   │   └── lib/
│   │       ├── constants.js    # BARANGAYS(44), PWD_DISABILITY_TYPES(10), SOLO_PARENT_CATEGORIES(12), DEPT_CONFIG
│   │       ├── utils.js        # cn(), computeAge(), formatDate(), getPrimaryId()
│   │       └── validations/    # Zod schemas
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── middleware/         # auth.js, rbac.js, auditLog.js
│   │   ├── models/             # User, Applicant, IDRecord, BlockchainAnchor, IDTemplate, IDTemplateVersion, AuditLog, Sequence, RefreshToken
│   │   ├── services/           # sequences.js, imageProcessing.js, idGeneration.js(Phase7), blockchain.js(Phase11)
│   │   └── app.js
│   ├── scripts/seed.js
│   └── uploads/                # photos/, signatures/, ids/, templates/
│
├── blockchain/chaincode/id-contract.js
├── verification-app/
└── docs/
    ├── MASTER_PLAN.md
    ├── DATABASE_SCHEMA.md
    ├── API_SPEC.md
    ├── FRONTEND_SPEC.md
    ├── UIUX_SPEC.md
    ├── BLOCKCHAIN_SPEC.md
    ├── USER_FLOWS.md
    ├── PROGRESS.md
    └── fields/
        ├── PWD_Complete_Fields.md
        ├── Solo_Parent_Complete_Fields.md
        ├── Senior_Citizen_Complete_Fields.md
        └── ID_Card_Priority_Fields.md
```

---

*Last updated: 2026-05-22 | See PROGRESS.md for build status*