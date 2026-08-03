# USER FLOWS — MSWDO ID Management System

Detailed step-by-step flows for every major action in the system.

---

## FLOW 1: Login

```
User opens /login
  → enters username + password
  → POST /auth/login
  → success: store accessToken + refreshToken in memory/secure storage
  → redirect based on role:
      SUPERADMIN      → /superadmin/dashboard
      ADMIN           → /admin/dashboard
      ENCODER         → /staff/applicants
      RELEASING_STAFF → /staff/applicants
  → error: show "Invalid username or password"
```

---

## FLOW 2: SuperAdmin — View System Dashboard

```
SuperAdmin navigates to /superadmin/dashboard
  → GET /dashboard/superadmin
  → Display:
      ├── 3 dept summary cards (PWD / Solo Parent / Senior Citizen)
      │     → total applicants, active IDs, partial records
      ├── Line chart: ID issuance trend (last 12 months, 3 lines)
      └── User count table (admin / encoder / releasing staff per dept)
```

---

## FLOW 3: SuperAdmin — Create Admin Account

```
SuperAdmin → /superadmin/users → "Add Admin" button
  → fills form: name, username, email, password, department (PWD/SP/SC)
  → POST /users { role: "ADMIN", department: "..." }
  → success: new admin appears in list, toast "Admin account created"
  → audit log entry: CREATE_USER
```

---

## FLOW 4: Admin — Create Staff Account

```
Admin → /admin/staff → "Add Staff" button
  → fills form: name, username, email, password, role (ENCODER/RELEASING_STAFF)
  → department is auto-set to admin's own department
  → POST /users { role: "ENCODER" | "RELEASING_STAFF", department: auto }
  → success: staff appears in list, toast "Staff account created"
  → audit log entry: CREATE_USER
```

---

## FLOW 5: Admin — Upload ID Template

```
Admin → /admin/templates → "Upload New Template"
  → selects PNG file (ID template with blank placeholder areas)
  → POST /templates (multipart: template file + name)
  → success: redirected to /admin/templates/editor/:id

Template Placeholder Configuration:
  → template image displayed on canvas
  → admin drags boxes/clicks positions for each placeholder:
      PHOTO, SIGNATURE, QR_CODE → drag rectangle (x, y, width, height)
      Text fields → click point + set fontSize, fontColor
  → for Solo Parent: enable ID_TYPE placeholder
  → for PWD: enable DISABILITY_TYPE placeholder
  → "Preview with Sample Data" → POST /templates/:id/preview → shows sample ID
  → "Save Configuration" → PATCH /templates/:id/config
  → toast "Template saved and active"
  → audit log entry: UPLOAD_TEMPLATE
```

---

## FLOW 6: Staff — Quick Encode + Same-Day ID Issuance

**This is the PRIMARY and most-used workflow (speed-optimized for queues)**

