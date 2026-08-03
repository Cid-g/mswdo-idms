# PROGRESS TRACKER — MSWDO ID Management System

**Purpose:** Memory file. Read this at the start of every new Claude Code session.
**Last Updated:** 2026-05-23 (Session 17)
**Author:** Larsen B. Dignos (NEUST MSIT Thesis)

---

## Quick Context

Building a web-based ID management system for MSWDO Gerona, Tarlac.
- 3 departments: PWD, Solo Parent, Senior Citizen
- User roles: SuperAdmin → Admin (per dept) → Encoder / Releasing Staff
- Blockchain: Hyperledger Fabric (hash anchoring only, NOT full database)
- Key feature: ID template system + auto ID generation (replaces manual Photoshop)

Read MASTER_PLAN.md for full context before working on anything.

---

## Build Phases

### PHASE 1: Project Setup & Database ✅ COMPLETE
### PHASE 2: Authentication ✅ COMPLETE
### PHASE 3: User Management ✅ COMPLETE
### PHASE 4: Applicant Encoding ✅ COMPLETE
### PHASE 5: Photo & Signature ✅ COMPLETE

---

### PHASE 6: ID Template System ✅ COMPLETE
> ⚠️ **ARCHITECTURE UPDATE (later refactor):** The template system evolved from a
> single `IDTemplate` doc per `{department, side}` into a **versioned** model:
> one `IDTemplate` per department (`{department unique, activeVersionId}`) that
> points to an `IDTemplateVersion` history. Each version holds BOTH sides inline
> (`front{imagePath, placeholderConfig}`, `back{...}`) plus `versionNumber`.
> The endpoints below reflect the CURRENT code.

- [x] GET /templates?department=X (active template + active version for a dept)
- [x] POST /templates/versions (multipart `frontFile` + `backFile`; body: department, note, useCurrentFront/useCurrentBack) — creates a new version and activates it
- [x] GET /templates/:templateId/versions (version history)
- [x] GET /templates/versions/:versionId (single version)
- [x] PATCH /templates/versions/:versionId/activate (roll back / switch active version)
- [x] PATCH /templates/versions/:versionId/config (body: `side`, `placeholderConfig`; active version only)
- [x] GET /templates/versions/:versionId/preview?side=front|back (raw image)
- [x] IDTemplate model: `{department unique, activeVersionId}`; IDTemplateVersion model: `{templateId, versionNumber, front, back, uploadedById}`, compound unique `{templateId, versionNumber}`
  - ✅ Legacy `department_1` index now auto-dropped at boot by server.js `runMigrations()` — no manual step needed
- [x] Frontend: IDTemplatesPage — two side-by-side cards (Front/Back) for PWD & Solo Parent; single card for Senior Citizen; SuperAdmin gets dept selector
- [x] Frontend: TemplatePlacerEditor — loads a version by ID; defs auto-selected from department + side; back-side placeholder defs for PWD (emergency contact) and Solo Parent (children table)
- [x] Frontend: Preview (blob-fetch → opens in new tab)

### PHASE 7: ID Generation ✅ COMPLETE
Note: Used @napi-rs/canvas instead of node-canvas (prebuilt binary — no Python/Build Tools needed).
- [x] @napi-rs/canvas installed (no prerequisites needed)
- [x] idGeneration.js — canvas rendering + coordinate-based field map + QR code + table rendering
- [x] POST /id-records — generates FRONT (required) + BACK (optional, non-fatal if missing)
- [x] GET /id-records?applicantId=xxx
- [x] GET /id-records/:id/image (front)
- [x] GET /id-records/:id/image/back (back — returns 404 if no back image)
- [x] POST /id-records/:id/release
- [x] POST /id-records/:id/reprint
- [x] IDRecord model: added `idImageBackPath` field
- [x] DEPT_HAS_BACK: { PWD: true, SOLO_PARENT: true, SENIOR_CITIZEN: false }
- [x] Emergency contact fields in buildFields (used on PWD back side)
- [x] Frontend: IDCardPage — front/back tab switcher (shown when back image exists), per-tab download, view/print/release/reprint
- [x] Print stylesheet (85.6mm × 54mm)

### PHASE 8: ID Revocation ✅ COMPLETE
- [x] POST /id-records/:id/revoke — requires reason, all roles, dept-check enforced
- [x] revokeIDRecord handler — sets status=REVOKED, revokedReason, revokedAt, revokedById
- [x] Route uses auditLog middleware (action: ID_REVOKED)
- [x] Frontend: revokeID() service function
- [x] Frontend: Revoke button (danger style, admin/superadmin only, hidden when already REVOKED)
- [x] Frontend: Confirmation modal — required reason textarea, confirm/cancel, loading state
- [x] Frontend: REVOKED status banner on IDCardPage showing reason + date

