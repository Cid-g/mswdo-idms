const IDRecord         = require('../models/IDRecord');
const Applicant        = require('../models/Applicant');
const BlockchainAnchor = require('../models/BlockchainAnchor');

function maskWord(word) {
  if (!word || word.length <= 1) return word;
  return word[0] + '*'.repeat(word.length - 1);
}

function maskName(str) {
  if (!str) return '';
  return str.trim().split(/\s+/).map(maskWord).join(' ');
}

const DEPT_LABEL = {
  PWD:            'Person with Disability (PWD)',
  SOLO_PARENT:    'Solo Parent',
  SENIOR_CITIZEN: 'Senior Citizen',
};

// ── GET /verify/:token ────────────────────────────────────────────────────────
async function verifyByToken(req, res, next) {
  try {
    const { token } = req.params;

    const idRecord = await IDRecord.findOne({ qrToken: token });
    if (!idRecord) {
      return res.status(404).json({
        valid:   false,
        reason:  'NOT_FOUND',
        message: 'No ID record matches this QR code.',
      });
    }

    const applicant = await Applicant.findById(idRecord.applicantId);
    if (!applicant) {
      return res.status(404).json({
        valid:   false,
        reason:  'NOT_FOUND',
        message: 'Applicant record not found.',
      });
    }

    // Masked name — never expose full name on public endpoint
    const maskedName = `${maskName(applicant.lastName)}, ${maskName(applicant.firstName)}`;

    // Blockchain status (MongoDB-only check — fast, no chain call)
    const anchor = await BlockchainAnchor.findOne({ idRecordId: idRecord._id });
    let blockchain = anchor
      ? {
          anchored:    true,
          txId:        anchor.txId   ?? null,
          blockNumber: anchor.blockNumber ?? null,
          anchoredAt:  anchor.anchoredAt,
          hashMatch:   null,
        }
      : { anchored: false };

    // Live integrity check against Fabric ledger (non-fatal)
    if (anchor && process.env.FABRIC_ENABLED === 'true') {
      try {
        const { checkIntegrity } = require('../services/blockchain');
        const result = await checkIntegrity(applicant, idRecord);
        blockchain.hashMatch = result.verified;
      } catch {
        // Fabric unavailable — leave hashMatch null
      }
    }

    // Effective status: treat past-expiry ACTIVE records as EXPIRED
    // (cron job for auto-expiry is future work; this covers it at verification time)
    const isExpiredByDate = idRecord.expiryDate && new Date() > new Date(idRecord.expiryDate);
    const effectiveStatus = (idRecord.status === 'ACTIVE' && isExpiredByDate)
      ? 'EXPIRED'
      : idRecord.status;

    return res.json({
      valid:       effectiveStatus === 'ACTIVE',
      status:      effectiveStatus,
      idType:      idRecord.department,
      idTypeLabel: DEPT_LABEL[idRecord.department] ?? idRecord.department,
      idNumber:    idRecord.idNumber,
      maskedName,
      issuedDate:  idRecord.issuedDate,
      expiryDate:  idRecord.expiryDate   ?? null,
      releasedAt:  idRecord.releasedAt   ?? null,
      revokedReason: idRecord.status === 'REVOKED' ? idRecord.revokedReason : undefined,
      blockchain,
      verifiedAt:  new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { verifyByToken };
