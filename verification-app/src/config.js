'use strict';

const DEFAULT_PROTOCOL_AUDIENCE = 'mswdo-verification-service';
const DEFAULT_SYNC_PATH = '/internal/sync';
const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function parsePositiveSafeInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }

  return parsed;
}

function loadProtocolConfig(env = process.env) {
  const audience = env.VERIFY_PROTOCOL_AUDIENCE || DEFAULT_PROTOCOL_AUDIENCE;
  const syncPath = env.VERIFY_SYNC_PATH || DEFAULT_SYNC_PATH;

  if (typeof audience !== 'string' || !audience.trim() || audience !== audience.trim()) {
    throw new Error('VERIFY_PROTOCOL_AUDIENCE must be a non-empty string.');
  }

  if (
    typeof syncPath !== 'string'
    || !syncPath.startsWith('/')
    || syncPath.includes('?')
    || syncPath !== syncPath.trim()
  ) {
    throw new Error('VERIFY_SYNC_PATH must be an absolute HTTP path without a query string.');
  }

  return Object.freeze({
    audience,
    syncPath,
    maxClockSkewMs: parsePositiveSafeInteger(
      env.VERIFY_MAX_REQUEST_AGE_MS,
      DEFAULT_MAX_CLOCK_SKEW_MS,
      'VERIFY_MAX_REQUEST_AGE_MS',
    ),
  });
}

module.exports = {
  DEFAULT_MAX_CLOCK_SKEW_MS,
  DEFAULT_PROTOCOL_AUDIENCE,
  DEFAULT_SYNC_PATH,
  loadProtocolConfig,
};
