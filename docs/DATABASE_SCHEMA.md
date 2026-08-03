# DATABASE SCHEMA — MSWDO ID Management System

**Database:** MongoDB (via Mongoose)
**Reason for MongoDB:** Flexible schema — easy to add new fields as MSWDO requirements evolve. Each department has significantly different field structures that fit better in a document model.

---

## Collection Overview

```
users              → all system users (superadmin, admin, staff)
refresh_tokens     → JWT refresh tokens
applicants         → base + dept-specific fields in one document
id_records         → issued ID cards (one per applicant)
blockchain_anchors → on-chain hash references
id_templates       → template images + placeholder configs per dept
documents          → uploaded requirement files
audit_logs         → system-wide event log
sequences          → auto-increment counters (for ID number generation)
```

---

## Enums / Constants (define in constants.js)

```js
// Department
DEPARTMENTS = ['PWD', 'SOLO_PARENT', 'SENIOR_CITIZEN']

// User roles
ROLES = ['SUPERADMIN', 'ADMIN', 'ENCODER', 'RELEASING_STAFF']
USER_STATUS = ['ACTIVE', 'INACTIVE', 'SUSPENDED']

// Applicant
APPLICANT_STATUS = ['PARTIAL', 'COMPLETE', 'REVOKED']
RECORD_STATUS = ['ACTIVE', 'EXPIRED', 'REVOKED', 'DECEASED', 'TRANSFERRED']

// ID transaction
ID_TRANSACTION_TYPE = ['New', 'Renew', 'Replace', 'Loss', 'Transfer']

// ID generation
ID_CARD_STATUS = ['ACTIVE', 'EXPIRED', 'REVOKED']

// Common dropdowns
// NOTE: Frontend sends 'Male'/'Female'. 'M'/'F' accepted for backward-compat.
// Canonical blockchain hash always normalizes to 'Male'/'Female' via normalizeSex().
SEX = ['Male', 'Female']  // stored form; model also accepts 'M', 'F'
CIVIL_STATUS = ['Single', 'Married', 'Separated', 'Widow/er', 'Annulled', 'Cohabitation', 'Divorced']

// 44 barangays of Gerona, Tarlac
BARANGAYS = [
  'Abagon','Amacalan','Apsayan','Ayson','Bawa','Buenlag','Bularit','Calayaan',
  'Carbonel','Cardona','Caturay','Danzo','Dicolor','Don Basilio','Luna','Mabini',
  'Magaspac','Malayep','Matapitap','Matayuncab','New Salem','Oloybuaya','Padapada',
  'Parsolingan','Pinasling','Plastado','Poblacion 1','Poblacion 2','Poblacion 3',
  'Quezon','Rizal','Salapungan','San Agustin','San Antonio','San Bartolome',
  'San Jose','Sta. Lucia','Santiago','Sembrano','Singat','Sulipa','Tagumbao',
  'Tangcaran','Villa Paz'
]

// PWD disability types
PWD_DISABILITY_TYPES = [
  '1. Deaf or Hard of Hearing',
  '2. Intellectual Disability',
  '3. Learning Disability',
  '4. Mental Disability',
  '5. Physical Disability (Orthopedic)',
  '6. Psychosocial Disability',
  '7. Speech and Language Impairment',
  '8. Visual Disability',
  '9. Cancer (R.A. 11215)',
  '10. Rare Disease (R.A. 10747)'
]

// Solo Parent category codes (RA 8972 + DILG MC 2023-140)
SOLO_PARENT_CATEGORIES = [
  { code: 'a1', label: 'Consequence of Rape' },
  { code: 'a2', label: 'Widow/Widower' },
  { code: 'a3', label: 'Spouse of PDL (Person Deprived of Liberty)' },
  { code: 'a4', label: 'Spouse of PWD (unable to work)' },
  { code: 'a5', label: 'Separated or de facto separated' },
  { code: 'a6', label: 'Annulled' },
  { code: 'a7', label: 'Abandonment of Spouse' },
  { code: 'b',  label: 'Spouse/Relative of OFW' },
  { code: 'c',  label: 'Unmarried person with child' },
  { code: 'd',  label: 'Legal Guardian / Adoptive / Foster Parent' },
  { code: 'e',  label: 'Relative caring for child' },
  { code: 'f',  label: 'Pregnant woman (no partner)' },
]

// Senior Citizen pension types
PENSION_TYPES = ['socpen','local socpen','SSS','GSIS','PVAO','Socpen/SSS','None']

// Senior Citizen registration category
SC_REGISTRATION_CATEGORY = ['Walk-In', 'Caravan']
```

