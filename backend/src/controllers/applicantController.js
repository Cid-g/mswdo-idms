const Applicant = require('../models/Applicant');
const {
  nextPWDControlNumber,
  nextOSCANumber,
  nextCaseNumber,
  caseNumberToSPIC,
} = require('../services/sequences');
const {
  processPhoto,
  processSignature,
  processSignatureUpload,
  saveBase64Signature,
  deleteUploadFile,
} = require('../services/imageProcessing');
const { saveApplicantWithAnchorIntent } = require('../services/applicantCompletion');

// ── Age computation — age is NEVER stored ────────────────────────────────
function computeAge(birthdate) {
  if (!birthdate) return null;
  const born = new Date(birthdate);
  const now  = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
  return age;
}

// Serialize: convert Mongoose doc → plain object + add computed age
function serialize(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  if (obj.birthdate) obj.age = computeAge(obj.birthdate);
  return obj;
}

// ── Completeness check — status auto-promotes to COMPLETE ────────────────
// Per DATABASE_SCHEMA.md "Quick Encode Minimum Fields":
// All depts need: photoPath, signaturePath, name, birthdate, barangay.
// Dept-specific requirements below.
function isComplete(a) {
  if (!a.photoPath || !a.signaturePath) return false;
  if (!a.firstName || !a.lastName || !a.birthdate || !a.barangay) return false;

  if (a.department === 'PWD') {
    return !!(a.pwd?.disabilityType && a.emergencyContactName && a.emergencyContactNumber);
  }
  if (a.department === 'SOLO_PARENT') {
    return !!(
      a.birthplace &&
      a.soloParent?.categoryCode &&
      a.soloParent?.children?.length > 0 &&
      a.emergencyContactName &&
      a.emergencyContactAddress &&
      a.emergencyContactNumber
    );
  }
  if (a.department === 'SENIOR_CITIZEN') {
    return true; // base check sufficient
  }
  return false;
}

// ── Base fields allowed in PATCH /applicants/:id ─────────────────────────
const BASE_FIELDS = [
  'firstName', 'lastName', 'middleName', 'extensionName',
  'birthdate', 'sex', 'civilStatus', 'contactNumber', 'religion',
  'purokStreet', 'barangay', 'municipality', 'province', 'region', 'birthplace',
  'emergencyContactName', 'emergencyContactNumber',
  'emergencyContactAddress', 'emergencyContactRelation',
];

// ── POST /applicants ──────────────────────────────────────────────────────
async function createApplicant(req, res, next) {
  try {
    // Dept comes from user's dept (staff/admin) or body (superadmin)
    const dept = req.user.role === 'SUPERADMIN'
      ? req.body.department
      : req.user.department;

    if (!dept) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Department is required.' },
      });
    }
    if (!req.body.firstName || !req.body.lastName || !req.body.birthdate) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'firstName, lastName, and birthdate are required.' },
      });
    }

    // Possible-duplicate detection — WARN, do not block (staff may legitimately
    // have two people with the same name + birthdate, or be re-encoding).
    const esc = (s) => String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dupes = await Applicant.find({
      department: dept,
      firstName:  new RegExp(`^${esc(req.body.firstName)}$`, 'i'),
      lastName:   new RegExp(`^${esc(req.body.lastName)}$`, 'i'),
      birthdate:  new Date(req.body.birthdate),
    }).select('_id firstName lastName controlNumber status').limit(5);

    // Build base document
    const data = {
      department:   dept,
      encodedById:  req.user.id,
      status:       'PARTIAL',
      firstName:    req.body.firstName,
      lastName:     req.body.lastName,
      middleName:   req.body.middleName,
      extensionName:req.body.extensionName,
      birthdate:    req.body.birthdate,
      sex:          req.body.sex,
      civilStatus:  req.body.civilStatus,
      barangay:     req.body.barangay,
      birthplace:   req.body.birthplace,
      purokStreet:  req.body.purokStreet,
      contactNumber:req.body.contactNumber,
      emergencyContactName:     req.body.emergencyContactName,
      emergencyContactNumber:   req.body.emergencyContactNumber,
      emergencyContactAddress:  req.body.emergencyContactAddress,
      emergencyContactRelation: req.body.emergencyContactRelation,
    };

    // ── PWD: generate control number, embed pwd fields ─────────────────
    if (dept === 'PWD') {
      data.controlNumber = await nextPWDControlNumber();
      if (req.body.pwd) data.pwd = req.body.pwd;
    }

    // ── Senior Citizen: generate OSCA number ───────────────────────────
    if (dept === 'SENIOR_CITIZEN') {
      const oscaNumber = await nextOSCANumber();
      const { oscaNumber: _ignore, ...bodySC } = req.body.seniorCitizen ?? {};
      data.seniorCitizen = { ...bodySC, oscaNumber };
    }

    // ── Solo Parent: generate case + SPIC numbers ──────────────────────
    if (dept === 'SOLO_PARENT') {
      const caseNumber = await nextCaseNumber();
      const spicNumber = caseNumberToSPIC(caseNumber);
      const { caseNumber: _cn, spicNumber: _spic, ...bodySP } = req.body.soloParent ?? {};
      data.soloParent = {
        psgcCode: '0306906000',
        ...bodySP,
        caseNumber,
        spicNumber,
      };
    }

    const applicant = await Applicant.create(data);
    const out = serialize(applicant);
    if (dupes.length > 0) {
      out.duplicateWarning = {
        code:    'POSSIBLE_DUPLICATE',
        message: `${dupes.length} existing applicant(s) with the same name and birthdate were found. Please verify this is not a duplicate.`,
        matches: dupes.map((d) => ({
          id:            d._id,
          name:          `${d.lastName}, ${d.firstName}`,
          controlNumber: d.controlNumber ?? null,
          status:        d.status,
        })),
      };
    }
    return res.status(201).json(out);
  } catch (err) {
    next(err);
  }
}

