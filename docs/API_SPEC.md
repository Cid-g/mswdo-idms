# API SPECIFICATION — MSWDO ID Management System

**Base URL:** `http://localhost:5000/api`  
**Auth:** Bearer JWT token in `Authorization` header  
**Content-Type:** `application/json` (except file uploads: `multipart/form-data`)

---

## Auth Middleware Roles

```
SUPERADMIN  → can access all routes
ADMIN       → can access own department + staff management routes
ENCODER     → can access applicant/ID routes for own department
RELEASING_STAFF → same as ENCODER
```

Role guard shorthand used below:
- `[SA]` = SuperAdmin only
- `[SA, A]` = SuperAdmin or Admin
- `[SA, A, E, RS]` = All roles (any authenticated user)
- `[A, E, RS]` = Admin and Staff (not SuperAdmin)

---

## 1. AUTHENTICATION

### POST `/auth/login`
**Public**  
Login and receive tokens.

**Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response 200:**
```json
{
  "accessToken": "jwt...",
  "refreshToken": "uuid...",
  "user": {
    "id": "uuid",
    "username": "string",
    "firstName": "string",
    "lastName": "string",
    "role": "ADMIN",
    "department": "PWD"
  }
}
```

**Response 401:** Invalid credentials  
**Response 403:** Account suspended/inactive

---

### POST `/auth/refresh`
**Public**  
Get new access token using refresh token.

**Body:**
```json
{ "refreshToken": "uuid..." }
```

**Response 200:** `{ "accessToken": "jwt..." }`  
**Response 401:** Invalid/expired refresh token

---

### POST `/auth/logout`
**[SA, A, E, RS]**  
Invalidate refresh token.

**Body:**
```json
{ "refreshToken": "uuid..." }
```

**Response 200:** `{ "message": "Logged out" }`

---

### GET `/auth/me`
**[SA, A, E, RS]**  
Get current user profile.

**Response 200:** User object (no password)

---

## 2. USER MANAGEMENT

### GET `/users`
**[SA]** — Get all users  
**[A]** — Get only users in own department (staff only)

**Query params:**
- `department` — filter by department (SA only)
- `role` — filter by role
- `status` — ACTIVE | INACTIVE
- `page`, `limit` — pagination

