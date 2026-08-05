const path = require('path');
const fs   = require('fs');
const { v4: uuidv4 } = require('uuid');

const Applicant         = require('../models/Applicant');
const IDRecord          = require('../models/IDRecord');
const IDTemplate        = require('../models/IDTemplate');
const IDTemplateVersion = require('../models/IDTemplateVersion');
const BlockchainAnchor  = require('../models/BlockchainAnchor');
const ChainOutbox       = require('../models/ChainOutbox');
const { generateIDImage } = require('../services/idGeneration');
const { withMongoTransaction } = require('../lib/transactions');
const { buildAnchorPayload, enqueueChainOp, operationIdFor } = require('../services/chainOutbox');
const { buildVerificationPayload } = require('../services/verificationProjection');
const {
  enqueueVerificationSync,
  verificationOperationIdFor,
} = require('../services/verifyOutbox');
const {
  nextPWDIdNumber,
  nextOSCANumber,
  nextCaseNumber,
  caseNumberToSPIC,
} = require('../services/sequences');

const IDS_DIR = path.resolve(__dirname, '../../uploads/ids');

// Senior Citizen back is fully static text — no variable placeholders, no back generation
const DEPT_HAS_BACK = { PWD: true, SOLO_PARENT: true, SENIOR_CITIZEN: false };

function removeGeneratedIDFile(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[idRecord] Failed to clean generated ID image:', err.message);
    }
  }
}

// Staff/admin may only touch records in their own department. SUPERADMIN bypasses.
function deptForbidden(req, record) {
  return req.user.role !== 'SUPERADMIN' && record.department !== req.user.department;
}

function populateRecord(query) {
  return query
    .populate('reprintHistory.reprintedBy', 'firstName lastName')
    .populate('releasedById',               'firstName lastName')
    .populate('lastReprintById',            'firstName lastName')
    .populate('revokedById',                'firstName lastName');
}

function verificationEpoch() {
  const raw = process.env.VERIFY_EPOCH ?? '1';
  const epoch = Number(raw);
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    const error = new Error('VERIFY_EPOCH must be a positive safe integer.');
    error.code = 'VERIFY_CONFIGURATION_INVALID';
    throw error;
  }
  return epoch;
}

function computeExpiryDate(department) {
  if (department === 'PWD') {
    const d = new Date(); d.setFullYear(d.getFullYear() + 5); return d;
  }
  if (department === 'SOLO_PARENT') {
    const d = new Date(); d.setFullYear(d.getFullYear() + 2); return d;
  }
  return null; // SENIOR_CITIZEN — no expiry
}

