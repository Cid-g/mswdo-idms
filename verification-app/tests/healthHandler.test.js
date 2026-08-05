'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createHealthRequestHandler } = require('../src/http/healthHandler');
const {
  AUDIENCE,
  HEALTH_PATH,
  KEY_ID,
  TIMESTAMP,
  publicKey,
  signedHealth,
} = require('./fixtures');

const PROTOCOL_CONFIG = Object.freeze({
  audience: AUDIENCE,
  healthPath: HEALTH_PATH,
  maxClockSkewMs: 5 * 60 * 1000,
  syncPath: '/internal/sync',
});
const PUBLIC_KEYS = Object.freeze({ [KEY_ID]: publicKey });

class MemoryCollection {
  constructor() {
    this.record = null;
    this.failWith = null;
  }

  async findOne(filter) {
    if (this.failWith) throw this.failWith;
    return this.record?._id === filter._id ? { ...this.record } : null;
  }

  async insertOne(document) {
    if (this.failWith) throw this.failWith;
    if (this.record) {
      const error = new Error('duplicate');
      error.code = 11000;
      throw error;
    }
    this.record = { ...document };
    return { insertedId: document._id };
  }

  async findOneAndUpdate(filter, update) {
    if (this.failWith) throw this.failWith;
    const matches = this.record && Object.entries(filter).every(([key, value]) => this.record[key] === value);
    if (!matches) return { value: null };
    this.record = { ...this.record, ...update.$set };
    return { value: { ...this.record } };
  }
}

async function withServer(options, run) {
  const server = http.createServer(createHealthRequestHandler({
    now: () => TIMESTAMP,
    protocolConfig: PROTOCOL_CONFIG,
    publicKeys: PUBLIC_KEYS,
    ...options,
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function requestHeaders(health, overrides = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Key-Id': KEY_ID,
    'X-Signature': health.signatureBase64,
    'X-Timestamp': String(health.verifiedRequest.envelope.timestamp),
    ...overrides,
  };
}

async function postHealth(baseUrl, health, options = {}) {
  const method = options.method || 'POST';
  const request = {
    method,
    headers: requestHeaders(health, options.headers),
  };
  if (method !== 'GET' && method !== 'HEAD') {
    request.body = options.body === undefined ? health.signedPayload : options.body;
  }
  return fetch(`${baseUrl}${options.path || HEALTH_PATH}`, request);
}

test('accepts and idempotently replays a signed drained-queue heartbeat', async () => {
  const collection = new MemoryCollection();
  const health = signedHealth();
  await withServer({ collection }, async (baseUrl) => {
    const inserted = await postHealth(baseUrl, health);
    assert.equal(inserted.status, 201);
    assert.deepEqual(await inserted.json(), {
      applied: true,
      epoch: 1,
      outcome: 'INSERTED',
      sourceLastHealthyAt: new Date(TIMESTAMP).toISOString(),
    });

    const replay = await postHealth(baseUrl, health);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).outcome, 'IDEMPOTENT');
  });
});

test('accepts a newer heartbeat and rejects a stale one', async () => {
  const collection = new MemoryCollection();
  await withServer({ collection, now: () => TIMESTAMP + 100 }, async (baseUrl) => {
    const first = signedHealth({ timestamp: TIMESTAMP });
    assert.equal((await postHealth(baseUrl, first)).status, 201);

    const next = signedHealth({ timestamp: TIMESTAMP + 100 });
    const updated = await postHealth(baseUrl, next);
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).outcome, 'UPDATED');

    const stale = await postHealth(baseUrl, first);
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, 'STALE_SOURCE_HEALTH_TIMESTAMP');
  });
});

test('requires exact path, POST method, and canonical security headers', async () => {
  const collection = new MemoryCollection();
  const health = signedHealth();
  await withServer({ collection }, async (baseUrl) => {
    assert.equal((await postHealth(baseUrl, health, { path: `${HEALTH_PATH}?debug=1` })).status, 404);

    const method = await postHealth(baseUrl, health, { method: 'GET' });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get('allow'), 'POST');

    const missing = requestHeaders(health);
    delete missing['X-Key-Id'];
    const response = await fetch(`${baseUrl}${HEALTH_PATH}`, {
      method: 'POST',
      headers: missing,
      body: health.signedPayload,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_SYNC_HEADERS');
  });
});

test('rejects stale signatures, invalid media, and oversized bodies', async () => {
  const collection = new MemoryCollection();
  const stale = signedHealth({ timestamp: TIMESTAMP - PROTOCOL_CONFIG.maxClockSkewMs - 1 });
  await withServer({ collection }, async (baseUrl) => {
    const staleResponse = await postHealth(baseUrl, stale);
    assert.equal(staleResponse.status, 401);
    assert.equal((await staleResponse.json()).error.code, 'STALE_SIGNED_REQUEST');

    const valid = signedHealth();
    const media = await postHealth(baseUrl, valid, { headers: { 'Content-Type': 'text/plain' } });
    assert.equal(media.status, 415);

    const smallServer = http.createServer(createHealthRequestHandler({
      collection,
      maxBodyBytes: 32,
      now: () => TIMESTAMP,
      protocolConfig: PROTOCOL_CONFIG,
      publicKeys: PUBLIC_KEYS,
    }));
    smallServer.listen(0, '127.0.0.1');
    await once(smallServer, 'listening');
    try {
      const response = await postHealth(`http://127.0.0.1:${smallServer.address().port}`, valid);
      assert.equal(response.status, 413);
    } finally {
      smallServer.close();
      await once(smallServer, 'close');
    }
  });
});

test('fails closed without leaking unexpected persistence errors', async () => {
  const collection = new MemoryCollection();
  collection.failWith = new Error('mongodb://private-user:private-password@cluster');
  const observed = [];
  await withServer({ collection, onError: (error) => observed.push(error) }, async (baseUrl) => {
    const response = await postHealth(baseUrl, signedHealth());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'SOURCE_HEALTH_STORE_UNAVAILABLE');
    assert.equal(JSON.stringify(body).includes('private-password'), false);
  });
  assert.equal(observed.length, 1);
});
