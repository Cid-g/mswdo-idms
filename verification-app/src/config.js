'use strict';

const { getEd25519PublicKey } = require('./crypto/signatureVerifier');

const DEFAULT_PROTOCOL_AUDIENCE = 'mswdo-verification-service';
const DEFAULT_SYNC_PATH = '/internal/sync';
const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_HTTP_HOST = '0.0.0.0';
const DEFAULT_HTTP_PORT = 3002;
const DEFAULT_MONGODB_DATABASE = 'mswdo_verification';
const DEFAULT_MONGO_SERVER_SELECTION_TIMEOUT_MS = 10_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;
const MAX_PUBLIC_KEY_RING_BYTES = 64 * 1024;
const MAX_PUBLIC_KEYS = 20;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function parsePositiveSafeInteger(value, fallback, name, { max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${name} must be a positive safe integer no greater than ${max}.`);
  }

  return parsed;
}

function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_HTTP_PORT;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  return port;
}

function parseHost(value) {
  const host = value === undefined || value === '' ? DEFAULT_HTTP_HOST : value;
  if (
    typeof host !== 'string'
    || host !== host.trim()
    || host.length > 255
    || /[\u0000-\u001f\u007f]/.test(host)
  ) {
    throw new Error('HOST must be a trimmed host name or IP address.');
  }
  return host;
}

function parseMongoUri(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error('MONGODB_URI is required.');
  }
  if (!/^mongodb(?:\+srv)?:\/\//.test(value) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('MONGODB_URI must use mongodb:// or mongodb+srv://.');
  }
  return value;
}

function parseDatabaseName(value) {
  const name = value === undefined || value === '' ? DEFAULT_MONGODB_DATABASE : value;
  if (typeof name !== 'string' || !DATABASE_NAME_PATTERN.test(name)) {
    throw new Error('VERIFY_MONGODB_DATABASE must be a simple database name up to 64 characters.');
  }
  return name;
}

function loadPublicKeyRing(value) {
  if (typeof value !== 'string' || !value) {
    throw new Error('VERIFY_PUBLIC_KEYS is required.');
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PUBLIC_KEY_RING_BYTES) {
    throw new Error('VERIFY_PUBLIC_KEYS exceeds the supported size.');
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('VERIFY_PUBLIC_KEYS must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('VERIFY_PUBLIC_KEYS must be a JSON object keyed by signing key ID.');
  }

  const entries = Object.entries(parsed);
  if (entries.length < 1 || entries.length > MAX_PUBLIC_KEYS) {
    throw new Error(`VERIFY_PUBLIC_KEYS must contain between 1 and ${MAX_PUBLIC_KEYS} public keys.`);
  }

  const keyRing = Object.create(null);
  for (const [keyId, keyInput] of entries) {
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new Error('VERIFY_PUBLIC_KEYS contains an invalid signing key ID.');
    }
    if (typeof keyInput !== 'string' || !keyInput) {
      throw new Error(`VERIFY_PUBLIC_KEYS entry ${keyId} must be a non-empty public-key string.`);
    }

    try {
      keyRing[keyId] = getEd25519PublicKey({ [keyId]: keyInput }, keyId);
    } catch (error) {
      throw new Error(`VERIFY_PUBLIC_KEYS entry ${keyId} is not a valid Ed25519 public key: ${error.code || error.name}.`);
    }
  }

  return Object.freeze(keyRing);
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

function loadRuntimeConfig(env = process.env) {
  return Object.freeze({
    http: Object.freeze({
      host: parseHost(env.HOST),
      port: parsePort(env.PORT),
      shutdownGraceMs: parsePositiveSafeInteger(
        env.VERIFY_SHUTDOWN_GRACE_MS,
        DEFAULT_SHUTDOWN_GRACE_MS,
        'VERIFY_SHUTDOWN_GRACE_MS',
        { max: 120_000 },
      ),
    }),
    mongo: Object.freeze({
      databaseName: parseDatabaseName(env.VERIFY_MONGODB_DATABASE),
      serverSelectionTimeoutMs: parsePositiveSafeInteger(
        env.VERIFY_MONGO_SERVER_SELECTION_TIMEOUT_MS,
        DEFAULT_MONGO_SERVER_SELECTION_TIMEOUT_MS,
        'VERIFY_MONGO_SERVER_SELECTION_TIMEOUT_MS',
        { max: 120_000 },
      ),
      uri: parseMongoUri(env.MONGODB_URI),
    }),
    protocol: loadProtocolConfig(env),
    publicKeys: loadPublicKeyRing(env.VERIFY_PUBLIC_KEYS),
  });
}

module.exports = {
  DATABASE_NAME_PATTERN,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_MAX_CLOCK_SKEW_MS,
  DEFAULT_MONGODB_DATABASE,
  DEFAULT_MONGO_SERVER_SELECTION_TIMEOUT_MS,
  DEFAULT_PROTOCOL_AUDIENCE,
  DEFAULT_SHUTDOWN_GRACE_MS,
  DEFAULT_SYNC_PATH,
  KEY_ID_PATTERN,
  MAX_PUBLIC_KEYS,
  MAX_PUBLIC_KEY_RING_BYTES,
  loadProtocolConfig,
  loadPublicKeyRing,
  loadRuntimeConfig,
  parseDatabaseName,
  parseHost,
  parseMongoUri,
  parsePort,
  parsePositiveSafeInteger,
};