// ── POST /id-records ──────────────────────────────────────────────────────────
async function createIDRecord(req, res, next) {
  try {
    const { applicantId } = req.body;
    if (!applicantId) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'applicantId is required.' } });
    }

    const applicant = await Applicant.findById(applicantId);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }

    if (req.user.role !== 'SUPERADMIN' && applicant.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot generate ID for another department.' } });
    }

    if (!applicant.photoPath) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Applicant photo is required before generating an ID.' },
      });
    }

    if (!applicant.signaturePath) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Applicant signature is required before generating an ID.' },
      });
    }

    const existing = await IDRecord.findOne({ applicantId, status: 'ACTIVE' });
    if (existing) {
      return res.status(400).json({ error: { code: 'CONFLICT', message: 'An active ID already exists for this applicant.' } });
    }

    // ── Active template version (required) ────────────────────────────────────
    const template = await IDTemplate.findOne({ department: applicant.department });
    const activeVersion = template?.activeVersionId
      ? await IDTemplateVersion.findById(template.activeVersionId)
      : null;
    if (!activeVersion || !activeVersion.front?.imagePath) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'No active front template for this department. Please upload and configure a front template first.' },
      });
    }
    if (!activeVersion.front.placeholderConfig || Object.keys(activeVersion.front.placeholderConfig).length === 0) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Front template placeholders are not configured. Please configure the front template first.' },
      });
    }
    const frontTemplate = {
      templateImagePath: activeVersion.front.imagePath,
      placeholderConfig: activeVersion.front.placeholderConfig,
    };

    // ── ID number ─────────────────────────────────────────────────────────────
    let idNumber;
    let applicantNeedsSave = false;
    if (applicant.department === 'PWD') {
      idNumber = await nextPWDIdNumber();
    } else if (applicant.department === 'SENIOR_CITIZEN') {
      idNumber = applicant.seniorCitizen?.oscaNumber;
      if (!idNumber) {
        idNumber = await nextOSCANumber();
        if (!applicant.seniorCitizen) applicant.seniorCitizen = {};
        applicant.seniorCitizen.oscaNumber = idNumber;
        applicant.markModified('seniorCitizen');
        applicantNeedsSave = true;
      }
    } else {
      idNumber = applicant.soloParent?.spicNumber;
      if (!idNumber) {
        const caseNum = applicant.soloParent?.caseNumber || await nextCaseNumber();
        idNumber = caseNumberToSPIC(caseNum);
        if (!applicant.soloParent) applicant.soloParent = {};
        if (!applicant.soloParent.caseNumber) applicant.soloParent.caseNumber = caseNum;
        applicant.soloParent.spicNumber = idNumber;
        applicant.markModified('soloParent');
        applicantNeedsSave = true;
      }
    }

    const qrToken    = uuidv4();
    const issuedDate = new Date();
    const expiryDate = computeExpiryDate(applicant.department);
    const idData     = { idNumber, qrToken, issuedDate, expiryDate };

    fs.mkdirSync(IDS_DIR, { recursive: true });

    // ── Generate front ────────────────────────────────────────────────────────
    const { buffer: frontBuf, filename: frontFile } = await generateIDImage(applicant, idData, frontTemplate);
    const idImagePath = path.join(IDS_DIR, frontFile);
    fs.writeFileSync(idImagePath, frontBuf);

    // ── Generate back (optional) ──────────────────────────────────────────────
    let idImageBackPath = null;
    if (DEPT_HAS_BACK[applicant.department] && activeVersion.back?.imagePath
        && Object.keys(activeVersion.back.placeholderConfig || {}).length > 0) {
      const backTemplate = {
        templateImagePath: activeVersion.back.imagePath,
        placeholderConfig: activeVersion.back.placeholderConfig,
      };
      try {
        const { buffer: backBuf, filename: backFile } = await generateIDImage(applicant, idData, backTemplate);
        const generatedBackPath = path.join(IDS_DIR, backFile);
        fs.writeFileSync(generatedBackPath, backBuf);
        idImageBackPath = generatedBackPath;
      } catch (err) {
        console.warn('[idRecord] Back-side generation failed (non-fatal):', err.message);
      }
    }

    // ── Persist business state + durable ANCHOR intent atomically ─────────────
    let idRecord;
    try {
      idRecord = await withMongoTransaction(async (session) => {
        if (applicantNeedsSave) {
          await applicant.save({ session });
        }

        const [created] = await IDRecord.create([{
          applicantId,
          department:        applicant.department,
          idNumber,
          qrToken,
          issuedDate,
          expiryDate,
          status:            'ACTIVE',
          idImagePath,
          idImageBackPath,
          templateVersionId: activeVersion._id,
        }], { session });

        if (applicant.status === 'COMPLETE') {
          const queued = await enqueueChainOp({
            session,
            operationId: operationIdFor('ANCHOR', created._id),
            operation: 'ANCHOR',
            idRecordId: created._id,
            payload: buildAnchorPayload(applicant, created),
          });
          created.chainSequence = queued.sequence;
        }

        const verification = await enqueueVerificationSync({
          session,
          operationId: verificationOperationIdFor('ISSUE', created._id),
          idRecordId: created._id,
          payload: buildVerificationPayload({ applicant, idRecord: created }),
          epoch: verificationEpoch(),
        });
        created.verifyRevision = verification.revision;

        return created;
      });
    } catch (err) {
      // Rendering is intentionally outside the transaction. If persistence
      // fails, remove only the files generated by this request.
      removeGeneratedIDFile(idImagePath);
      removeGeneratedIDFile(idImageBackPath);
      throw err;
    }

    const obj = idRecord.toObject();
    obj.idImageUrl     = `/api/id-records/${idRecord._id}/image`;
    obj.idImageBackUrl = idImageBackPath ? `/api/id-records/${idRecord._id}/image/back` : null;
    return res.status(201).json(obj);
  } catch (err) {
    next(err);
  }
}