---

## Mongoose Schemas

### 1. User

```js
const UserSchema = new Schema({
  employeeId:    { type: String },
  firstName:     { type: String, required: true },
  lastName:      { type: String, required: true },
  middleName:    { type: String },
  username:      { type: String, required: true, unique: true },
  email:         { type: String, required: true, unique: true },
  passwordHash:  { type: String, required: true },
  role:          { type: String, enum: ROLES, required: true },
  department:    { type: String, enum: DEPARTMENTS, default: null }, // null for SUPERADMIN
  status:        { type: String, enum: USER_STATUS, default: 'ACTIVE' },
  createdById:   { type: Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });
```

---

### 2. Applicant (unified — department-specific fields embedded)

One document per applicant. Department-specific fields are nested objects.
Only the relevant nested object is populated based on `department`.

```js
const ChildSchema = new Schema({
  lastName:     String,
  firstName:    String,
  middleName:   String,
  birthdate:    Date,
  sex:          { type: String, enum: ['Male', 'Female'] },
  relationship: String   // 'Son', 'Daughter', etc.
}, { _id: false });

const ApplicantSchema = new Schema({
  // ── RECORD IDENTIFICATION ──────────────────────────────
  controlNumber:  { type: String, unique: true },  // auto-generated
  department:     { type: String, enum: DEPARTMENTS, required: true },
  transactionType:{ type: String, enum: ID_TRANSACTION_TYPE, default: 'New' },
  status:         { type: String, enum: APPLICANT_STATUS, default: 'PARTIAL' },
  recordStatus:   { type: String, enum: RECORD_STATUS, default: 'ACTIVE' },
  encodedById:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  completedById:  { type: Schema.Types.ObjectId, ref: 'User' },

  // ── PERSONAL INFO (all depts) ──────────────────────────
  lastName:       { type: String, required: true },
  firstName:      { type: String, required: true },
  middleName:     String,
  extensionName:  { type: String, enum: ['Jr.', 'Sr.', 'II', 'III', ''] },
  birthdate:      { type: Date, required: true },
  // age is always computed — never stored
  sex:            { type: String, enum: ['M', 'F', 'Male', 'Female'] },
  civilStatus:    { type: String, enum: CIVIL_STATUS },
  contactNumber:  String,
  religion:       String,

  // ── ADDRESS ────────────────────────────────────────────
  purokStreet:    String,
  barangay:       { type: String, enum: BARANGAYS },
  municipality:   { type: String, default: 'Gerona' },
  province:       { type: String, default: 'Tarlac' },
  region:         { type: String, default: 'III' },
  birthplace:     String,   // Solo Parent (on ID front), optional others

  // ── PHOTO & SIGNATURE ──────────────────────────────────
  photoPath:      String,   // filesystem path, bg-removed & cropped
  signaturePath:  String,   // filesystem path

  // ── EMERGENCY CONTACT ──────────────────────────────────
  emergencyContactName:    String,
  emergencyContactNumber:  String,
  emergencyContactAddress: String,  // Solo Parent only (on ID back)
  emergencyContactRelation:String,

  // ── PWD-SPECIFIC FIELDS ────────────────────────────────
  pwd: {
    disabilityType:     { type: String, enum: PWD_DISABILITY_TYPES },
    causeOfDisability:  String,
    educationalAttainment: String,
    educationalStatus:  String,
    occupation:         String,
    monthlyIncome:      String,
    availableSkill:     String,
    skillsDesired:      String,
    organization:       String,
    hobbies:            String,
    relationshipToHH:   String,
    uploadedToDOH:      Boolean,
    natFormSubmitted:   Boolean,
    locFormSubmitted:   Boolean,
    servicesAvailed:    String,    // narrative
    needsProblems:      String,    // narrative
    otherFamilyResources: String,  // narrative
  },

  // ── SOLO PARENT-SPECIFIC FIELDS ────────────────────────
  soloParent: {
    psgcCode:           { type: String, default: '0306906000' },
    caseNumber:         String,    // auto-generated YYMM-NNNNNN
    philsysCardNumber:  String,
    categoryCode:       String,    // a1-a7, b, c, d, e, f
    spicNumber:         String,    // auto-generated
    dateSpicIssued:     Date,
    spicStatus:         { type: String, enum: ['New', 'Renewal'] },
    email:              String,
    educationalAttainment: String,
    employmentStatus:   { type: String, enum: ['Employed (Public or Private)', 'Self-employed', 'Not Employed'] },
    occupation:         String,
    monthlyIncome:      String,    // bracket: 'No income', 'minimum wage and below', etc.
    numChildren0to6:    Number,
    numChildren7to22:   Number,
    numChildrenWSN:     Number,
    children:           [ChildSchema],
    pantawidBeneficiary: Boolean,
    indigenousPerson:   String,    // 'No' or tribal name
    lgbtq:              Boolean,
    isPWD:              Boolean,
    isSeniorCitizen:    Boolean,
    // FO fields (optional, used by DSWD Field Office)
    modeOfAdmission:    String,
    psychosocialServices: String,
    referralToAgencies: String,
    remarks:            String,
  },

  // ── SENIOR CITIZEN-SPECIFIC FIELDS ─────────────────────
  seniorCitizen: {
    oscaNumber:         String,    // auto-generated YY-NNNN
    rrn:                String,    // Registry Reference Number
    dateIssued:         Date,
    registrationCategory: { type: String, enum: ['Walk-In', 'Caravan'] },
    idTransactionType:  { type: String, enum: ['New', 'Replace', 'Loss', 'Transfer'] },
    maritalStatus:      String,
    livingStatus:       { type: String, enum: ['Owned', 'Rent', 'Living Alone', 'Living with Relatives'] },
    occupation:         String,
    income:             String,
    medicalCondition:   String,
    medicine:           String,
    isDisabled:         Boolean,
    isPensioner:        Boolean,
    pensionType:        String,    // socpen, SSS, GSIS, PVAO, etc.
    pensionAmount:      Number,
  },

}, { timestamps: true });

// Indexes
ApplicantSchema.index({ department: 1, status: 1 });
ApplicantSchema.index({ lastName: 1, firstName: 1 });
ApplicantSchema.index({ controlNumber: 1 });
ApplicantSchema.index({ 'soloParent.caseNumber': 1 });
ApplicantSchema.index({ 'seniorCitizen.oscaNumber': 1 });
```

