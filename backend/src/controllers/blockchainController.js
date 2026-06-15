const Applicant        = require('../models/Applicant');
const IDRecord         = require('../models/IDRecord');
const BlockchainAnchor = require('../models/BlockchainAnchor');
const {
  anchorIDOnChain,
  verifyIDOnChain,
  checkIntegrity,
  computeHash,
} = require('../services/blockchain');

// ── POST /blockchain/anchor/:idRecordId ──────────────────────────────────────
async function anchorRecord(req, res, next) {
  try {
    const idRecord = await IDRecord.findById(req.params.idRecordId);
    if (!idRecord) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ID record not found.' } });
    }

    const existing = await BlockchainAnchor.findOne({ idRecordId: idRecord._id });
    if (existing) {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'This ID record is already anchored on-chain.' } });
    }

    const applicant = await Applicant.findById(idRecord.applicantId);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }

    const { hash, anchor } = await anchorIDOnChain(applicant, idRecord);
    return res.json({ hash, anchor });
  } catch (err) {
    next(err);
  }
}

// ── GET /blockchain/verify/:idNumber ────────────────────────────────────────
async function verifyRecord(req, res, next) {
  try {
    const { idNumber } = req.params;

    const idRecord = await IDRecord.findOne({ idNumber });
    if (!idRecord) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ID record not found in system.' } });
    }

    const applicant = await Applicant.findById(idRecord.applicantId);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }

    // Check if anchored at all
    const anchor = await BlockchainAnchor.findOne({ idRecordId: idRecord._id });
    if (!anchor) {
      return res.json({
        idNumber,
        anchored:    false,
        hashMatch:   null,
        reason:      'NOT_ANCHORED',
        message:     'This record has not been anchored to the blockchain yet.',
      });
    }

    // Offline / Fabric-disabled fallback: recompute hash vs the stored anchor.
    if (process.env.FABRIC_ENABLED !== 'true') {
      const { hash } = computeHash(applicant, idRecord);
      const hashMatch = hash === anchor.canonicalHash;
      return res.json({
        idNumber,
        anchored:   true,
        hashMatch,
        source:     'cached',
        anchoredAt: anchor.anchoredAt,
        reason:     hashMatch ? null : 'HASH_MISMATCH',
      });
    }

    const result = await checkIntegrity(applicant, idRecord);

    await BlockchainAnchor.findByIdAndUpdate(anchor._id, {
      lastCheckedAt:   new Date(),
      lastCheckPassed: result.verified,
    });

    return res.json({
      idNumber,
      anchored:      true,
      hashMatch:     result.verified,
      source:        'live',
      onChainStatus: result.onChainStatus ?? null,
      anchoredAt:    anchor.anchoredAt,
      reason:        result.reason ?? null,
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /blockchain/status/:idRecordId ───────────────────────────────────────
// Lightweight: checks MongoDB only (no chain call) — used by IDCardPage
async function getAnchorStatus(req, res, next) {
  try {
    const anchor = await BlockchainAnchor.findOne({ idRecordId: req.params.idRecordId });
    if (!anchor) {
      return res.json({ anchored: false });
    }
    return res.json({
      anchored:        true,
      canonicalHash:   anchor.canonicalHash,
      txId:            anchor.txId,
      blockNumber:     anchor.blockNumber,
      anchoredAt:      anchor.anchoredAt,
      lastCheckedAt:   anchor.lastCheckedAt,
      lastCheckPassed: anchor.lastCheckPassed,
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /blockchain/health ───────────────────────────────────────────────────
// Drives the connection badge on the super-admin blockchain page.
async function getHealth(req, res, next) {
  try {
    const fabricEnabled = process.env.FABRIC_ENABLED === 'true';
    return res.json({ fabricEnabled, connected: fabricEnabled });
  } catch (err) {
    next(err);
  }
}

// ── GET /blockchain/anchors ──────────────────────────────────────────────────
// List of anchored records for the page's record selector. MongoDB only.
async function listAnchors(req, res, next) {
  try {
    const anchors = await BlockchainAnchor.find().sort({ anchoredAt: -1 }).lean();
    const result = await Promise.all(anchors.map(async (a) => {
      const idRecord  = await IDRecord.findById(a.idRecordId).lean();
      const applicant = idRecord ? await Applicant.findById(idRecord.applicantId).lean() : null;
      return {
        idNumber:        a.recordRef,
        idRecordId:      a.idRecordId,
        applicantName:   applicant ? `${applicant.lastName}, ${applicant.firstName}` : '(unknown)',
        anchoredAt:      a.anchoredAt,
        lastCheckPassed: a.lastCheckPassed ?? null,
      };
    }));
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

// ── GET /blockchain/simulate-tamper/:idNumber?field=<f> ──────────────────────
// Safe, in-memory tamper demo. Clones the applicant, mutates ONE canonical
// field, recomputes the hash, and compares to the stored on-chain hash.
// Never writes to MongoDB. Never calls the chain. Works even when Fabric is off.
// Keys are canonical-snapshot field names (camelCase). Note `birthDate` (key)
// maps to the Mongoose field `birthdate` (lowercase d) inside the mutator.
const TAMPERABLE_FIELDS = {
  birthDate: (a) => {
    const d = new Date(a.birthdate);
    d.setDate(d.getDate() + 1);
    a.birthdate = d;
    return d.toISOString().split('T')[0];
  },
  firstName: (a) => { a.firstName = `${a.firstName}X`; return a.firstName; },
  lastName:  (a) => { a.lastName  = `${a.lastName}X`;  return a.lastName;  },
};

async function simulateTamper(req, res, next) {
  try {
    const { idNumber } = req.params;
    const field = req.query.field || 'birthDate';

    if (!TAMPERABLE_FIELDS[field]) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: `field must be one of: ${Object.keys(TAMPERABLE_FIELDS).join(', ')}` },
      });
    }

    const idRecord = await IDRecord.findOne({ idNumber });
    if (!idRecord) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ID record not found.' } });
    }
    const anchor = await BlockchainAnchor.findOne({ idRecordId: idRecord._id });
    if (!anchor) {
      return res.status(404).json({ error: { code: 'NOT_ANCHORED', message: 'This record is not anchored on-chain.' } });
    }
    const applicant = await Applicant.findById(idRecord.applicantId);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }

    const clone = applicant.toObject();          // in-memory copy — never saved
    const originalValue = field === 'birthDate'
      ? new Date(clone.birthdate).toISOString().split('T')[0]
      : clone[field];

    const tamperedValue = TAMPERABLE_FIELDS[field](clone);
    const { hash: tamperedHash } = computeHash(clone, idRecord);

    return res.json({
      idNumber,
      field,
      originalValue,
      tamperedValue,
      originalHash: anchor.canonicalHash,
      tamperedHash,
      match: tamperedHash === anchor.canonicalHash,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { anchorRecord, verifyRecord, getAnchorStatus, getHealth, listAnchors, simulateTamper };
