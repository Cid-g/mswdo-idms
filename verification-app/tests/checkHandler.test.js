'use strict';

const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVerificationRequestHandler } = require('../src/http/app');
const { materializeSourceHealth, SOURCE_HEALTH_ID } = require('../src/models/sourceHealth');
const { materializeVerifiedRecord } = require('../src/models/verifiedRecord');
const { hashVerificationToken } = require('../src/services/publicVerification');
const {
  AUDIENCE,
  HEALTH_PATH,
  KEY_ID,
  PATH,
  publicKey,
  signedHealth,
  signedRecord,
  validRecordPayload,
} = require('./fixtures');

const RAW_TOKEN = '22222222-2222-4222-8222-222222222222';
const TOKEN_HASH = hashVerificationToken(RAW_TOKEN);
const NOW = Date.parse('2026-08-05T16:50:00.000Z');

function recordDocument(payload = validRecordPayload()) {
  return {
    _id: 'record-http-1',
    ...materializeVerifiedRecord(
      signedRecord({ payload, tokenHash: TOKEN_HASH }).verifiedRequest,
    ),
  };
}

function healthDocument(timestamp = NOW - 10_000) {
  return {
    _id: SOURCE_HEALTH_ID,
    ...materializeSourceHealth(signedHealth({ timestamp }).verifiedRequest),
    receivedAt: new Date(timestamp + 1_000).toISOString(),
  };
}

async function withApp(run, {
  collection = { async findOne() { return recordDocument(); } },
  healthCollection = { async findOne() { return healthDocument(); } },
  now = () => NOW,
  onError = () => {},
} = {}) {
  const handler = createVerificationRequestHandler({
    collection,
    healthCollection,
    now,
    onError,
    protocolConfig: {
      audience: AUDIENCE,
      healthPath: HEALTH_PATH,
      maxClockSkewMs: 300_000,
      syncPath: PATH,
    },
    publicConfig: { checkPath: '/check', maxSyncAgeMs: 300_000 },
    publicKeys: { [KEY_ID]: publicKey },
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('serves a signed VALID response with public no-store and noindex controls', async () => {
  const filters = [];
  await withApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/check?token=${RAW_TOKEN}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store, private, max-age=0');
    assert.equal(response.headers.get('pragma'), 'no-cache');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    const body = await response.json();
    assert.equal(body.result, 'VALID');
    assert.equal(body.valid, true);
    assert.equal(body.status, 'ACTIVE');
    assert.equal(JSON.stringify(body).includes(RAW_TOKEN), false);
    assert.equal(JSON.stringify(body).includes(TOKEN_HASH), false);
  }, {
    collection: {
      async findOne(filter) {
        filters.push(filter);
        return recordDocument();
      },
    },
  });
  assert.deepEqual(filters, [{ tokenHash: TOKEN_HASH }]);
});

test('returns UNKNOWN rather than green-valid when signed source health is stale', async () => {
  await withApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/check?token=${RAW_TOKEN}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result, 'UNKNOWN');
    assert.equal(body.valid, null);
    assert.equal(body.status, 'ACTIVE');
  }, {
    healthCollection: {
      async findOne() { return healthDocument(NOW - 300_001); },
    },
  });
});

test('returns terminal NOT_VALID for revoked state even when source health is absent', async () => {
  await withApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/check?token=${RAW_TOKEN}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result, 'NOT_VALID');
    assert.equal(body.valid, false);
    assert.equal(body.status, 'REVOKED');
    assert.equal(body.sourceLastHealthyAt, null);
  }, {
    collection: {
      async findOne() { return recordDocument(validRecordPayload({ status: 'REVOKED' })); },
    },
    healthCollection: { async findOne() { return null; } },
  });
});

test('validates the exact public query and method before database lookup', async () => {
  let reads = 0;
  await withApp(async (baseUrl) => {
    for (const suffix of [
      '/check',
      '/check?token=not-a-uuid',
      `/check?token=${RAW_TOKEN}&token=${RAW_TOKEN}`,
      `/check?token=${RAW_TOKEN}&debug=1`,
    ]) {
      const response = await fetch(`${baseUrl}${suffix}`);
      assert.equal(response.status, 400);
    }

    const post = await fetch(`${baseUrl}/check?token=${RAW_TOKEN}`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET');

    const missing = await fetch(`${baseUrl}/checks?token=${RAW_TOKEN}`);
    assert.equal(missing.status, 404);
  }, {
    collection: {
      async findOne() { reads += 1; return null; },
    },
  });
  assert.equal(reads, 0);
});

test('returns a token-redacted 404 for a well-formed UUID with no record', async () => {
  await withApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/check?token=${RAW_TOKEN}`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.result, 'NOT_FOUND');
    assert.equal(body.valid, false);
    assert.equal(JSON.stringify(body).includes(RAW_TOKEN), false);
    assert.equal(JSON.stringify(body).includes(TOKEN_HASH), false);
  }, {
    collection: { async findOne() { return null; } },
  });
});

test('fails closed on signed-record tampering without reflecting stored data', async () => {
  const observed = [];
  const tampered = recordDocument();
  tampered.maskedName = 'DATABASE TAMPER';

  await withApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/check?token=${RAW_TOKEN}`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'VERIFICATION_INTEGRITY_UNAVAILABLE');
    assert.equal(JSON.stringify(body).includes('DATABASE TAMPER'), false);
  }, {
    collection: { async findOne() { return tampered; } },
    onError(error) { observed.push(error); },
  });

  assert.equal(observed.length, 1);
});

test('contains unexpected database failures behind a generic public 503', async () => {
  const secret = 'mongodb://private-user:private-password@cluster';
  await withApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/check?token=${RAW_TOKEN}`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'VERIFICATION_STORE_UNAVAILABLE');
    assert.equal(JSON.stringify(body).includes('private-password'), false);
  }, {
    collection: {
      async findOne() { throw new Error(secret); },
    },
  });
});
