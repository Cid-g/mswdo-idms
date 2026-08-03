const { isDeepStrictEqual } = require('node:util');

const ChainOutbox = require('../models/ChainOutbox');
const IDRecord = require('../models/IDRecord');
const { computeHash } = require('./blockchain');

function operationIdFor(operation, idRecordId) {
  return `${operation.toLowerCase()}:${idRecordId}`;
}

function buildAnchorPayload(applicant, idRecord) {
  const { hash } = computeHash(applicant, idRecord);
  return Object.freeze({
    canonicalHash: hash,
    idType: applicant.department,
    soloParentIdType: applicant.soloParent?.categoryCode ?? '',
    issuingOffice: 'MSWDO-GERONA-TARLAC',
  });
}

function assertSameImmutableCommand(existing, command) {
  const sameCommand = existing.operation === command.operation
    && existing.idRecordId.toString() === command.idRecordId.toString()
    && isDeepStrictEqual(existing.payload, command.payload);

  if (!sameCommand) {
    const error = new Error(`Chain operation ID collision: ${command.operationId}`);
    error.code = 'CHAIN_OPERATION_ID_COLLISION';
    throw error;
  }

  return existing;
}

async function enqueueChainOp({
  session,
  operationId,
  operation,
  idRecordId,
  payload,
}) {
  if (!session || !session.inTransaction()) {
    throw new Error('enqueueChainOp requires an active MongoDB transaction');
  }

  const command = { operationId, operation, idRecordId, payload };
  const existing = await ChainOutbox.findOne({ operationId }).session(session);
  if (existing) return assertSameImmutableCommand(existing, command);

  const idRecord = await IDRecord.findOneAndUpdate(
    { _id: idRecordId },
    { $inc: { chainSequence: 1 } },
    { new: true, session }
  );
  if (!idRecord) {
    throw new Error('ID record not found while enqueueing chain operation');
  }

  const [created] = await ChainOutbox.create([{
    operationId,
    operation,
    idRecordId,
    recordRef: idRecord.idNumber,
    sequence: idRecord.chainSequence,
    payload,
  }], { session });

  return created;
}

module.exports = {
  buildAnchorPayload,
  enqueueChainOp,
  operationIdFor,
};
