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