```
Staff → /staff/applicants → "New Applicant" button

─── STEP 1: Basic Info ───────────────────────────────────────
  → fills: Last Name, First Name, Middle Name, Suffix, Sex, Birth Date
  → [Solo Parent dept only]: selects Category Code (a1–a7, b, c, d, e, f — with full description shown)
  → clicks "Next"

─── STEP 2: Photo & Signature ───────────────────────────────
  Photo:
    → clicks "Upload Photo" → selects photo file
    → crop tool appears (3:4 aspect ratio lock)
    → adjusts crop → clicks "Remove Background"
    → POST /applicants/:id/photo (with crop params)
    → backend: crops image → removes background (node.js library)
    → shows before/after preview
    → confirms

  Signature:
    → Tab: "Draw Signature"
      → client draws on react-signature-canvas pad
      → clicks "Done"
    OR
    → Tab: "Upload Signature"
      → selects image file

  → clicks "Generate ID Now"

─── SYSTEM PROCESSES ────────────────────────────────────────
  1. POST /applicants → creates record (status: PARTIAL)
  2. POST /applicants/:id/photo → saves processed photo
  3. POST /applicants/:id/signature → saves signature
  4. POST /id-records { applicantId } → generates ID:
       precondition: applicant must have BOTH photoPath AND signaturePath
         (backend returns 400 if either is missing — prevents blank photo/
         signature boxes on the printed card)
       backend:
         a. loads active template for department from DB
         b. loads placeholder config
         c. opens template image with node-canvas
         d. draws photo at PHOTO placeholder zone
         e. draws signature at SIGNATURE placeholder zone
         f. draws all text fields at configured positions
         g. generates QR code (uuid v4 token) → draws at QR_CODE zone
         h. saves final PNG to filesystem
         i. creates IDRecord (status: ACTIVE)
         j. returns idImageUrl, idNumber, qrToken
  5. Redirects to /staff/applicants/:id/id-card

─── ID CARD VIEW ────────────────────────────────────────────
  → shows rendered ID image (full size)
  → "Print" button → opens browser print dialog
  → "Download" button → downloads PNG
  → (optional) "Release" button → marks ID as released

─── LATER: COMPLETE THE RECORD ─────────────────────────────
  → staff returns to /staff/applicants/:id
  → fills remaining fields (address, contact, dept-specific info)
  → each section auto-saves on collapse (PATCH /applicants/:id or dept-details)
  → when ALL required fields are filled, status auto-promotes PARTIAL → COMPLETE
  → blockchain anchoring is triggered AUTOMATICALLY by the backend
    (no separate frontend call):
       backend: applicantController.triggerAnchorIfComplete()
         → only runs if FABRIC_ENABLED=true AND an ACTIVE IDRecord exists
         → computes canonical hash → submits issueID to Hyperledger Fabric
         → stores txId + blockNumber + hash in BlockchainAnchor (non-fatal)
  → audit log entry recorded

Edge case (profile completed BEFORE the ID was generated):
  → the auto-anchor above needs an ACTIVE IDRecord, so it would be skipped;
    instead, createIDRecord anchors immediately when the applicant is already
    COMPLETE (idempotent — skips if already anchored).
  → a manual "Anchor Now" button (POST /blockchain/anchor/:idRecordId,
    ADMIN/SUPERADMIN) also exists as a fallback.
```

---

## FLOW 7: ~~Document Upload~~ — NOT IN SYSTEM

> Document checking is done **manually** by MSWDO staff before they sit at the computer.
> The system does NOT handle document uploads. Staff verify physical requirements offline.

---

## FLOW 8: Staff — Replace Photo or Signature

```
Staff → /staff/applicants/:id → "Photo & Signature" tab
  → "Replace Photo" button
  → [same crop + bg removal flow as FLOW 6]
  → POST /applicants/:id/photo (replaces existing)
  → audit log entry: UPLOAD_PHOTO

  Or:
  → "Replace Signature" button
  → [same draw/upload flow]
  → POST /applicants/:id/signature
```

---

## FLOW 9: Staff — Reprint ID

```
Staff → /staff/applicants/:id → "ID Record" tab
  → "Reprint" button
  → confirmation dialog: "Are you sure? This will be recorded."
  → POST /id-records/:id/reprint
  → reprintCount incremented, lastReprintAt updated
  → audit log entry: REPRINT_ID
  → navigates to /staff/applicants/:id/id-card for printing
```

---

## FLOW 10: Admin — Revoke an ID

```
Admin → /staff/applicants/:id → "ID Record" tab
  → "Revoke ID" button (admin-only, red button)
  → modal asks for reason (text field, required)
  → confirms
  → POST /id-records/:id/revoke { reason }
  → backend:
      a. IDRecord.status → REVOKED (+ revokedReason, revokedAt, revokedById)
      b. if FABRIC_ENABLED: calls blockchain.revokeID(idNumber, reason) (non-fatal)
         → on-chain record status also becomes REVOKED
  → audit log entry: ID_REVOKED
  → QR verification page will now show: 🚫 REVOKED

NOTE — revocation is CARD-LEVEL (IDRecord), not person-level:
  → The Applicant record is intentionally NOT set to REVOKED.
  → This keeps the applicant editable so a REPLACEMENT ID can be issued
    after a card is lost/damaged/revoked (see the partial-unique index on
    IDRecord.applicantId — only ONE ACTIVE id per applicant at a time).
  → APPLICANT_STATUS does include 'REVOKED' as a reserved value for a future
    person-level deactivation feature, but the current revoke flow does not use it.
```

---

## FLOW 11: Verify ID Integrity (Internal)

