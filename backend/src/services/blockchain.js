const crypto          = require('crypto');
const { getContract } = require('../fabric/connect');
const BlockchainAnchor = require('../models/BlockchainAnchor');

// ── Normalize sex to canonical form ──────────────────────────────────────────
// Frontend sends 'Male'/'Female'; some old records may have 'M'/'F'.
// Always reduce to 'Male'/'Female' so the hash is stable across both forms.
function normalizeSex(value) {
  if (!value) return '';
  const v = value.trim().toUpperCase();
  if (v === 'M' || v === 'MALE')   return 'Male';
  if (v === 'F' || v === 'FEMALE') return 'Female';
  return value; // unknown — pass through unchanged
}

// ── Canonical snapshot — must be built identically every time ────────────────
// Keys are in alphabetical order (V8/Node preserves insertion order for string
// keys). Never reorder or rename these fields after first deployment — any
// change produces a different hash and breaks existing integrity checks.
function buildCanonicalSnapshot(applicant, idRecord) {
  const soloParentIdType = applicant.soloParent?.categoryCode ?? null;
  const snapshot = {
    birthDate:       new Date(applicant.birthdate).toISOString().split('T')[0],
    expiryDate:      idRecord.expiryDate
                       ? new Date(idRecord.expiryDate).toISOString().split('T')[0]
                       : null,
    firstName:       applicant.firstName.trim().toUpperCase(),
    idType:          applicant.department,
    issuedDate:      new Date(idRecord.issuedDate).toISOString().split('T')[0],
    issuingOffice:   'MSWDO-GERONA-TARLAC',
    lastName:        applicant.lastName.trim().toUpperCase(),
    middleName:      applicant.middleName?.trim().toUpperCase() ?? '',
    recordRef:       idRecord.idNumber,
    sex:             normalizeSex(applicant.sex),
    soloParentIdType,
  };
  return JSON.stringify(snapshot);
}

function computeHash(applicant, idRecord) {
  const canonical = buildCanonicalSnapshot(applicant, idRecord);
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return { hash, canonical };
}

// ── Anchor a new ID on-chain ─────────────────────────────────────────────────
async function anchorIDOnChain(applicant, idRecord) {
  const { hash } = computeHash(applicant, idRecord);
  const contract  = getContract();

  // submitAsync gives access to txId + blockNumber before/after commit
  const submitted = await contract.submitAsync('issueID', {
    arguments: [
      idRecord.idNumber,
      applicant.department,
      applicant.soloParent?.categoryCode ?? '',
      hash,
      'MSWDO-GERONA-TARLAC',
    ],
  });

  const txId       = submitted.getTransactionId();
  const resultBytes = submitted.getResult();
  const result     = JSON.parse(Buffer.from(resultBytes).toString());

  // Wait for block commit and capture block number
  const status      = await submitted.getStatus();
  const blockNumber = Number(status.blockNumber);

  const anchor = await BlockchainAnchor.create({
    idRecordId:    idRecord._id,
    recordRef:     idRecord.idNumber,
    canonicalHash: hash,
    txId,
    blockNumber,
    anchoredAt:    new Date(),
  });

  return { hash, anchor, result, txId, blockNumber };
}

// ── Verify an ID against the ledger ─────────────────────────────────────────
async function verifyIDOnChain(idNumber) {
  const contract    = getContract();
  const resultBytes = await contract.evaluateTransaction('verifyID', idNumber);
  return JSON.parse(Buffer.from(resultBytes).toString());
}

// ── Revoke an ID on-chain ────────────────────────────────────────────────────
async function revokeIDOnChain(idNumber, reason) {
  const contract    = getContract();
  const resultBytes = await contract.submitTransaction('revokeID', idNumber, reason);
  return JSON.parse(Buffer.from(resultBytes).toString());
}

// ── Integrity check: recompute hash and compare with ledger ─────────────────
async function checkIntegrity(applicant, idRecord) {
  const { hash: currentHash } = computeHash(applicant, idRecord);
  const onChain = await verifyIDOnChain(idRecord.idNumber);

  if (!onChain.found) {
    return { verified: false, reason: 'NOT_ON_CHAIN' };
  }
  if (onChain.hash !== currentHash) {
    return { verified: false, reason: 'HASH_MISMATCH', onChainHash: onChain.hash, currentHash };
  }
  return { verified: true, onChainStatus: onChain.status, onChain };
}

module.exports = { anchorIDOnChain, verifyIDOnChain, revokeIDOnChain, checkIntegrity, computeHash };