// ── GET /id-records?applicantId=xxx ───────────────────────────────────────────
async function listIDRecords(req, res, next) {
  try {
    const { applicantId } = req.query;
    if (!applicantId) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'applicantId query param is required.' } });
    }
    const record = await populateRecord(IDRecord.findOne({ applicantId }).sort({ createdAt: -1 }));
    if (!record) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No ID record found for this applicant.' } });
    }
    if (deptForbidden(req, record)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }
    return res.json(toResponse(record));
  } catch (err) {
    next(err);
  }
}

// ── GET /id-records/:id ───────────────────────────────────────────────────────
async function getIDRecordById(req, res, next) {
  try {
    const record = await populateRecord(IDRecord.findById(req.params.id));
    if (!record) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ID record not found.' } });
    }
    if (deptForbidden(req, record)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }
    return res.json(toResponse(record));
  } catch (err) {
    next(err);
  }
}

function toResponse(record) {
  const obj = record.toObject();
  obj.idImageUrl     = `/api/id-records/${record._id}/image`;
  obj.idImageBackUrl = record.idImageBackPath ? `/api/id-records/${record._id}/image/back` : null;
  return obj;
}

// ── GET /id-records/:id/image (front) ────────────────────────────────────────
async function getIDImage(req, res, next) {
  try {
    const record = await IDRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ID record not found.' } });
    }
    if (deptForbidden(req, record)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }
    if (!record.idImagePath || !fs.existsSync(record.idImagePath)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Front ID image not found.' } });
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(record.idImagePath).pipe(res);
  } catch (err) {
    next(err);
  }
}

// ── GET /id-records/:id/image/back ───────────────────────────────────────────
async function getIDBackImage(req, res, next) {
  try {
    const record = await IDRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ID record not found.' } });
    }
    if (deptForbidden(req, record)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }
    if (!record.idImageBackPath || !fs.existsSync(record.idImageBackPath)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Back ID image not found.' } });
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(record.idImageBackPath).pipe(res);
  } catch (err) {
    next(err);
  }
}

// ── POST /id-records/:id/release ─────────────────────────────────────────────
async function releaseIDRecord(req, res, next) {
  try {
    const record = await IDRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ID record not found.' } });
    if (deptForbidden(req, record)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }
    record.releasedAt   = new Date();
    record.releasedById = req.user.id;
    await record.save();
    const populated = await populateRecord(IDRecord.findById(record._id));
    return res.json(toResponse(populated));
  } catch (err) {
    next(err);
  }
}

// ── POST /id-records/:id/reprint ─────────────────────────────────────────────
async function reprintIDRecord(req, res, next) {
  try {
    const record = await IDRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ID record not found.' } });
    if (deptForbidden(req, record)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }
    const now = new Date();
    record.reprintHistory.push({
      reprintedBy: req.user.id,
      reprintedAt: now,
      reason:      req.body.reason || undefined,
    });
    record.reprintCount    = (record.reprintCount || 0) + 1;
    record.lastReprintAt   = now;
    record.lastReprintById = req.user.id;
    await record.save();
    const populated = await populateRecord(IDRecord.findById(record._id));
    return res.json(toResponse(populated));
  } catch (err) {
    next(err);
  }
}