### PHASE 9: Dashboards ✅ COMPLETE
- [x] GET /dashboard/superadmin
- [x] GET /dashboard/admin
- [x] Frontend: SuperAdmin dashboard (3 dept stat cards + line chart 12mo + donut chart)
- [x] Frontend: Admin dashboard (4 stat cards + bar chart 6mo + real activity feed)

### PHASE 10: Audit Logs ✅ COMPLETE
- [x] GET /audit-logs (with filters: department, userId, action, targetType, from, to, page, limit)
- [x] GET /audit-logs/actions (distinct action codes for filter dropdown)
- [x] CSV export (?export=csv, capped at 10 000 rows)
- [x] auditLogController.js + routes/auditLogs.js
- [x] Frontend: auditLogService.js
- [x] Frontend: AuditLogsView shared component (timeline style, filter panel, pagination)
- [x] Frontend: SuperAdmin AuditLogsPage (all depts, dept filter visible)
- [x] Frontend: Admin AuditLogsPage (own dept only, dept filter hidden)
- [x] Routes wired in App.jsx (/superadmin/audit-logs + /admin/audit-logs)

### PHASE 11: Blockchain Integration ✅ COMPLETE
- [x] Setup Hyperledger Fabric 2.5 test-network in WSL2 (Ubuntu) with Docker Engine
- [x] docker-compose shim: `/usr/local/bin/docker-compose` → `docker compose "$@"`
- [x] Write chaincode: blockchain/chaincode/id-contract.js (issueID, verifyID, revokeID, getIDHistory, expireID)
- [x] Deploy chaincode as `id-contract` on channel `mychannel` (both Org1 + Org2)
- [x] fabric/connect.js — Fabric gateway connection using @hyperledger/fabric-gateway + @grpc/grpc-js
- [x] services/blockchain.js — buildCanonicalSnapshot, computeHash, anchorIDOnChain, verifyIDOnChain, checkIntegrity
- [x] POST /blockchain/anchor/:idRecordId
- [x] GET /blockchain/verify/:idNumber (hits Fabric ledger, updates lastCheckPassed)
- [x] GET /blockchain/status/:idRecordId (MongoDB-only, lightweight)
- [x] Auto-anchor trigger: applicantController promotes PARTIAL→COMPLETE (non-fatal)
- [x] On-chain revoke: idRecordController calls revokeIDOnChain after REVOKED (non-fatal)
- [x] Frontend: blockchainService.js (getBlockchainStatus, verifyIntegrity, anchorRecord)
- [x] Frontend: IDCardPage — BlockchainStatusPanel with real status fetch, Verify Integrity + Anchor Now buttons
- [x] MongoDB installed in WSL2 (7.0 jammy packages on Ubuntu resolute)
- [x] docs/SETUP_GUIDE.md — full setup script + step-by-step guide for new machine
- ✅ FABRIC_PRIVATE_KEY_PATH now auto-updated by scripts/fabric-start.sh — no manual editing needed

### PHASE 12: Public QR Verification App ✅ COMPLETE
- [x] GET /api/verify/:token — public, no auth, returns masked name + status + blockchain info
- [x] verifyController.js — maskName(), DEPT_LABEL map, blockchain anchor check, live integrity check
- [x] routes/verify.js — wired in app.js
- [x] QR code now encodes full URL: VERIFICATION_BASE_URL + ?token=<uuid>
- [x] VERIFICATION_BASE_URL updated to http://localhost:5173/verify in .env
- [x] Frontend: VerificationPage.jsx — standalone public page (no sidebar, no auth)
  - VALID/REVOKED/EXPIRED status banner with color coding
  - Masked name (J*** D***), ID type badge, issued/expiry dates
  - Blockchain integrity section: Anchored/Verified/Mismatch/Pending states
  - TxID + Block # displayed when available
- [x] /verify route added to App.jsx (public, no ProtectedRoute wrapper)
- ⚠️  QR code URL uses localhost:5173 — update VERIFICATION_BASE_URL for production

