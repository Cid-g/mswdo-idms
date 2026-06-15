const mongoose = require('mongoose');
const { Schema } = mongoose;
const {
  DEPARTMENTS,
  APPLICANT_STATUS,
  RECORD_STATUS,
  ID_TRANSACTION_TYPE,
  SEX,
  CIVIL_STATUS,
  BARANGAYS,
  PWD_DISABILITY_TYPES,
  SOLO_PARENT_CATEGORY_CODES,
  EMPLOYMENT_STATUS,
  LIVING_STATUS,
  SC_REGISTRATION_CATEGORY,
  SC_TRANSACTION_TYPE,
} = require('../lib/constants');

const ChildSchema = new Schema(
  {
    lastName:     String,
    firstName:    String,
    middleName:   String,
    birthdate:    Date,
    sex:          { type: String, enum: ['Male', 'Female'] },
    relationship: String, // 'Son', 'Daughter', etc.
  },
  { _id: false }
);

const ApplicantSchema = new Schema(
  {
    // ── RECORD IDENTIFICATION ─────────────────────────────────
    controlNumber:   { type: String, unique: true, sparse: true },
    department:      { type: String, enum: DEPARTMENTS, required: true },
    transactionType: { type: String, enum: ID_TRANSACTION_TYPE, default: 'New' },
    status:          { type: String, enum: APPLICANT_STATUS, default: 'PARTIAL' },
    recordStatus:    { type: String, enum: RECORD_STATUS, default: 'ACTIVE' },
    encodedById:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
    completedById:   { type: Schema.Types.ObjectId, ref: 'User' },

    // ── PERSONAL INFO (all depts) ─────────────────────────────
    lastName:      { type: String, required: true },
    firstName:     { type: String, required: true },
    middleName:    String,
    extensionName: { type: String, enum: ['Jr.', 'Sr.', 'II', 'III', ''] },
    birthdate:     { type: Date, required: true },
    // age is never stored — always computed from birthdate at runtime
    // Frontend sends 'Male'/'Female'. Short forms 'M'/'F' retained for
    // backward-compat. canonical hash always normalizes to 'Male'/'Female'.
    sex:           { type: String, enum: ['Male', 'Female', 'M', 'F'] },
    civilStatus:   { type: String, enum: CIVIL_STATUS },
    contactNumber: String,
    religion:      String,

    // ── ADDRESS ───────────────────────────────────────────────
    purokStreet:  String,
    barangay:     { type: String, enum: BARANGAYS },
    municipality: { type: String, default: 'Gerona' },
    province:     { type: String, default: 'Tarlac' },
    region:       { type: String, default: 'III' },
    birthplace:   String,

    // ── PHOTO & SIGNATURE ─────────────────────────────────────
    photoPath:     String,
    signaturePath: String,

    // ── EMERGENCY CONTACT ─────────────────────────────────────
    emergencyContactName:     String,
    emergencyContactNumber:   String,
    emergencyContactAddress:  String,
    emergencyContactRelation: String,

    // ── PWD-SPECIFIC FIELDS ───────────────────────────────────
    pwd: {
      disabilityType:         { type: String, enum: PWD_DISABILITY_TYPES },
      causeOfDisability:      String,
      educationalAttainment:  String,
      educationalStatus:      String,
      occupation:             String,
      monthlyIncome:          String,
      availableSkill:         String,
      skillsDesired:          String,
      organization:           String,
      hobbies:                String,
      relationshipToHH:       String,
      uploadedToDOH:          Boolean,
      natFormSubmitted:       Boolean,
      locFormSubmitted:       Boolean,
      servicesAvailed:        String,
      needsProblems:          String,
      otherFamilyResources:   String,
    },

    // ── SOLO PARENT-SPECIFIC FIELDS ───────────────────────────
    soloParent: {
      psgcCode:              { type: String, default: '0306906000' },
      caseNumber:            String,
      philsysCardNumber:     String,
      categoryCode:          { type: String, enum: SOLO_PARENT_CATEGORY_CODES },
      spicNumber:            String,
      dateSpicIssued:        Date,
      spicStatus:            { type: String, enum: ['New', 'Renewal'] },
      email:                 String,
      educationalAttainment: String,
      employmentStatus:      { type: String, enum: EMPLOYMENT_STATUS },
      occupation:            String,
      monthlyIncome:         String,
      numChildren0to6:       Number,
      numChildren7to22:      Number,
      numChildrenWSN:        Number,
      children:              [ChildSchema],
      pantawidBeneficiary:   Boolean,
      indigenousPerson:      String,
      lgbtq:                 Boolean,
      isPWD:                 Boolean,
      isSeniorCitizen:       Boolean,
      // ID card field
      benefitCode:           String,
      // FO fields
      modeOfAdmission:       String,
      comBasedAssistance:    String,
      aicsReferral:          String,
      psychosocialServices:  String,
      referralToAgencies:    String,
      remarks:               String,
    },

    // ── SENIOR CITIZEN-SPECIFIC FIELDS ────────────────────────
    seniorCitizen: {
      oscaNumber:            String,
      rrn:                   String,
      dateIssued:            Date,
      registrationCategory:  { type: String, enum: SC_REGISTRATION_CATEGORY },
      idTransactionType:     { type: String, enum: SC_TRANSACTION_TYPE },
      maritalStatus:         String,
      livingStatus:          { type: String, enum: LIVING_STATUS },
      occupation:            String,
      income:                String,
      medicalCondition:      String,
      medicine:              String,
      isDisabled:            Boolean,
      isPensioner:           Boolean,
      pensionType:           String,
      pensionAmount:         Number,
    },
  },
  { timestamps: true }
);

ApplicantSchema.index({ department: 1, status: 1 });
ApplicantSchema.index({ lastName: 1, firstName: 1 });
// controlNumber has unique:true in the field definition — no separate .index() needed
ApplicantSchema.index({ 'soloParent.caseNumber': 1 });
ApplicantSchema.index({ 'seniorCitizen.oscaNumber': 1 });

module.exports = mongoose.model('Applicant', ApplicantSchema);