// ── POST /id-records/:id/revoke ───────────────────────────────────────────────
async function revokeIDRecord(req, res, next) {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'A revocation reason is required.' } });
    }

    const record = await IDRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ID record not found.' } });

    if (record.status === 'REVOKED') {
      return res.status(400).json({ error: { code: 'CONFLICT', message: 'This ID is already revoked.' } });
    }

    if (req.user.role !== 'SUPERADMIN' && record.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot revoke an ID from another department.' } });
    }

    const trimmedReason = reason.trim();
    const now = new Date();

    const { revokedRecord, chainSync } = await withMongoTransaction(async (session) => {
      const updated = await IDRecord.findOneAndUpdate(
        { _id: record._id, status: { $ne: 'REVOKED' } },
        { $set: {
          status: 'REVOKED',
          revokedReason: trimmedReason,
          revokedAt: now,
          revokedById: req.user.id,
        } },
        { new: true, session }
      );

      // A concurrent request may revoke the record after the pre-transaction
      // validation read. Preserve the existing conflict response and do not
      // create a second lifecycle command.
      if (!updated) {
        const conflict = new Error('This ID is already revoked.');
        conflict.status = 400;
        conflict.code = 'CONFLICT';
        throw conflict;
      }

      // Keep transaction operations sequential. Parallel operations on one
      // MongoDB session are unsupported and can fail nondeterministically.
      const anchorReceipt = await BlockchainAnchor
        .exists({ idRecordId: updated._id })
        .session(session);
      const anchorIntent = anchorReceipt
        ? null
        : await ChainOutbox
          .exists({ idRecordId: updated._id, operation: 'ANCHOR' })
          .session(session);

      if (anchorReceipt || anchorIntent) {
        await enqueueChainOp({
          session,
          operationId: operationIdFor('REVOKE', updated._id),
          operation: 'REVOKE',
          idRecordId: updated._id,
          payload: Object.freeze({ reason: trimmedReason }),
        });
        return {
          revokedRecord: updated,
          chainSync: { state: 'PENDING', operation: 'REVOKE' },
        };
      }

      // A PARTIAL card that never entered the ledger cannot be revoked on
      // Fabric. Local revocation remains authoritative and succeeds.
      return {
        revokedRecord: updated,
        chainSync: {
          state: 'NOT_APPLICABLE',
          operation: 'REVOKE',
          reason: 'NEVER_ANCHORED',
        },
      };
    });

    return res.json({ ...toResponse(revokedRecord), chainSync });
  } catch (err) {
    next(err);
  }
}

// ── GET /id-records/print-queue ───────────────────────────────────────────────
// Returns all ACTIVE ID records for the user's department, with applicant info.
async function getPrintQueue(req, res, next) {
  try {
    const filter = { status: 'ACTIVE' };
    if (req.user.role !== 'SUPERADMIN') {
      filter.department = req.user.department;
    } else if (req.query.department) {
      filter.department = req.query.department;
    }

    const records = await IDRecord
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('applicantId', 'firstName lastName middleName');

    return res.json(records.map((r) => ({
      _id:           r._id,
      idNumber:      r.idNumber,
      department:    r.department,
      issuedDate:    r.issuedDate,
      releasedAt:    r.releasedAt    ?? null,
      printCount:    r.printCount    ?? 0,
      lastPrintedAt: r.lastPrintedAt ?? null,
      hasBack:       Boolean(r.idImageBackPath),
      applicant:     r.applicantId
        ? { _id: r.applicantId._id, firstName: r.applicantId.firstName, lastName: r.applicantId.lastName, middleName: r.applicantId.middleName }
        : null,
    })));
  } catch (err) {
    next(err);
  }
}

// ── POST /id-records/batch-log-print ─────────────────────────────────────────
// Called automatically when staff clicks Print. Increments printCount + sets lastPrintedAt.
async function batchLogPrint(req, res, next) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ids array is required.' } });
    }
    const filter = { _id: { $in: ids }, status: 'ACTIVE' };
    if (req.user.role !== 'SUPERADMIN') filter.department = req.user.department;
    await IDRecord.updateMany(filter, {
      $set: { lastPrintedAt: new Date() },
      $inc: { printCount: 1 },
    });
    return res.json({ logged: ids.length });
  } catch (err) {
    next(err);
  }
}

// ── POST /id-records/batch-release ────────────────────────────────────────────
// Bulk-release a list of ID records by their IDs.
async function batchReleaseIDRecords(req, res, next) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ids array is required.' } });
    }

    const filter = { _id: { $in: ids }, status: 'ACTIVE', releasedAt: { $exists: false } };
    if (req.user.role !== 'SUPERADMIN') filter.department = req.user.department;

    const result = await IDRecord.updateMany(filter, {
      $set: { releasedAt: new Date(), releasedById: req.user.id },
    });

    return res.json({ released: result.modifiedCount });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createIDRecord,
  listIDRecords,
  getIDRecordById,
  getIDImage,
  getIDBackImage,
  releaseIDRecord,
  reprintIDRecord,
  revokeIDRecord,
  getPrintQueue,
  batchLogPrint,
  batchReleaseIDRecords,
};
