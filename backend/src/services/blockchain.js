'use strict';

const crypto = require('node:crypto');
const { common } = require('@hyperledger/fabric-protos');
const {
  ensureFabricConnected,
  getContract,
  getFabricGeneration,
  getQsccContract,
  markFabricDisconnected,
} = require('../fabric/connect');
const BlockchainAnchor = require('../models/BlockchainAnchor');

const CHANNEL_NAME = process.env.FABRIC_CHANNEL_NAME || 'mychannel';

class ChainStateConflictError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ChainStateConflictError';
    this.code = 'CHAIN_STATE_CONFLICT';
  }
}

class ReceiptRecoveryError extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ReceiptRecoveryError';
    this.code = 'CHAIN_RECEIPT_RECOVERY_FAILED';
  }
}

class ChainCommitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChainCommitError';
    this.code = 'CHAIN_COMMIT_FAILED';
  }
}

// Normalize sex to canonical form. Frontend sends 'Male'/'Female'; some old
// records may have 'M'/'F'. Keep this stable so existing hashes remain valid.
function normalizeSex(value) {
  if (!value) return '';
  const v = value.trim().toUpperCase();
  if (v === 'M' || v === 'MALE') return 'Male';
  if (v === 'F' || v === 'FEMALE') return 'Female';
  return value;
}

// Keys and insertion order are part of the durable public-proof contract.
function buildCanonicalSnapshot(applicant, idRecord) {
  const soloParentIdType = applicant.soloParent?.categoryCode ?? null;
  const snapshot = {
    birthDate: new Date(applicant.birthdate).toISOString().split('T')[0],
    expiryDate: idRecord.expiryDate
      ? new Date(idRecord.expiryDate).toISOString().split('T')[0]
      : null,
    firstName: applicant.firstName.trim().toUpperCase(),
    idType: applicant.department,
    issuedDate: new Date(idRecord.issuedDate).toISOString().split('T')[0],
    issuingOffice: 'MSWDO-GERONA-TARLAC',
    lastName: applicant.lastName.trim().toUpperCase(),
    middleName: applicant.middleName?.trim().toUpperCase() ?? '',
    recordRef: idRecord.idNumber,
    sex: normalizeSex(applicant.sex),
    soloParentIdType,
  };
  return JSON.stringify(snapshot);
}

function computeHash(applicant, idRecord) {
  const canonical = buildCanonicalSnapshot(applicant, idRecord);
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return { hash, canonical };
}

function parseJson(bytes) {
  return JSON.parse(Buffer.from(bytes).toString());
}

async function requireFabric() {
  const availability = await ensureFabricConnected();
  if (!availability.available) {
    const error = new Error('Fabric integration is disabled');
    error.code = 'FABRIC_DISABLED';
    throw error;
  }
}

async function evaluateContract(transactionName, ...args) {
  await requireFabric();
  const originatingGeneration = getFabricGeneration();
  const contract = getContract();
  try {
    const bytes = await contract.evaluateTransaction(transactionName, ...args);
    return parseJson(bytes);
  } catch (error) {
    markFabricDisconnected(error, originatingGeneration);
    throw error;
  }
}

async function verifyIDOnChain(idNumber) {
  return evaluateContract('verifyID', idNumber);
}

function anchorFieldsMatch(outbox, current) {
  const payload = outbox.payload || {};
  const optionalTypeMatches = current.soloParentIdType === payload.soloParentIdType
    || (current.soloParentIdType === null && payload.soloParentIdType === '');

  return current.recordRef === outbox.recordRef
    && current.hash === payload.canonicalHash
    && current.idType === payload.idType
    && optionalTypeMatches
    && current.issuingOffice === payload.issuingOffice;
}

function reconcileDesiredState(outbox, current) {
  const found = Boolean(current && current.found);

  if (outbox.operation === 'ANCHOR') {
    if (!found) return { satisfied: false, conflict: false };
    if (anchorFieldsMatch(outbox, current)) {
      return { satisfied: true, conflict: false };
    }
    return {
      satisfied: false,
      conflict: true,
      reason: `Ledger record ${outbox.recordRef} conflicts with queued ANCHOR payload`,
    };
  }

  if (outbox.operation === 'REVOKE') {
    return { satisfied: found && current.status === 'REVOKED', conflict: false };
  }

  if (outbox.operation === 'EXPIRE') {
    return {
      satisfied: found && (current.status === 'EXPIRED' || current.status === 'REVOKED'),
      conflict: false,
    };
  }

  throw new ChainStateConflictError(`Unsupported chain operation: ${outbox.operation}`);
}

function historyEntrySatisfies(outbox, entry) {
  if (!entry || !entry.txId || !entry.record || entry.isDelete) return false;
  return reconcileDesiredState(outbox, { found: true, ...entry.record }).satisfied;
}

function decodeBlock(bytes, expectedNumber) {
  const serialized = Buffer.from(bytes);
  if (serialized.length === 0) throw new Error('QSCC returned an empty block');

  const block = common.Block.deserializeBinary(serialized);
  const header = block.getHeader();
  if (!header) throw new Error('QSCC block has no header');

  const blockNumber = Number(header.getNumber());
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
    throw new Error('QSCC block number is invalid');
  }
  if (expectedNumber !== undefined && blockNumber !== expectedNumber) {
    throw new Error(`QSCC returned block ${blockNumber}, expected ${expectedNumber}`);
  }
  return { blockNumber, serialized };
}

async function evaluateQscc(transactionName, ...args) {
  const originatingGeneration = getFabricGeneration();
  const contract = getQsccContract();
  try {
    return await contract.evaluateTransaction(transactionName, ...args);
  } catch (error) {
    markFabricDisconnected(error, originatingGeneration);
    throw error;
  }
}