```
Staff/Admin → /staff/applicants/:id → "ID Record" tab
  → "Verify Blockchain Integrity" button
  → GET /blockchain/verify/:idNumber
  → backend:
      a. fetch applicant + idRecord from DB
      b. compute canonical hash
      c. call chaincode verifyID → get on-chain hash
      d. compare hashes
  → shows result:
      ✅ "Record integrity verified — hash matches blockchain"
      ❌ "WARNING: Hash mismatch — record may have been tampered"
      ⏳ "Not yet anchored on blockchain"
```

---

## FLOW 12: Public QR Verification (External)

```
External verifier (pharmacy, hospital, store) scans QR code on ID
  → QR opens: https://verify.mswdo-gerona.gov.ph/check?token=<uuid>
  → cloud verification page loads
  → GET /verify/<token> (public API)
  → backend:
      a. find IDRecord by qrToken
      b. if not found → show NOT FOUND
      c. if found:
           - check expiry date → if past → EXPIRED
           - check IDRecord.status → if REVOKED → REVOKED
           - fetch applicant
           - compute current hash
           - compare with blockchain hash
      d. return minimal info
  → page displays:
      ✅ VALID
      ❌ EXPIRED
      🚫 REVOKED
      ❓ NOT FOUND
      ⚠️ INTEGRITY WARNING (if hash mismatch)
  → shows: masked name (e.g., "Juan D."), ID type, expiry date, issuing office
  → does NOT show: full address, contact, photo, documents
```

---

## FLOW 13: Audit Log Review

```
SuperAdmin → /superadmin/audit-logs
  → GET /audit-logs (all depts)
  → filter by: date range, department, user, action type
  → paginated table: timestamp | user | action | description | IP
  → "Export CSV" button

Admin → /admin/audit-logs
  → GET /audit-logs (own dept only)
  → same interface, restricted to dept
```

---

## FLOW 14: Token Refresh (Automatic)

```
Frontend axios interceptor:
  → on every API response:
      if 401 Unauthorized:
        → POST /auth/refresh { refreshToken }
        → if success: retry original request with new token
        → if fail (refresh expired):
            → logout() → redirect to /login
```

---

## ID Expiry Rules

| Department | Default Expiry |
|-----------|----------------|
| PWD | 5 years from issuance |
| Solo Parent | 2 years from issuance (renewal via new application) |
| Senior Citizen | No expiry (lifetime — null expiryDate) |

**Expiry is evaluated lazily at verification time (intentional design).**
There is no background cron job that flips records to EXPIRED. Instead, when a
QR code is verified (`GET /verify/:token`), the backend compares `expiryDate`
against the current date and reports `EXPIRED` if past due, even while the
stored `status` is still `ACTIVE`. This guarantees correct public results with
zero scheduler infrastructure. The chaincode `expireID` function exists so a
future scheduled job can also stamp expiry on-chain if needed.

---

## Applicant Status Transitions

```
[NEW]
  ↓ POST /applicants
PARTIAL ─── (all required fields filled) ──→ COMPLETE
  ↓ POST /id-records                              ↓
ID Generated                          Blockchain Anchored
  ↓ POST /id-records/:id/release
ID Released (releasedAt set)

COMPLETE or PARTIAL ──→ REVOKED (admin action)
```

---

## Error Scenarios & Handling

| Scenario | Frontend Response |
|---------|------------------|
| Photo upload fails (too large) | Toast: "File too large. Max 5MB" |
| Background removal fails | Toast: "BG removal failed. You can skip or retry." Show original crop instead |
| Blockchain anchoring fails | Record saved in DB; anchor call is non-fatal (logged + `.catch()`). Status shows "Pending Anchor". No automatic retry — re-anchor manually via the "Anchor Now" button. *(Scheduled auto-retry = future work.)* |
| ID template not configured | Backend returns 400 on "Generate ID": "No active front template…". Frontend shows the error. |
| Fabric network down | Backend does NOT 503. Core flow (encode, generate, print, release) continues normally; blockchain calls fail silently (non-fatal) and status stays "Pending Anchor". With `FABRIC_ENABLED=false`, blockchain is skipped entirely by design. |
| Duplicate applicant (same name + birthdate, same dept) | **Implemented.** Backend returns a `duplicateWarning` object on create (does NOT block); frontend shows a `toast.warning` listing the possible matches. |

---

*See FRONTEND_SPEC.md for UI components | See API_SPEC.md for endpoint details*