### PHASE 13: Testing ✅ AUTOMATED TESTS COMPLETE
**Test result: 55/55 passing — 0 failures**
- [x] app.js refactored — startup logic moved to server.js (supertest-compatible)
- [x] jest + supertest + mongodb-memory-server installed as devDependencies
- [x] jest.config.js — testEnvironment: node, setupFiles, fabric-contract-api mock
- [x] tests/envSetup.js — sets NODE_ENV=test, JWT_SECRET, FABRIC_ENABLED=false
- [x] tests/dbHelpers.js — MongoMemoryServer connect/disconnect/clear
- [x] tests/testHelpers.js — createTestUser, getToken helpers
- [x] tests/__mocks__/fabric-contract-api.js — stub for chaincode tests
- [x] tests/unit/chaincode.test.js — issueID, verifyID, revokeID, expireID, getIDHistory (13 tests)
- [x] tests/integration/auth.test.js — login success/fail, inactive, refresh, /me (9 tests)
- [x] tests/integration/applicants.test.js — create, list, get-by-id, update, RBAC (8 tests)
- [x] tests/integration/idRecords.test.js — missing fields, no photo, no template, wrong dept (7 tests)
- [x] tests/integration/verify.test.js — invalid token, valid token, masked name, blockchain badge (5 tests)
- [x] tests/security/rbac.test.js — 401 no-token, 403 wrong role, tampered token, public routes (9 tests)
- [x] Duplicate Mongoose index warnings fixed (Applicant.controlNumber, IDRecord.qrToken/idNumber)
- [ ] User acceptance testing (MSWDO staff)
- [ ] ISO/IEC 25010 evaluation

**Coverage highlights:** auth.js 100% · models 100% · verifyController 72% · authController 80%
Image processing + blockchain service excluded from coverage (hardware-dependent external dependencies).

**Run tests (in WSL2, from backend dir):**
```bash
npm test                 # all 55 tests
npm run test:unit        # chaincode unit tests only
npm run test:integration # API integration tests only
npm run test:security    # RBAC security tests only
npm run test:coverage    # with coverage report
```

---

## Current Status

**Active Phase:** PHASE 13 — Testing (automated tests done; UAT + ISO eval remaining)
**Last Completed:** PHASE 13 automated tests — 55/55 passing (Session 18)
**Next Task:** User Acceptance Testing (MSWDO staff) + ISO/IEC 25010 evaluation

---

## Known Issues / Blockers

- ✅ RESOLVED — IDTemplate index migration is now automatic. `server.js runMigrations()`
  drops the legacy `department_1` index (and the legacy full-unique `applicantId_1`
  on IDRecord) at boot. No manual `dropIndex` step required anymore.
- Note: the template model is now versioned (`IDTemplate` + `IDTemplateVersion`),
  NOT the old `{department, side}` compound — see Phase 6 architecture note.

---

## Decisions Made

| Decision | Choice | Reason |
|----------|--------|--------|
| Database | MongoDB + Mongoose | Flexible schema for evolving govt fields |
| Background removal | Backend (Node.js) | Frontend too slow; try/catch fallback to crop-only |
| Template rendering | node-canvas (Phase 7) | Server-side = consistent output |
| Solo Parent Category Codes | a1–a7, b, c, d, e, f | DILG MC 2023-140 + RA 8972 |
| Blockchain timing | Anchor after COMPLETE | PARTIAL = speed mode; anchor = after full data |
| Encoder vs Releasing Staff | Same permissions | Real-world role distinction only |
| Expiry — PWD | 5 years | "VALID FOR 5 YEARS" on actual ID card |
| Expiry — Solo Parent | 2 years | "+2 years from issue" on actual ID card |
| Expiry — Senior Citizen | No expiry (null) | No expiry date on actual ID card |
| Vite proxy | /api → localhost:5000 | Single baseURL `/api` in axios, proxy in vite.config.js |
| Applicant Detail layout | Accordion (not tabs) | Better for two-phase encoding workflow — incomplete fields auto-expand |
| Age field | Never stored | Always computed from birthdate using computeAge() |
| Quick encode Step 1 | Dept-specific field components | PWD(10 fields), SC(6 fields), SP(15+ fields) |
| Sex field | NOT in quick encode | Belongs to complete profile, not needed for ID generation |
| Document upload | REMOVED — not in system | Documents checked manually by staff offline |
| PWD ID validity | 5 years | Printed on card: "VALID FOR 5 YEARS". Source Excel shows 2yr tracking practice — card text is authoritative. |
| Solo Parent validity | 2 years per card | Needs MSWDO confirmation: card says +2yr but RA 8972 implies annual renewal. Implementation uses 2yr. |
| Civil status options (PWD) | Use 5 source options | PWD source: Single/Married/Separated/Widow-er/Cohabitation. Schema allows more — restrict frontend dropdown to these 5 for PWD. |

---

## Environment Quick Reference

