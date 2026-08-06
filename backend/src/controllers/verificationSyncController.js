'use strict';

const {
  buildVerificationSyncStatus,
} = require('../services/verificationOutboxOperations');

async function getVerificationSyncStatus(_req, res, next) {
  try {
    const status = await buildVerificationSyncStatus();
    return res.json(status);
  } catch (error) {
    next(error);
  }
}

module.exports = { getVerificationSyncStatus };