async function getLedgerEpoch() {
  const genesisBytes = await evaluateQscc('GetBlockByNumber', CHANNEL_NAME, '0');
  const { serialized } = decodeBlock(genesisBytes, 0);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

async function recoverReceipt(outbox, current) {
  try {
    const history = await evaluateContract('getIDHistory', outbox.recordRef);
    if (!Array.isArray(history)) throw new Error('Ledger history is not an array');

    const satisfyingEntry = history.find((entry) => historyEntrySatisfies(outbox, entry));
    if (!satisfyingEntry) {
      throw new Error(`No satisfying ledger history entry for ${outbox.operation}`);
    }

    const blockBytes = await evaluateQscc(
      'GetBlockByTxID',
      CHANNEL_NAME,
      satisfyingEntry.txId
    );
    const { blockNumber } = decodeBlock(blockBytes);
    const ledgerEpoch = await getLedgerEpoch();

    return {
      txId: satisfyingEntry.txId,
      blockNumber,
      result: current,
      ledgerEpoch,
      reconciled: true,
    };
  } catch (error) {
    if (error instanceof ReceiptRecoveryError) throw error;
    throw new ReceiptRecoveryError(
      `Unable to recover Fabric receipt for ${outbox.operation} ${outbox.recordRef}`,
      error
    );
  }
}

function submissionFor(outbox) {
  const payload = outbox.payload || {};

  if (outbox.operation === 'ANCHOR') {
    return {
      transactionName: 'issueID',
      arguments: [
        outbox.recordRef,
        payload.idType,
        payload.soloParentIdType ?? '',
        payload.canonicalHash,
        payload.issuingOffice,
      ],
    };
  }
  if (outbox.operation === 'REVOKE') {
    return {
      transactionName: 'revokeID',
      arguments: [outbox.recordRef, payload.reason ?? ''],
    };
  }
  if (outbox.operation === 'EXPIRE') {
    return { transactionName: 'expireID', arguments: [outbox.recordRef] };
  }
  throw new ChainStateConflictError(`Unsupported chain operation: ${outbox.operation}`);
}

async function submitAndValidate(outbox) {
  const submission = submissionFor(outbox);
  const originatingGeneration = getFabricGeneration();
  const contract = getContract();
  let submitted;

  try {
    submitted = await contract.submitAsync(submission.transactionName, {
      arguments: submission.arguments,
    });
    const status = await submitted.getStatus();
    if (!status || status.successful !== true) {
      throw new ChainCommitError(`Fabric transaction for ${outbox.operation} was not committed`);
    }

    const txId = submitted.getTransactionId();
    const blockNumber = Number(status.blockNumber);
    if (!txId || !Number.isSafeInteger(blockNumber) || blockNumber < 0) {
      throw new ChainCommitError(`Fabric transaction receipt for ${outbox.operation} is invalid`);
    }

    const result = parseJson(submitted.getResult());
    const ledgerEpoch = await getLedgerEpoch();
    return { txId, blockNumber, result, ledgerEpoch, reconciled: false };
  } catch (error) {
    if (!(error instanceof ChainCommitError)) {
      markFabricDisconnected(error, originatingGeneration);
    }
    throw error;
  }
}

async function executeChainCommand(outbox) {
  await requireFabric();
  const current = await verifyIDOnChain(outbox.recordRef);
  const reconciled = reconcileDesiredState(outbox, current);

  if (reconciled.satisfied) return recoverReceipt(outbox, current);
  if (reconciled.conflict) throw new ChainStateConflictError(reconciled.reason);
  return submitAndValidate(outbox);
}

async function anchorIDOnChain(applicant, idRecord) {
  const { hash } = computeHash(applicant, idRecord);
  const receipt = await executeChainCommand({
    operation: 'ANCHOR',
    recordRef: idRecord.idNumber,
    payload: {
      canonicalHash: hash,
      idType: applicant.department,
      soloParentIdType: applicant.soloParent?.categoryCode ?? '',
      issuingOffice: 'MSWDO-GERONA-TARLAC',
    },
  });

  const anchor = await BlockchainAnchor.create({
    idRecordId: idRecord._id,
    recordRef: idRecord.idNumber,
    canonicalHash: hash,
    txId: receipt.txId,
    blockNumber: receipt.blockNumber,
    ledgerEpoch: receipt.ledgerEpoch,
    anchoredAt: new Date(),
  });

  return { hash, anchor, ...receipt };
}

async function revokeIDOnChain(idNumber, reason) {
  const receipt = await executeChainCommand({
    operation: 'REVOKE',
    recordRef: idNumber,
    payload: { reason },
  });
  return receipt.result;
}

async function checkIntegrity(applicant, idRecord) {
  const { hash: currentHash } = computeHash(applicant, idRecord);
  const onChain = await verifyIDOnChain(idRecord.idNumber);

  if (!onChain.found) {
    return { verified: false, reason: 'NOT_ON_CHAIN' };
  }
  if (onChain.hash !== currentHash) {
    return {
      verified: false,
      reason: 'HASH_MISMATCH',
      onChainHash: onChain.hash,
      currentHash,
    };
  }
  return { verified: true, onChainStatus: onChain.status, onChain };
}

module.exports = {
  ChainStateConflictError,
  ReceiptRecoveryError,
  anchorIDOnChain,
  checkIntegrity,
  computeHash,
  executeChainCommand,
  reconcileDesiredState,
  recoverReceipt,
  revokeIDOnChain,
  submitAndValidate,
  verifyIDOnChain,
};