```bash
# ── First-time setup on a NEW device (run once in WSL2) ──
bash scripts/fabric-setup.sh

# ── Daily workflow ────────────────────────────────────────
# 1. Start Fabric (auto-updates .env with new key path)
bash scripts/fabric-start.sh

# 2. Start backend (port 3001) — run from WSL2
cd /mnt/c/Users/guiri/Desktop/FullStack_Projects/mswdo-idms/backend && npm run dev

# 3. Start frontend (port 5173, proxies /api → 3001) — run from Windows terminal
cd frontend && npm run dev

# ── Other ─────────────────────────────────────────────────
# Stop Fabric (sets FABRIC_ENABLED=false in .env)
bash scripts/fabric-stop.sh

# Reseed database
cd backend && npm run seed

# Run tests
cd backend && npm test
```

---

## Important File Locations

```
docs/
  MASTER_PLAN.md       ← START HERE. Tech stack, workflow, all dept fields.
  DATABASE_SCHEMA.md   ← Mongoose schemas
  API_SPEC.md          ← All endpoints
  FRONTEND_SPEC.md     ← Pages, components, routes
  UIUX_SPEC.md         ← Design system (colors, fonts, components)
  BLOCKCHAIN_SPEC.md   ← Chaincode, hash logic
  USER_FLOWS.md        ← Step-by-step flows
  PROGRESS.md          ← THIS FILE
  fields/              ← Source-of-truth field lists per dept (read-only reference)
    PWD_Complete_Fields.md
    Solo_Parent_Complete_Fields.md
    Senior_Citizen_Complete_Fields.md
    ID_Card_Priority_Fields.md
```

---

## Session History Summary

| Session | What was built |
|---------|---------------|
| 1 | Initial planning, MD docs created |
| 2 | DB schema → MongoDB, all dept fields added, UIUX_SPEC created |
| 3 | Phase 1: project setup, all Mongoose models, seed script, Tailwind v4 frontend |
| 4 | Phase 2: auth endpoints, login page, sidebar, route guards |
| 5 | Phase 3: user management endpoints + Manage Admins + Staff pages |
| 6 | Phase 4: applicant encoding endpoints + list/new/detail pages |
| 7 | Phase 5: photo/signature upload + background removal |
| 8 | Phase 3 frontend polish: ManageAdmins full rewrite, StaffPage gradient banner |
| 9 | Dept-specific quick-encode forms: BarangayCombobox, PWD/SP/SC field components |
| 10 | UI audit + doc updates |
| 11 | Phase 6: ID Template System — backend (GET/POST templates, PATCH config, GET preview) + IDTemplatesPage + TemplatePlacerEditor |
| 12 | Phase 7: ID Generation — @napi-rs/canvas, idGeneration.js, idRecordController, routes, IDCardPage (view/print/download/release/reprint) |
| 13 | Front/back extension — IDTemplate.side field + compound index; back generation (PWD+SP); DEPT_HAS_BACK; emergency contact fields; front/back tab switcher in IDCardPage; IDTemplatesPage rewrite with dual side cards; TemplatePlacerEditor now loads by ID with back-side placeholder defs |
| 14 | Phase 8: ID Revocation — revokeIDRecord controller, POST /:id/revoke route (ADMIN_UP + auditLog), revokeID() service, revoke button (danger, admin/SA only), confirmation modal with reason textarea, REVOKED banner on IDCardPage |
| 15 | Phase 9: Dashboards — dashboardController (getSuperadminDashboard + getAdminDashboard), dashboard routes, dashboardService; SuperAdmin dashboard (3 dept stat cards, line chart 12mo, donut user distribution); Admin dashboard (4 stat cards, bar chart 6mo, real activity feed) |
| 16 | Phase 10: Audit Logs — auditLogController (getAuditLogs + getAuditActions), auditLogs route, auditLogService; AuditLogsView (timeline style, filter panel with dept/action/date range, pagination, CSV export); SuperAdmin + Admin AuditLogsPage |
| 17 | Phase 11 fixes + Phase 12: auto-anchor wired to all 6 update paths, txId+blockNumber saved to BlockchainAnchor; public QR verification — GET /api/verify/:token, VerificationPage (VALID/REVOKED/EXPIRED + blockchain badge), QR code now encodes full URL |
| 18 | Phase 13: app.js refactored (startup → server.js); jest+supertest+mongodb-memory-server added; 55 tests 0 failures across 6 test files; Fabric scripts: fabric-start.sh (auto-updates .env), fabric-setup.sh (new device), fabric-stop.sh |

---

*Update this file after every work session.*