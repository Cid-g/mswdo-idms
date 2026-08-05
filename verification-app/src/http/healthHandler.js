'use strict';

const {
  EnvelopeValidationError,
  MAX_SIGNED_PAYLOAD_BYTES,
} = require('../crypto/canonicalEnvelope');
const {
  SignatureVerificationError,
  verifyHealthSyncRequest,
} = require('../crypto/signatureVerifier');
const { SourceHealthIntegrityError } = require('../models/sourceHealth');
const {
  SourceHealthConflictError,
  applySourceHealth,
} = require('../services/sourceHealthStore');
const {
  SyncHttpError,
  readSignedPayload,
  requireSingleHeader,
  validateContentHeaders,
  writeJson,
} = require('./syncHandler');

const REQUIRED_HEALTH_HEADERS = Object.freeze([
  'x-key-id',
  'x-signature',
  'x-timestamp',
]);

function isExpectedHealthError(error) {
  return error instanceof SyncHttpError
    || error instanceof EnvelopeValidationError
    || error instanceof SignatureVerificationError
    || error instanceof SourceHealthConflictError
    || error instanceof SourceHealthIntegrityError;
}

function publicHealthError(error) {
  if (isExpectedHealthError(error)) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
        },
      },
    };
  }

  return {
    status: 503,
    body: {
      error: {
        code: 'SOURCE_HEALTH_STORE_UNAVAILABLE',
        message: 'Source health persistence is temporarily unavailable.',
      },
    },
  };
}

function validateConstructionOptions({ collection, maxBodyBytes, now, onError, protocolConfig, publicKeys }) {
  if (!collection || typeof collection.findOne !== 'function') {
    throw new TypeError('A Mongo-compatible source-health collection is required.');
  }
  if (!protocolConfig || typeof protocolConfig !== 'object') {
    throw new TypeError('protocolConfig is required.');
  }
  if (!publicKeys || (typeof publicKeys !== 'object' && !(publicKeys instanceof Map))) {
    throw new TypeError('publicKeys are required.');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  if (typeof onError !== 'function') throw new TypeError('onError must be a function.');
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > MAX_SIGNED_PAYLOAD_BYTES) {
    throw new TypeError(`maxBodyBytes must be between 1 and ${MAX_SIGNED_PAYLOAD_BYTES}.`);
  }
}

function createHealthRequestHandler({
  collection,
  maxBodyBytes = MAX_SIGNED_PAYLOAD_BYTES,
  now = Date.now,
  onError = () => {},
  protocolConfig,
  publicKeys,
}) {
  validateConstructionOptions({ collection, maxBodyBytes, now, onError, protocolConfig, publicKeys });

  const integrityOptions = Object.freeze({
    audience: protocolConfig.audience,
    path: protocolConfig.healthPath,
    publicKeys,
  });

  return async function healthRequestHandler(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, 'http://verification.internal');
    } catch {
      writeJson(res, 400, { error: { code: 'INVALID_REQUEST_TARGET', message: 'Request target is invalid.' } });
      return;
    }

    if (requestUrl.pathname !== protocolConfig.healthPath || requestUrl.search) {
      writeJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } });
      return;
    }

    if (req.method !== 'POST') {
      writeJson(
        res,
        405,
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is accepted.' } },
        { Allow: 'POST' },
      );
      return;
    }

    try {
      validateContentHeaders(req);
      const headers = Object.fromEntries(
        REQUIRED_HEALTH_HEADERS.map((name) => [name, requireSingleHeader(req, name)]),
      );
      const signedPayload = await readSignedPayload(req, maxBodyBytes);
      const currentTime = now();
      if (!Number.isSafeInteger(currentTime) || currentTime < 1) {
        throw new TypeError('now() must return a positive safe integer timestamp.');
      }

      const verifiedRequest = verifyHealthSyncRequest({
        audience: protocolConfig.audience,
        headerKeyId: headers['x-key-id'],
        headerTimestamp: headers['x-timestamp'],
        maxClockSkewMs: protocolConfig.maxClockSkewMs,
        method: req.method,
        now: currentTime,
        path: requestUrl.pathname,
        publicKeys,
        signatureBase64: headers['x-signature'],
        signedPayload,
      });

      const result = await applySourceHealth({
        collection,
        integrityOptions,
        receivedAt: currentTime,
        verifiedRequest,
      });
      const envelope = verifiedRequest.envelope;

      writeJson(res, result.outcome === 'INSERTED' ? 201 : 200, {
        applied: result.applied,
        epoch: envelope.epoch,
        outcome: result.outcome,
        sourceLastHealthyAt: new Date(envelope.payload.sourceLastHealthyAt).toISOString(),
      });
    } catch (error) {
      const response = publicHealthError(error);
      if (response.status >= 500) {
        try {
          onError(error);
        } catch {
          // Observability hooks must never change the protocol response.
        }
      }
      writeJson(res, response.status, response.body);
    }
  };
}

module.exports = {
  REQUIRED_HEALTH_HEADERS,
  createHealthRequestHandler,
  isExpectedHealthError,
  publicHealthError,
};
