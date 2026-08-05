'use strict';

const { SourceHealthIntegrityError } = require('../models/sourceHealth');
const { StoredRecordIntegrityError } = require('../models/verifiedRecord');
const {
  PublicVerificationError,
  hashVerificationToken,
  normalizeVerificationToken,
  verifyPublicToken,
} = require('../services/publicVerification');
const {
  createPublicRateLimiter,
  getRequestClientIp,
} = require('../services/publicRateLimiter');
const { writeJson } = require('./syncHandler');

const PUBLIC_RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, private, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
});

function writeRateLimited(res, result) {
  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  writeJson(
    res,
    429,
    {
      error: {
        code: 'PUBLIC_RATE_LIMITED',
        message: 'Too many verification requests. Please try again later.',
      },
    },
    {
      ...PUBLIC_RESPONSE_HEADERS,
      'Retry-After': String(retryAfterSeconds),
    },
  );
}

function publicCheckError(error) {
  if (error instanceof PublicVerificationError && error.status < 500) {
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

  if (
    error instanceof PublicVerificationError
    || error instanceof StoredRecordIntegrityError
    || error instanceof SourceHealthIntegrityError
  ) {
    return {
      status: 503,
      body: {
        error: {
          code: 'VERIFICATION_INTEGRITY_UNAVAILABLE',
          message: 'Verification evidence is temporarily unavailable.',
        },
      },
    };
  }

  return {
    status: 503,
    body: {
      error: {
        code: 'VERIFICATION_STORE_UNAVAILABLE',
        message: 'Verification service is temporarily unavailable.',
      },
    },
  };
}

function parsePublicToken(requestUrl) {
  const entries = [...requestUrl.searchParams.entries()];
  if (entries.length !== 1 || entries[0][0] !== 'token') {
    throw new PublicVerificationError(
      'Exactly one token query parameter is required.',
      'INVALID_VERIFICATION_QUERY',
      400,
    );
  }
  return entries[0][1];
}

function validateConstructionOptions({
  collection,
  getClientIp,
  healthCollection,
  now,
  onError,
  protocolConfig,
  publicConfig,
  publicKeys,
  rateLimiter,
}) {
  if (!collection || typeof collection.findOne !== 'function') {
    throw new TypeError('A Mongo-compatible verified-record collection is required.');
  }
  if (!healthCollection || typeof healthCollection.findOne !== 'function') {
    throw new TypeError('A Mongo-compatible source-health collection is required.');
  }
  if (!protocolConfig || typeof protocolConfig !== 'object') {
    throw new TypeError('protocolConfig is required.');
  }
  if (!publicConfig || typeof publicConfig !== 'object') {
    throw new TypeError('publicConfig is required.');
  }
  if (!publicKeys || (typeof publicKeys !== 'object' && !(publicKeys instanceof Map))) {
    throw new TypeError('publicKeys are required.');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  if (typeof onError !== 'function') throw new TypeError('onError must be a function.');
  if (!rateLimiter || typeof rateLimiter.consumeIngress !== 'function' || typeof rateLimiter.consumeToken !== 'function') {
    throw new TypeError('rateLimiter must provide consumeIngress and consumeToken.');
  }
  if (typeof getClientIp !== 'function') throw new TypeError('getClientIp must be a function.');
}

function createCheckRequestHandler({
  collection,
  getClientIp = getRequestClientIp,
  healthCollection,
  now = Date.now,
  onError = () => {},
  protocolConfig,
  publicConfig,
  publicKeys,
  rateLimiter = createPublicRateLimiter(publicConfig?.rateLimit),
}) {
  validateConstructionOptions({
    collection,
    getClientIp,
    healthCollection,
    now,
    onError,
    protocolConfig,
    publicConfig,
    publicKeys,
    rateLimiter,
  });

  return async function checkRequestHandler(req, res) {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, 'http://verification.internal');
    } catch {
      writeJson(
        res,
        400,
        { error: { code: 'INVALID_REQUEST_TARGET', message: 'Request target is invalid.' } },
        PUBLIC_RESPONSE_HEADERS,
      );
      return;
    }

    if (requestUrl.pathname !== publicConfig.checkPath) {
      writeJson(
        res,
        404,
        { error: { code: 'NOT_FOUND', message: 'Route not found.' } },
        PUBLIC_RESPONSE_HEADERS,
      );
      return;
    }

    if (req.method !== 'GET') {
      writeJson(
        res,
        405,
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is accepted.' } },
        { ...PUBLIC_RESPONSE_HEADERS, Allow: 'GET' },
      );
      return;
    }

    try {
      const currentTime = now();
      const ingressLimit = rateLimiter.consumeIngress({
        clientIp: getClientIp(req),
        nowMs: currentTime,
      });
      if (!ingressLimit.allowed) {
        writeRateLimited(res, ingressLimit);
        return;
      }

      const rawToken = parsePublicToken(requestUrl);
      const normalizedToken = normalizeVerificationToken(rawToken);
      const tokenLimit = rateLimiter.consumeToken({
        nowMs: currentTime,
        tokenHash: hashVerificationToken(normalizedToken),
      });
      if (!tokenLimit.allowed) {
        writeRateLimited(res, tokenLimit);
        return;
      }

      const result = await verifyPublicToken({
        collection,
        healthCollection,
        healthPath: protocolConfig.healthPath,
        maxSyncAgeMs: publicConfig.maxSyncAgeMs,
        now: () => currentTime,
        publicKeys,
        rawToken: normalizedToken,
        recordAudience: protocolConfig.audience,
        recordPath: protocolConfig.syncPath,
      });
      writeJson(res, result.statusCode, result.body, PUBLIC_RESPONSE_HEADERS);
    } catch (error) {
      const response = publicCheckError(error);
      if (response.status >= 500) {
        try {
          onError(error);
        } catch {
          // Observability hooks must never alter the public response.
        }
      }
      writeJson(res, response.status, response.body, PUBLIC_RESPONSE_HEADERS);
    }
  };
}

module.exports = {
  PUBLIC_RESPONSE_HEADERS,
  createCheckRequestHandler,
  parsePublicToken,
  publicCheckError,
  validateConstructionOptions,
  writeRateLimited,
};
