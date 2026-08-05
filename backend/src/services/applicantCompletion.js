'use strict';

const IDRecord = require('../models/IDRecord');
const { withMongoTransaction } = require('../lib/transactions');
const {
  buildAnchorPayload,
  enqueueChainOp,
  operationIdFor,
} = require('./chainOutbox');

/**
 * Persist an applicant mutation and, only for a PARTIAL -> COMPLETE transition,
 * atomically record the required blockchain ANCHOR intent.
 *
 * The caller mutates the Mongoose document before calling this function. The
 * applicant save and outbox insert share one replica-set transaction, so neither
 * can commit without the other.
 */
async function saveApplicantWithAnchorIntent(applicant, wasPartial) {
  if (!applicant) throw new Error('Applicant is required');

  return withMongoTransaction(async (session) => {
    await applicant.save({ session });

    if (!wasPartial || applicant.status !== 'COMPLETE') return null;

    const idRecord = await IDRecord.findOne({
      applicantId: applicant._id,
      status: 'ACTIVE',
    }).session(session);

    // Quick-encode permits completing a profile before an ID is generated.
    // The later ID-create producer will enqueue the anchor in that case.
    if (!idRecord) return null;

    return enqueueChainOp({
      session,
      operationId: operationIdFor('ANCHOR', idRecord._id),
      operation: 'ANCHOR',
      idRecordId: idRecord._id,
      payload: buildAnchorPayload(applicant, idRecord),
    });
  });
}

module.exports = { saveApplicantWithAnchorIntent };
