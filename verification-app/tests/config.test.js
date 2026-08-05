'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_MAX_CLOCK_SKEW_MS,
  DEFAULT_PROTOCOL_AUDIENCE,
  DEFAULT_SYNC_PATH,
  loadProtocolConfig,
} = require('../src/config');

test('loads safe protocol defaults without environment secrets', () => {
  assert.deepEqual(loadProtocolConfig({}), {
    audience: DEFAULT_PROTOCOL_AUDIENCE,
    syncPath: DEFAULT_SYNC_PATH,
    maxClockSkewMs: DEFAULT_MAX_CLOCK_SKEW_MS,
  });
});

test('accepts explicit audience, path, and replay window configuration', () => {
  assert.deepEqual(loadProtocolConfig({
    VERIFY_PROTOCOL_AUDIENCE: 'verify.staging.example',
    VERIFY_SYNC_PATH: '/v1/internal/sync',
    VERIFY_MAX_REQUEST_AGE_MS: '120000',
  }), {
    audience: 'verify.staging.example',
    syncPath: '/v1/internal/sync',
    maxClockSkewMs: 120000,
  });
});

test('rejects malformed protocol configuration', () => {
  assert.throws(() => loadProtocolConfig({ VERIFY_SYNC_PATH: 'internal/sync' }), /absolute HTTP path/);
  assert.throws(() => loadProtocolConfig({ VERIFY_SYNC_PATH: '/internal/sync?debug=1' }), /without a query string/);
  assert.throws(() => loadProtocolConfig({ VERIFY_PROTOCOL_AUDIENCE: ' audience ' }), /non-empty string/);
  assert.throws(() => loadProtocolConfig({ VERIFY_MAX_REQUEST_AGE_MS: '0' }), /positive safe integer/);
  assert.throws(() => loadProtocolConfig({ VERIFY_MAX_REQUEST_AGE_MS: '1.5' }), /positive safe integer/);
});

const { generateKeyPairSync } = require('node:crypto');
const {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_MONGODB_DATABASE,
  DEFAULT_MONGO_SERVER_SELECTION_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_GRACE_MS,
  loadPublicKeyRing,
  loadRuntimeConfig,
} = require('../src/config');

function publicKeyPem(type = 'ed25519') {
  const options = type === 'rsa' ? { modulusLength: 2048 } : undefined;
  return generateKeyPairSync(type, options).publicKey.export({ type: 'spki', format: 'pem' });
}

test('loads fail-closed runtime configuration and validates Ed25519 public keys eagerly', () => {
  const pem = publicKeyPem();
  const config = loadRuntimeConfig({
    MONGODB_URI: 'mongodb://127.0.0.1:27017',
    VERIFY_PUBLIC_KEYS: JSON.stringify({ 'office-key-1': pem }),
  });

  assert.equal(config.http.host, DEFAULT_HTTP_HOST);
  assert.equal(config.http.port, DEFAULT_HTTP_PORT);
  assert.equal(config.http.shutdownGraceMs, DEFAULT_SHUTDOWN_GRACE_MS);
  assert.equal(config.mongo.databaseName, DEFAULT_MONGODB_DATABASE);
  assert.equal(config.mongo.serverSelectionTimeoutMs, DEFAULT_MONGO_SERVER_SELECTION_TIMEOUT_MS);
  assert.equal(config.mongo.uri, 'mongodb://127.0.0.1:27017');
  assert.equal(config.publicKeys['office-key-1'].asymmetricKeyType, 'ed25519');
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.publicKeys), true);
});

test('accepts explicit cloud listener and MongoDB lifecycle settings', () => {
  const config = loadRuntimeConfig({
    HOST: '127.0.0.1',
    PORT: '0',
    MONGODB_URI: 'mongodb+srv://cluster.example/verification',
    VERIFY_MONGODB_DATABASE: 'verification_staging',
    VERIFY_MONGO_SERVER_SELECTION_TIMEOUT_MS: '4500',
    VERIFY_PUBLIC_KEYS: JSON.stringify({ key_2026: publicKeyPem() }),
    VERIFY_SHUTDOWN_GRACE_MS: '2500',
  });

  assert.deepEqual(config.http, {
    host: '127.0.0.1',
    port: 0,
    shutdownGraceMs: 2500,
  });
  assert.deepEqual(config.mongo, {
    databaseName: 'verification_staging',
    serverSelectionTimeoutMs: 4500,
    uri: 'mongodb+srv://cluster.example/verification',
  });
});

test('requires cloud MongoDB and public-key configuration before startup', () => {
  assert.throws(
    () => loadRuntimeConfig({ VERIFY_PUBLIC_KEYS: JSON.stringify({ key1: publicKeyPem() }) }),
    /MONGODB_URI is required/,
  );
  assert.throws(
    () => loadRuntimeConfig({ MONGODB_URI: 'mongodb://127.0.0.1:27017' }),
    /VERIFY_PUBLIC_KEYS is required/,
  );
});

test('rejects private, non-Ed25519, malformed, and oversized key rings', () => {
  const pair = generateKeyPairSync('ed25519');
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(
    () => loadPublicKeyRing(JSON.stringify({ key1: privatePem })),
    /not a valid Ed25519 public key: PRIVATE_KEY_NOT_ALLOWED/,
  );
  assert.throws(
    () => loadPublicKeyRing(JSON.stringify({ key1: publicKeyPem('rsa') })),
    /not a valid Ed25519 public key: INVALID_PUBLIC_KEY/,
  );
  assert.throws(() => loadPublicKeyRing('{'), /valid JSON/);
  assert.throws(() => loadPublicKeyRing(JSON.stringify([])), /JSON object/);
  assert.throws(() => loadPublicKeyRing('x'.repeat(70_000)), /supported size/);
});

test('rejects unsafe listener, MongoDB, database, timeout, and key-id values', () => {
  const base = {
    MONGODB_URI: 'mongodb://127.0.0.1:27017',
    VERIFY_PUBLIC_KEYS: JSON.stringify({ key1: publicKeyPem() }),
  };

  for (const env of [
    { ...base, HOST: ' bad-host ' },
    { ...base, PORT: '65536' },
    { ...base, MONGODB_URI: 'https://database.example' },
    { ...base, VERIFY_MONGODB_DATABASE: 'bad database' },
    { ...base, VERIFY_MONGO_SERVER_SELECTION_TIMEOUT_MS: '0' },
    { ...base, VERIFY_SHUTDOWN_GRACE_MS: '120001' },
    { ...base, VERIFY_PUBLIC_KEYS: JSON.stringify({ 'bad key id': publicKeyPem() }) },
  ]) {
    assert.throws(() => loadRuntimeConfig(env));
  }
});