**Response 200:**
```json
{
  "data": [User],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

### POST `/users`
**[SA]** — Create Admin account  
**[A]** — Create Encoder or Releasing Staff in own department

**Body:**
```json
{
  "firstName": "string",
  "lastName": "string",
  "middleName": "string (optional)",
  "username": "string",
  "email": "string",
  "password": "string",
  "role": "ENCODER | RELEASING_STAFF | ADMIN",
  "department": "PWD | SOLO_PARENT | SENIOR_CITIZEN"
}
```

> Admin creating staff: `role` must be `ENCODER` or `RELEASING_STAFF`, `department` auto-set to admin's dept.  
> SuperAdmin creating admin: `role` must be `ADMIN`.

**Response 201:** Created user object (no password)  
**Response 400:** Validation error  
**Response 409:** Username or email already exists

---

### GET `/users/:id`
**[SA, A]**  
Admin can only fetch users in their own department.

**Response 200:** User object

---

### PATCH `/users/:id`
**[SA, A]**  
Update user info (not password, not role).

**Body:** Partial user fields (firstName, lastName, email, status)

**Response 200:** Updated user object

---

### POST `/users/:id/reset-password`
**[SA, A]**  
Admin resets a staff member's password.

**Body:**
```json
{ "newPassword": "string" }
```

**Response 200:** `{ "message": "Password reset successful" }`

---

### PATCH `/users/:id/status`
**[SA, A]**  
Activate or deactivate a user.

**Body:**
```json
{ "status": "ACTIVE | INACTIVE | SUSPENDED" }
```

**Response 200:** Updated user object

---

## 3. DASHBOARD

### GET `/dashboard/superadmin`
**[SA]**  
System-wide summary.

**Response 200:**
```json
{
  "totalCounts": {
    "PWD": { "applicants": 120, "activeIDs": 115, "partial": 5 },
    "SOLO_PARENT": { "applicants": 88, "activeIDs": 85, "partial": 3 },
    "SENIOR_CITIZEN": { "applicants": 200, "activeIDs": 198, "partial": 2 }
  },
  "userCounts": {
    "PWD": { "admin": 1, "encoder": 2, "releasing_staff": 1 },
    "SOLO_PARENT": { "admin": 1, "encoder": 1, "releasing_staff": 1 },
    "SENIOR_CITIZEN": { "admin": 1, "encoder": 3, "releasing_staff": 2 }
  },
  "idTrend": [
    { "month": "2026-01", "PWD": 10, "SOLO_PARENT": 8, "SENIOR_CITIZEN": 15 },
    ...
  ]
}
```

---

### GET `/dashboard/admin`
**[A]**  
Department-level summary for logged-in admin's department.

**Response 200:**
```json
{
  "department": "PWD",
  "totalApplicants": 120,
  "activeIDs": 115,
  "partialRecords": 5,
  "revokedIDs": 2,
  "recentActivity": [AuditLog (last 10)],
  "monthlyTrend": [{ "month": "2026-01", "count": 10 }, ...]
}
```

---

## 4. APPLICANTS

### GET `/applicants`
**[SA, A, E, RS]**  
List applicants. SA sees all; others see own department only.

**Query params:**
- `department`
- `status` — PARTIAL | COMPLETE | REVOKED
- `search` — searches firstName, lastName, controlNumber
- `page`, `limit`

**Response 200:**
```json
{
  "data": [ApplicantSummary],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

---

### POST `/applicants`
**[A, E, RS]**  
Create new applicant (PARTIAL status — minimum info for quick ID issuance).

**Body (minimum required for PARTIAL):**
```json
{
  "lastName": "string",
  "firstName": "string",
  "middleName": "string (optional)",
  "birthdate": "ISO date",
  "barangay": "string (one of 44 Gerona barangays)",

  // Sex is NOT included in quick encode — belongs to complete profile only

  // PWD adds: pwd.disabilityType, emergencyContactName, emergencyContactNumber
  // Solo Parent adds: birthplace, soloParent.categoryCode, children[],
  //                   emergencyContactName, emergencyContactAddress, emergencyContactNumber
  // Senior Citizen: only name + birthdate + barangay needed (6 fields, fewest)
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "controlNumber": "2026-461"  // PWD/SC: YYYY-NNN | Solo Parent case: YYMM-NNNNNN,
  "status": "PARTIAL",
  ...
}
```

---

### GET `/applicants/:id`
**[SA, A, E, RS]**  
Get full applicant details including dept-specific details.

**Response 200:** Full applicant object with pwdDetails / soloParentDetails / seniorCitizenDetails

---

### PATCH `/applicants/:id`
**[A, E, RS]**  
Update applicant info. When all required fields are filled, status auto-changes to COMPLETE and blockchain anchoring is triggered.

**Body:** Any applicant fields to update

**Response 200:** Updated applicant

---

### POST `/applicants/:id/photo`
**[A, E, RS]**  
Upload profile photo. Backend processes: validates → crops (if crop params given) → removes background → saves.

**Content-Type:** `multipart/form-data`  
**Fields:**
- `photo` — image file (JPEG/PNG, max 5MB)
- `cropX`, `cropY`, `cropWidth`, `cropHeight` — optional crop parameters (pixels)

**Response 200:**
```json
{
  "photoPath": "/uploads/photos/applicant-uuid.png",
  "photoUrl": "/api/files/photos/applicant-uuid.png"
}
```

---

### POST `/applicants/:id/signature`
**[A, E, RS]**  
Upload signature. Either drawn (base64 from signature pad) or uploaded image file.

**Body (JSON for drawn signature):**
```json
{
  "signatureBase64": "data:image/png;base64,..."
}
```

OR **multipart/form-data** with `signature` file field.

**Response 200:**
```json
{
  "signaturePath": "/uploads/signatures/applicant-uuid.png"
}
```

---

> **Note:** Document upload endpoints are REMOVED from this system. Document verification is done manually by staff offline before encoding. No digital document storage.

---

## 5. DEPT-SPECIFIC DETAILS

### PATCH `/applicants/:id/pwd-details`
**[A, E, RS]** (PWD dept only)

**Body:** PWD-specific fields (disabilityType, disabilityCause, etc.)

**Response 200:** Updated pwdDetail object

---

### PATCH `/applicants/:id/solo-parent-details`
**[A, E, RS]** (Solo Parent dept only)

**Body:**
```json
{
  "idType": "a1 | a2 | a3 | a4 | a5 | a6 | a7 | b | c | d | e | f",
  "soloParentSince": "ISO date",
  "numberOfChildren": 2,
  "childrenInfo": [...],
  ...
}
```

**Response 200:** Updated soloParentDetail object

---

### PATCH `/applicants/:id/senior-citizen-details`
**[A, E, RS]** (Senior Citizen dept only)

**Response 200:** Updated seniorCitizenDetail object

---

## 6. ID RECORDS (Issuance)

### POST `/id-records`
**[A, E, RS]**  
Generate ID for an applicant. Creates IDRecord, renders ID image from template, generates QR code.

**Body:**
```json
{
  "applicantId": "uuid",
  "expiryDate": "ISO date (optional — auto-set by dept: PWD=+5yr, SoloParent=+2yr, SeniorCitizen=null)"
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "idNumber": "03-6906-000-0002975"  // PWD: 03-6906-000-NNNNNNN | SC: YY-NNNN | SP SPIC: 036906000-YYMM-NNNNNN,
  "qrToken": "uuid-v4",
  "issuedDate": "ISO date",
  "expiryDate": "ISO date",
  "status": "ACTIVE",
  "idImageUrl": "/api/files/ids/id-uuid.png"
}
```

**Response 400:** If applicant already has an active ID  
**Response 400:** If photo not yet uploaded

---

### GET `/id-records/:id`
**[SA, A, E, RS]**  
Get ID record details.

---

### GET `/id-records/:id/image`
**[SA, A, E, RS]**  
Get the rendered ID image (PNG).

**Response:** Image file (PNG)

---

### POST `/id-records/:id/release`
**[A, E, RS]**  
Mark ID as physically released to the applicant.

**Response 200:** Updated IDRecord

---

### POST `/id-records/:id/revoke`
**[SA, A]**  
Revoke an ID.

**Body:**
```json
{ "reason": "string" }
```

**Response 200:** Updated IDRecord. Also triggers blockchain status update.

---

### POST `/id-records/:id/reprint`
**[A, E, RS]**  
Mark ID as reprinted (increments reprintCount).

**Response 200:** Updated IDRecord

---

## 7. ID TEMPLATES

### GET `/templates`
**[SA, A, E, RS]**  
Get current active template for requester's department (or specify `?department=PWD` for SA).

**Response 200:** IDTemplate object with `placeholderConfig`

---

### POST `/templates`
**[A, E, RS]**  
Upload new ID template image and configure placeholders.

**Content-Type:** `multipart/form-data`  
**Fields:**
- `template` — PNG image file (max 20MB)
- `name` — string
- `description` — string (optional)

**Response 201:** IDTemplate object (without placeholderConfig yet — configure next)

---

### PATCH `/templates/:id/config`
**[A, E, RS]**  
Save placeholder configuration for a template (from drag-and-drop editor).

**Body:**
```json
{
  "placeholderConfig": {
    "photo":      { "x": 30,  "y": 40,  "width": 120, "height": 140 },
    "signature":  { "x": 200, "y": 160, "width": 150, "height": 50 },
    "fullName":   { "x": 180, "y": 40,  "fontSize": 14, "color": "#000000", "fontWeight": "bold" },
    "idNumber":   { "x": 180, "y": 60,  "fontSize": 11, "color": "#333333" },
    "birthDate":  { "x": 180, "y": 80,  "fontSize": 10, "color": "#333333" },
    "address":    { "x": 180, "y": 100, "fontSize": 9,  "color": "#333333" },
    "qrCode":     { "x": 330, "y": 140, "width": 80,   "height": 80 },
    "issuedDate": { "x": 180, "y": 130, "fontSize": 9,  "color": "#666666" },
    "expiryDate": { "x": 180, "y": 145, "fontSize": 9,  "color": "#666666" },
    "idType":     { "x": 180, "y": 75,  "fontSize": 10, "color": "#0000aa" }
  }
}
```

**Response 200:** Updated IDTemplate

---

### POST `/templates/:id/preview`
**[A, E, RS]**  
Generate a preview of the template with dummy/sample data.

**Response 200:** PNG image

---

## 8. AUDIT LOGS

### GET `/audit-logs`
**[SA]** — All departments  
**[A]** — Own department only

**Query params:**
- `department`
- `userId`
- `action`
- `targetType`
- `from`, `to` — date range
- `page`, `limit`

**Response 200:**
```json
{
  "data": [AuditLog],
  "total": 500
}
```

---

## 9. FILE SERVING

### GET `/files/:type/:filename`
**[SA, A, E, RS]**  
Serve protected files (photos, signatures, documents, ID images).

Types: `photos`, `signatures`, `documents`, `ids`, `templates`

**Response:** File stream

---

## 10. PUBLIC VERIFICATION (No Auth)

> This is deployed on the **separate cloud verification app**, not the main backend. But the main backend exposes this endpoint too for testing.

### GET `/verify/:token`
**Public**

**Response 200:**
```json
{
  "valid": true,
  "status": "ACTIVE",
  "idType": "PWD",
  "name": "Juan D.",
  "expiryDate": "2029-05-19",
  "issuedBy": "MSWDO Gerona, Tarlac",
  "integrityVerified": true
}
```

**Response 404:** Token not found → `{ "status": "NOT_FOUND" }`  
**Response 200 with status EXPIRED/REVOKED:** Returns status accordingly

---

## 11. BLOCKCHAIN (Internal — called by services, not directly by frontend)

### POST `/blockchain/anchor/:idRecordId`
**[SA, A]** or triggered internally by system on COMPLETE

Anchors the ID record hash on Hyperledger Fabric.

**Response 200:**
```json
{
  "txId": "fabric-tx-id",
  "blockNumber": 42,
  "hash": "sha256-...",
  "anchoredAt": "ISO date"
}
```

---

### GET `/blockchain/verify/:idNumber`
**[SA, A, E, RS]**  
Check integrity of ID record against blockchain.

**Response 200:**
```json
{
  "idNumber": "03-6906-000-0002975"  // PWD: 03-6906-000-NNNNNNN | SC: YY-NNNN | SP SPIC: 036906000-YYMM-NNNNNN,
  "hashMatch": true,
  "onChainStatus": "ACTIVE",
  "anchoredAt": "ISO date",
  "txId": "fabric-tx-id"
}
```

---

## Error Response Format

All errors follow this format:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable message",
    "details": {}
  }
}
```

Common error codes:
- `VALIDATION_ERROR` — 400
- `UNAUTHORIZED` — 401
- `FORBIDDEN` — 403
- `NOT_FOUND` — 404
- `CONFLICT` — 409 (duplicate)
- `INTERNAL_ERROR` — 500

---

## Rate Limits

| Endpoint group | Limit |
|----------------|-------|
| `/auth/login` | 10 req/min per IP |
| `/auth/refresh` | 30 req/min per IP |
| All other routes | 200 req/min per user |
| `/verify/:token` | 60 req/min per IP (public) |

---

*See DATABASE_SCHEMA.md for data models | See FRONTEND_SPEC.md for UI implementation*