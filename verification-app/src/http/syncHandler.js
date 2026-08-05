'use strict';

const { TextDecoder } = require('node:util');
const {
  EnvelopeValidationError,
  MAX_SIGNED_PAYLOAD_BYTES,
} = require('../crypto/canonicalEnvelope');
const {
  SignatureVerificationError,
  verifyRecordSyncRequest,
} = require('../crypto/signatureVerifier');
const { RecordPayloadValidationError } = require('../domain/recordPayload');
const { StoredRecordIntegrityError } = require('../models/verifiedRecord');
const {
  VerifiedRecordConflictError,
  applyVerifiedRecord,
} = require('../services/verifiedRecordStore');

const REQUIRED_HEADERS = Object.freeze([
  'x-key-id',
  'x-signature',
  'x-timestamp',
]);

class SyncHttpError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'SyncHttpError';
    this.code = code;
    this.status = status;
  }
}

function writeJson(res, status, body, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Length': String(payload.length),
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Content-Type': 'application/json; charset=utf-8',
    'Cross-Origin-Resource-Policy': 'same-origin',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(payload);
}

function headerValues(req, lowerName) {
  const values = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index].toLowerCase() === lowerName) {
      values.push(req.rawHeaders[index + 1]);
    }
  }
  return values;
}

function requireSingleHeader(req, lowerName) {
  const values = headerValues(req, lowerName);
  if (values.length !== 1 || typeof values[0] !== 'string' || values[0].length === 0) {
    throw new SyncHttpError(
      `${lowerName} must appear exactly once.`,
      'INVALID_SYNC_HEADERS',
      400,
    );
  }
  return values[0];
}

function validateContentHeaders(req) {
  const contentTypeValues = headerValues(req, 'content-type');
  if (contentTypeValues.length !== 1) {
    throw new SyncHttpError(
      'Content-Type must appear exactly once.',
      'UNSUPPORTED_MEDIA_TYPE',
      415,
    );
  }

  const contentType = contentTypeValues[0].toLowerCase().replace(/\s+/g, '');
  if (contentType !== 'application/json' && contentType !== 'application/json;charset=utf-8') {
    throw new SyncHttpError(
      'Content-Type must be application/json with optional UTF-8 charset.',
      'UNSUPPORTED_MEDIA_TYPE',
      415,
    );
  }

  const encodingValues = headerValues(req, 'content-encoding');
  if (encodingValues.length > 1 || (encodingValues.length === 1 && encodingValues[0].toLowerCase() !== 'identity')) {
    throw new SyncHttpError(
      'Compressed sync requests are not accepted.',
      'UNSUPPORTED_CONTENT_ENCODING',
      415,
    );
  }
}

function parseContentLength(req, maxBytes) {
  const values = headerValues(req, 'content-length');
  if (values.length === 0) return null;
  if (values.length !== 1 || !/^(?:0|[1-9][0-9]*)$/.test(values[0])) {
    throw new SyncHttpError('Content-Length is invalid.', 'INVALID_CONTENT_LENGTH', 400);
  }

  const parsed = Number(values[0]);
  if (!Number.isSafeInteger(parsed)) {
    throw new SyncHttpError('Content-Length is outside the supported range.', 'INVALID_CONTENT_LENGTH', 400);
  }
  if (parsed > maxBytes) {
    throw new SyncHttpError('Signed payload exceeds the accepted size.', 'SYNC_BODY_TOO_LARGE', 413);
  }
  return parsed;
}

async function readSignedPayload(req, maxBytes) {
  const declaredLength = parseContentLength(req, maxBytes);
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) {
      throw new SyncHttpError('Signed payload exceeds the accepted size.', 'SYNC_BODY_TOO_LARGE', 413);
    }
    chunks.push(bytes);
  }

  if (declaredLength !== null && declaredLength !== total) {
    throw new SyncHttpError('Content-Length does not match the received body.', 'CONTENT_LENGTH_MISMATCH', 400);
  }
  if (total === 0) {
    throw new SyncHttpError('Signed payload body is required.', 'EMPTY_SYNC_BODY', 400);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new SyncHttpError('Signed payload must be valid UTF-8.', 'INVALID_UTF8_BODY', 400);
  }
}

function isExpectedSyncError(error) {
  return error instanceof SyncHttpError
    || error instanceof EnvelopeValidationError
    || error instanceof SignatureVerificationError
    || error instanceof RecordPayloadValidationError
    || error instanceof VerifiedRecordConflictError
    || error instanceof StoredRecordIntegrityError;
}

function publicError(error) {
  if (isExpectedSyncError(error)) {
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
        code: 'VERIFICATION_STORE_UNAVAILABLE',
        message: 'Verification persistence is temporarily unavailable.',
      },
    },
  };
}

function validateConstructionOptions({ collection, maxBodyBytes, now, onError, protocolConfig, publicKeys }) {
  if (!collection || typeof collection.findOne !== 'function') {
    throw new TypeError('A Mongo-compatible collection is required.');
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

function createSyncRequestHandler({
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
    path: protocolConfig.syncPath,
    publicKeys,
  });

  return async function syncRequestHandler(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, 'http://verification.internal');
    } catch {
      writeJson(res, 400, { error: { code: 'INVALID_REQUEST_TARGET', message: 'Request target is invalid.' } });
      return;
    }

    if (requestUrl.pathname !== protocolConfig.syncPath || requestUrl.search) {
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
        REQUIRED_HEADERS.map((name) => [name, requireSingleHeader(req, name)]),
      );
      const signedPayload = await readSignedPayload(req, maxBodyBytes);
      const currentTime = now();
      if (!Number.isSafeInteger(currentTime) || currentTime < 1) {
        throw new TypeError('now() must return a positive safe integer timestamp.');
      }

      const verifiedRequest = verifyRecordSyncRequest({
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

      const result = await applyVerifiedRecord({
        collection,
        integrityOptions,
        verifiedRequest,
      });
      const envelope = verifiedRequest.envelope;

      writeJson(res, result.outcome === 'INSERTED' ? 201 : 200, {
        applied: result.applied,
        epoch: envelope.epoch,
        outcome: result.outcome,
        payloadDigest: envelope.payloadDigest,
        revision: envelope.revision,
      });
    } catch (error) {
      const response = publicError(error);
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
  REQUIRED_HEADERS,
  SyncHttpError,
  createSyncRequestHandler,
  headerValues,
  publicError,
  readSignedPayload,
  requireSingleHeader,
  validateContentHeaders,
  writeJson,
};