---

### 3. IDRecord

```js
const IDRecordSchema = new Schema({
  applicantId:        { type: Schema.Types.ObjectId, ref: 'Applicant', required: true, unique: true },
  department:         { type: String, enum: DEPARTMENTS },
  idNumber:           { type: String, unique: true },   // printed on card
  qrToken:            { type: String, unique: true },   // UUID v4 — in QR code URL
  issuedDate:         { type: Date, default: Date.now },
  expiryDate:         Date,                             // null = no expiry (Senior Citizen)
  status:             { type: String, enum: ID_CARD_STATUS, default: 'ACTIVE' },
  revokedReason:      String,
  revokedAt:          Date,
  revokedById:        { type: Schema.Types.ObjectId, ref: 'User' },
  idImagePath:        String,                           // front side rendered image
  idImageBackPath:    String,                           // back side image (null if no back)
  templateVersionId:  { type: Schema.Types.ObjectId, ref: 'IDTemplateVersion', default: null },
  printCount:         { type: Number, default: 0 },
  lastPrintedAt:      Date,
  reprintCount:       { type: Number, default: 0 },
  lastReprintAt:      Date,
  lastReprintById:    { type: Schema.Types.ObjectId, ref: 'User' },
  reprintHistory:     [{
    reprintedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reprintedAt: { type: Date, default: Date.now },
    reason:      { type: String },
  }],
  releasedAt:         Date,
  releasedById:       { type: Schema.Types.ObjectId, ref: 'User' },
  blockchainAnchorId: { type: Schema.Types.ObjectId, ref: 'BlockchainAnchor' }
}, { timestamps: true });

// qrToken and idNumber have unique:true in field definitions — no separate index needed
```

---

### 4. BlockchainAnchor

```js
const BlockchainAnchorSchema = new Schema({
  idRecordId:     { type: Schema.Types.ObjectId, ref: 'IDRecord', unique: true },
  recordRef:      { type: String, unique: true },  // = idRecord.idNumber
  canonicalHash:  String,   // SHA-256
  txId:           String,   // Hyperledger Fabric transaction ID
  blockNumber:    Number,
  anchoredAt:     { type: Date, default: Date.now },
  lastCheckedAt:  Date,
  lastCheckPassed:Boolean
}, { timestamps: true });
```

---

### 5. IDTemplate + IDTemplateVersion (versioned design)

The template system uses two collections: `IDTemplate` as the department registry
and `IDTemplateVersion` as the versioned snapshot (front + back sides per upload).

