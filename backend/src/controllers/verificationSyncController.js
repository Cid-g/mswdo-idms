'use strict';

const {
  buildVerificationSyncStatus,
  queueFullRecordResynchronization,
  retryFailedVerificationOperation,
} = require('../services/verificationOutboxOperations');

async function getVerificationSyncStatus(_req, res, next) {
  try {
    const status = await buildVerificationSyncStatus();
    return res.json(status);
  } catch (error) {
    next(error);
  }
}

async function resyncVerificationRecord(req, res, next) {
  try {
    const result = await queueFullRecordResynchronization({
      idRecordRef: req.params.idRecordRef,
      request: req.body,
      actor: req.user,
    });
    return res.status(result.queued ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
}

async function retryVerificationSyncOperation(req, res, next) {
  try {
    const result = await retryFailedVerificationOperation({
      operationRef: req.params.operationRef,
      actor: req.user,
    });
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getVerificationSyncStatus,
  resyncVerificationRecord,
  retryVerificationSyncOperation,
};