// ── GET /applicants ───────────────────────────────────────────────────────
async function getApplicants(req, res, next) {
  try {
    const { status, search, page = 1, limit = 20, department } = req.query;
    const filter = {};

    // Scope by department (staff/admin see only their dept)
    if (req.user.role === 'SUPERADMIN') {
      if (department) filter.department = department;
    } else {
      filter.department = req.user.department;
    }

    if (status) filter.status = status;

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { firstName: re },
        { lastName:  re },
        { controlNumber: re },
        { 'soloParent.caseNumber': re },
        { 'seniorCitizen.oscaNumber': re },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [docs, total] = await Promise.all([
      Applicant.find(filter)
        .select(
          'lastName firstName middleName birthdate sex barangay status department ' +
          'controlNumber createdAt encodedById ' +
          'soloParent.caseNumber soloParent.spicNumber ' +
          'seniorCitizen.oscaNumber'
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Applicant.countDocuments(filter),
    ]);

    // Bulk-attach ID card status for this page
    const IDRecord = require('../models/IDRecord');
    const ids = docs.map((d) => d._id);
    const idRecords = await IDRecord.find(
      { applicantId: { $in: ids } },
      { applicantId: 1, status: 1, releasedAt: 1, printCount: 1 }
    );
    const idMap = {};
    idRecords.forEach((r) => { idMap[r.applicantId.toString()] = r; });

    return res.json({
      data: docs.map((d) => {
        const obj = serialize(d);
        const r   = idMap[d._id.toString()];
        obj.idCard = r ? {
          status:     r.status,
          isReleased: Boolean(r.releasedAt),
          isPrinted:  (r.printCount || 0) > 0,
        } : null;
        return obj;
      }),
      total,
      page:  parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /applicants/:id ───────────────────────────────────────────────────
async function getApplicantById(req, res, next) {
  try {
    const applicant = await Applicant.findById(req.params.id);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }
    if (req.user.role !== 'SUPERADMIN' && applicant.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }
    return res.json(serialize(applicant));
  } catch (err) {
    next(err);
  }
}

// ── PATCH /applicants/:id (base fields only) ──────────────────────────────
async function updateApplicant(req, res, next) {
  try {
    const applicant = await Applicant.findById(req.params.id);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }
    if (req.user.role !== 'SUPERADMIN' && applicant.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }
    if (applicant.status === 'REVOKED') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Revoked records cannot be edited.' } });
    }

    for (const key of BASE_FIELDS) {
      const val = req.body[key];
      if (val !== undefined && val !== '') applicant[key] = val;
    }

    const wasPartial = applicant.status === 'PARTIAL';
    if (wasPartial && isComplete(applicant)) {
      applicant.status        = 'COMPLETE';
      applicant.completedById = req.user.id;
    }

    await saveApplicantWithAnchorIntent(applicant, wasPartial);
    return res.json(serialize(applicant));
  } catch (err) {
    next(err);
  }
}

// ── PATCH /applicants/:id/pwd-details ────────────────────────────────────
async function updatePwdDetails(req, res, next) {
  try {
    const applicant = await Applicant.findById(req.params.id);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }
    if (applicant.department !== 'PWD') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Applicant is not in the PWD department.' } });
    }
    if (req.user.role !== 'SUPERADMIN' && applicant.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }

    const wasPartial = applicant.status === 'PARTIAL';
    const existing = applicant.pwd?.toObject?.() ?? {};
    const pwdData = Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== ''));
    applicant.pwd = { ...existing, ...pwdData };

    if (wasPartial && isComplete(applicant)) {
      applicant.status        = 'COMPLETE';
      applicant.completedById = req.user.id;
    }

    await saveApplicantWithAnchorIntent(applicant, wasPartial);
    return res.json({ pwd: applicant.pwd, status: applicant.status });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /applicants/:id/solo-parent-details ─────────────────────────────