```js
// IDTemplate — one document per department; points to active version
const IDTemplateSchema = new Schema({
  department:      { type: String, enum: DEPARTMENTS, required: true, unique: true },
  activeVersionId: { type: Schema.Types.ObjectId, ref: 'IDTemplateVersion', default: null },
}, { timestamps: true });

// IDTemplateVersion — one per upload; stores front AND back in one document
const IDTemplateVersionSchema = new Schema({
  templateId:    { type: Schema.Types.ObjectId, ref: 'IDTemplate', required: true, index: true },
  versionNumber: { type: Number, required: true },
  note:          { type: String, default: '' },
  front: {
    imagePath:         { type: String, default: null },        // PNG file path
    placeholderConfig: { type: Schema.Types.Mixed, default: {} }, // drag-drop config
  },
  back: {
    imagePath:         { type: String, default: null },        // null if dept has no back
    placeholderConfig: { type: Schema.Types.Mixed, default: {} },
  },
  uploadedById: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

IDTemplateVersionSchema.index({ templateId: 1, versionNumber: 1 }, { unique: true });
```

---

### 6. Document

```js
const DocumentSchema = new Schema({
  applicantId:  { type: Schema.Types.ObjectId, ref: 'Applicant', required: true },
  documentType: String,
  fileName:     String,
  filePath:     String,
  mimeType:     String,
  fileSize:     Number,
  uploadedById: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
```

---

### 7. AuditLog

```js
const AuditLogSchema = new Schema({
  userId:      { type: Schema.Types.ObjectId, ref: 'User' },
  action:      { type: String, required: true },
  department:  String,
  targetType:  String,   // 'Applicant', 'IDRecord', 'User', 'IDTemplate'
  targetId:    String,
  description: { type: String, required: true },
  metadata:    Schema.Types.Mixed,
  ipAddress:   String,
  userAgent:   String
}, { timestamps: true });

AuditLogSchema.index({ department: 1 });
AuditLogSchema.index({ action: 1 });
AuditLogSchema.index({ createdAt: -1 });
```

---

### 8. Sequence (for auto-incrementing IDs)

```js
const SequenceSchema = new Schema({
  name:  { type: String, unique: true },  // e.g. 'PWD-2026', 'SC-2026', 'SP-2025-01'
  value: { type: Number, default: 0 }
});
// Use findOneAndUpdate with $inc: { value: 1 } and { new: true, upsert: true }
```

---

## Auto-Generated ID Formats

| Department | Format | Example |
|-----------|--------|---------|
| PWD Control No. | `YYYY-NNN` | `2026-461` |
| PWD ID Number | `03-6906-000-NNNNNNN` | `03-6906-000-0002975` |
| Senior OSCA No. | `YY-NNNN` | `26-0501` |
| Solo Parent Case No. | `YYMM-NNNNNN` | `2605-000001` |
| Solo Parent SPIC | `036906000-YYMM-NNNNNN` | `036906000-2605-000001` |

## ID Card Validity

| Department | Validity |
|-----------|----------|
| PWD | 5 years (per ID card) |
| Solo Parent | 2 years (annual renewal required) — wait, check: SPIC = renewable yearly, card valid 2 years? Confirm with MSWDO |
| Senior Citizen | No expiry (lifetime) |

## Quick Encode Minimum Fields (from ID_Card_Priority_Fields.md)

### PWD (10 fields)
lastName, firstName, middleName, barangay, birthdate, pwd.disabilityType,
photoPath, signaturePath, emergencyContactName, emergencyContactNumber

### Senior Citizen (6 fields — fewest)
lastName, firstName, middleName, barangay, birthdate,
photoPath, signaturePath

### Solo Parent (15+ fields — most complex)
lastName, firstName, middleName, birthdate, birthplace, barangay,
soloParent.categoryCode,
children[0] (fullName, birthdate, relationship),
emergencyContactName, emergencyContactAddress, emergencyContactNumber,
photoPath, signaturePath

---

## Seed Data

```js
// 1 SuperAdmin + 3 Admins created on first run
// Credentials from .env:
//   SEED_SUPERADMIN_USERNAME, SEED_SUPERADMIN_PASSWORD
//   SEED_PWD_ADMIN_USERNAME, SEED_PWD_ADMIN_PASSWORD
//   SEED_SP_ADMIN_USERNAME, SEED_SP_ADMIN_PASSWORD
//   SEED_SC_ADMIN_USERNAME, SEED_SC_ADMIN_PASSWORD
```

---

*See API_SPEC.md for endpoints | See MASTER_PLAN.md for project overview*