async function updateSoloParentDetails(req, res, next) {
  try {
    const applicant = await Applicant.findById(req.params.id);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }
    if (applicant.department !== 'SOLO_PARENT') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Applicant is not in the Solo Parent department.' } });
    }
    if (req.user.role !== 'SUPERADMIN' && applicant.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }

    const wasPartial = applicant.status === 'PARTIAL';
    // Protect auto-generated caseNumber and spicNumber
    const { caseNumber: _cn, spicNumber: _spic, ...safeData } = req.body;
    const existing = applicant.soloParent?.toObject?.() ?? {};
    const spData = Object.fromEntries(Object.entries(safeData).filter(([, v]) => v !== ''));
    applicant.soloParent = { ...existing, ...spData };

    if (wasPartial && isComplete(applicant)) {
      applicant.status        = 'COMPLETE';
      applicant.completedById = req.user.id;
    }

    await saveApplicantWithAnchorIntent(applicant, wasPartial);
    return res.json({ soloParent: applicant.soloParent, status: applicant.status });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /applicants/:id/senior-citizen-details ──────────────────────────
async function updateSeniorCitizenDetails(req, res, next) {
  try {
    const applicant = await Applicant.findById(req.params.id);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }
    if (applicant.department !== 'SENIOR_CITIZEN') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Applicant is not in the Senior Citizen department.' } });
    }
    if (req.user.role !== 'SUPERADMIN' && applicant.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }

    const wasPartial = applicant.status === 'PARTIAL';
    // Protect auto-generated oscaNumber
    const { oscaNumber: _on, ...safeData } = req.body;
    const existing = applicant.seniorCitizen?.toObject?.() ?? {};
    const scData = Object.fromEntries(Object.entries(safeData).filter(([, v]) => v !== ''));
    applicant.seniorCitizen = { ...existing, ...scData };

    if (wasPartial && isComplete(applicant)) {
      applicant.status        = 'COMPLETE';
      applicant.completedById = req.user.id;
    }

    await saveApplicantWithAnchorIntent(applicant, wasPartial);
    return res.json({ seniorCitizen: applicant.seniorCitizen, status: applicant.status });
  } catch (err) {
    next(err);
  }
}

// ── POST /applicants/:id/photo ────────────────────────────────────────────────
async function uploadPhoto(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Photo file is required.' } });
    }

    const applicant = await Applicant.findById(req.params.id);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }
    if (req.user.role !== 'SUPERADMIN' && applicant.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }

    const previousPhotoPath = applicant.photoPath;
    const wasPartial = applicant.status === 'PARTIAL';
    const { relPath } = await processPhoto(req.file.buffer);
    applicant.photoPath = relPath;

    if (wasPartial && isComplete(applicant)) {
      applicant.status        = 'COMPLETE';
      applicant.completedById = req.user.id;
    }

    try {
      await saveApplicantWithAnchorIntent(applicant, wasPartial);
    } catch (err) {
      if (relPath !== previousPhotoPath) await deleteUploadFile(relPath);
      throw err;
    }

    if (previousPhotoPath && previousPhotoPath !== relPath) {
      await deleteUploadFile(previousPhotoPath);
    }

    return res.json({
      photoPath: relPath,
      photoUrl:  `/api/files/${relPath}`,
      status:    applicant.status,
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /applicants/:id/signature ────────────────────────────────────────────
async function uploadSignature(req, res, next) {
  try {
    const applicant = await Applicant.findById(req.params.id);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }
    if (req.user.role !== 'SUPERADMIN' && applicant.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }

    const previousSignaturePath = applicant.signaturePath;
    const wasPartial = applicant.status === 'PARTIAL';
    let relPath;

    if (req.body.signatureBase64) {
      // JSON body with base64 data URL (drawn signature)
      const { relPath: rp } = await saveBase64Signature(req.body.signatureBase64);
      relPath = rp;
    } else if (req.file) {
      // Multipart file upload — clean background from scanned/photographed signature
      const { relPath: rp } = await processSignatureUpload(req.file.buffer);
      relPath = rp;
    } else {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Provide signatureBase64 or upload a file.' } });
    }

    applicant.signaturePath = relPath;

    if (wasPartial && isComplete(applicant)) {
      applicant.status        = 'COMPLETE';
      applicant.completedById = req.user.id;
    }

    try {
      await saveApplicantWithAnchorIntent(applicant, wasPartial);
    } catch (err) {
      if (relPath !== previousSignaturePath) await deleteUploadFile(relPath);
      throw err;
    }

    if (previousSignaturePath && previousSignaturePath !== relPath) {
      await deleteUploadFile(previousSignaturePath);
    }

    return res.json({
      signaturePath: relPath,
      signatureUrl:  `/api/files/${relPath}`,
      status:        applicant.status,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createApplicant,
  getApplicants,
  getApplicantById,
  updateApplicant,
  updatePwdDetails,
  updateSoloParentDetails,
  updateSeniorCitizenDetails,
  uploadPhoto,
  uploadSignature,
};
