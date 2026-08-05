'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { sign } = require('node:crypto');
const { createSyncRequestHandler } = require('../src/http/syncHandler');
const { materializeVerifiedRecord } = require('../src/models/verifiedRecord');
const {
  AUDIENCE,
  KEY_ID,
  PATH,
  TIMESTAMP,
  privateKey,
  publicKey,
  signedRecord,
  validRecordPayload,
} = require('./fixtures');

const PROTOCOL_CONFIG = Object.freeze({
  audience: AUDIENCE,
  maxClockSkewMs: 5 * 60 * 1000,
  syncPath: PATH,
});
const PUBLIC_KEYS = Object.freeze({ [KEY_ID]: publicKey });

function matches(record, filter) {
  return Object.entries(filter).every(([key, value]) => record?.[key] === value);
}

class MemoryCollection {
  constructor(record = null) {
    this.record = record ? { ...record } : null;
    this.nextId = 1;
    this.failWith = null;
  }

  async findOne(filter) {
    if (this.failWith) throw this.failWith;
    return matches(this.record, filter) ? { ...this.record } : null;
  }

  async insertOne(document) {
    if (this.failWith) throw this.failWith;
    if (this.record?.tokenHash === document.tokenHash) {
      const error = new Error('duplicate tokenHash');
      error.code = 11000;
      throw error;
    }
    this.record = { ...document, _id: `record-${this.nextId++}` };
    return { insertedId: this.record._id };
  }

  async findOneAndUpdate(filter, update) {
    if (this.failWith) throw this.failWith;
    if (!matches(this.record, filter)) return { value: null };
    this.record = { ...this.record, ...update.$set };
    return { value: { ...this.record } };
  }
}

async function withServer(options, run) {
  const server = http.createServer(createSyncRequestHandler({
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

function syncHeaders(record, overrides = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Key-Id': KEY_ID,
    'X-Signature': record.signatureBase64,
    'X-Timestamp': String(TIMESTAMP),
    ...overrides,
  };
}

async function postRecord(baseUrl, record, options = {}) {
  return fetch(`${baseUrl}${options.path || PATH}`, {
    method: options.method || 'POST',
    headers: syncHeaders(record, options.headers),
    body: options.body === undefined ? record.signedPayload : options.body,
  });
}

async function readJson(response) {
  return response.json();
}

test('accepts an authenticated canonical envelope and inserts it once', async () => {
  const collection = new MemoryCollection();
  const record = signedRecord();

  await withServer({ collection }, async (baseUrl) => {
    const response = await postRecord(baseUrl, record);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(await readJson(response), {
      applied: true,
      epoch: 1,
      outcome: 'INSERTED',
      payloadDigest: record.verifiedRequest.envelope.payloadDigest,
      revision: 1,
    });
  });

  assert.equal(collection.record.revision, 1);
  assert.equal(collection.record.signedPayload, record.signedPayload);
});

test('returns an idempotent acknowledgement without replacing signed evidence', async () => {
  const first = signedRecord({ timestamp: TIMESTAMP - 1000 });
  const collection = new MemoryCollection({
    ...materializeVerifiedRecord(first.verifiedRequest),
    _id: 'record-1',
  });

  await withServer({ collection }, async (baseUrl) => {
    const replay = signedRecord({ timestamp: TIMESTAMP });
    const response = await postRecord(baseUrl, replay);
    assert.equal(response.status, 200);
    assert.equal((await readJson(response)).outcome, 'IDEMPOTENT');
    assert.equal(collection.record.signedPayload, first.signedPayload);
  });
});

test('accepts a strictly newer revision through the HTTP boundary', async () => {
  const first = signedRecord({ revision: 1 });
  const collection = new MemoryCollection({
    ...materializeVerifiedRecord(first.verifiedRequest),
    _id: 'record-1',
  });

  await withServer({ collection }, async (baseUrl) => {
    const next = signedRecord({
      revision: 2,
      payload: validRecordPayload({ status: 'EXPIRED' }),
    });
    const response = await postRecord(baseUrl, next);
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), {
      applied: true,
      epoch: 1,
      outcome: 'UPDATED',
      payloadDigest: next.verifiedRequest.envelope.payloadDigest,
      revision: 2,
    });
  });

  assert.equal(collection.record.status, 'EXPIRED');
});

test('requires the exact sync path without a query string', async () => {
  const collection = new MemoryCollection();
  const record = signedRecord();
  await withServer({ collection }, async (baseUrl) => {
    for (const path of ['/wrong', `${PATH}?debug=1`]) {
      const response = await postRecord(baseUrl, record, { path });
      assert.equal(response.status, 404);
      assert.equal((await readJson(response)).error.code, 'NOT_FOUND');
    }
  });
});

test('returns 405 and Allow for a non-POST request to the sync path', async () => {
  const collection = new MemoryCollection();
  await withServer({ collection }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}${PATH}`, { method: 'GET' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  });
});

test('rejects unsupported media types and compressed bodies', async () => {
  const collection = new MemoryCollection();
  const record = signedRecord();
  await withServer({ collection }, async (baseUrl) => {
    const wrongType = await postRecord(baseUrl, record, {
      headers: { 'Content-Type': 'text/plain' },
    });
    assert.equal(wrongType.status, 415);
    assert.equal((await readJson(wrongType)).error.code, 'UNSUPPORTED_MEDIA_TYPE');

    const encoded = await postRecord(baseUrl, record, {
      headers: { 'Content-Encoding': 'gzip' },
    });
    assert.equal(encoded.status, 415);
    assert.equal((await readJson(encoded)).error.code, 'UNSUPPORTED_CONTENT_ENCODING');
  });
});

test('requires all signed-request headers exactly once', async () => {
  const collection = new MemoryCollection();
  const record = signedRecord();
  await withServer({ collection }, async (baseUrl) => {
    for (const missing of ['X-Key-Id', 'X-Signature', 'X-Timestamp']) {
      const headers = syncHeaders(record);
      delete headers[missing];
      const response = await fetch(`${baseUrl}${PATH}`, {
        method: 'POST',
        headers,
        body: record.signedPayload,
      });
      assert.equal(response.status, 400);
      assert.equal((await readJson(response)).error.code, 'INVALID_SYNC_HEADERS');
    }
  });
});

test('rejects duplicate security headers instead of accepting a merged value', async () => {
  const collection = new MemoryCollection();
  const record = signedRecord();

  await withServer({ collection }, async (baseUrl) => {
    const url = new URL(`${baseUrl}${PATH}`);
    const response = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Key-Id': [KEY_ID, KEY_ID],
          'X-Signature': record.signatureBase64,
          'X-Timestamp': String(TIMESTAMP),
        },
      }, async (res) => {
        const chunks = [];
        for await (const chunk of res) chunks.push(chunk);
        resolve({
          status: res.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        });
      });
      request.once('error', reject);
      request.end(record.signedPayload);
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_SYNC_HEADERS');
  });
});

test('rejects a stale signed timestamp', async () => {
  const collection = new MemoryCollection();
  const record = signedRecord({ timestamp: TIMESTAMP - PROTOCOL_CONFIG.maxClockSkewMs - 1 });
  await withServer({ collection }, async (baseUrl) => {
    const response = await postRecord(baseUrl, record, {
      headers: { 'X-Timestamp': String(record.verifiedRequest.envelope.timestamp) },
    });
    assert.equal(response.status, 401);
    assert.equal((await readJson(response)).error.code, 'STALE_SIGNED_REQUEST');
  });
});

test('rejects an invalid Ed25519 signature', async () => {
  const collection = new MemoryCollection();
  const record = signedRecord();
  const tamperedSignature = sign(null, Buffer.from(`${record.signedPayload} `, 'utf8'), privateKey).toString('base64');

  await withServer({ collection }, async (baseUrl) => {
    const response = await postRecord(baseUrl, record, {
      headers: { 'X-Signature': tamperedSignature },
    });
    assert.equal(response.status, 401);
    assert.equal((await readJson(response)).error.code, 'SIGNATURE_INVALID');
  });
});

test('rejects bodies over the configured limit before verification', async () => {
  const collection = new MemoryCollection();
  const record = signedRecord();
  await withServer({ collection, maxBodyBytes: 64 }, async (baseUrl) => {
    const response = await postRecord(baseUrl, record);
    assert.equal(response.status, 413);
    assert.equal((await readJson(response)).error.code, 'SYNC_BODY_TOO_LARGE');
  });
});

test('rejects non-UTF-8 request bytes', async () => {
  const collection = new MemoryCollection();
  const record = signedRecord();

  await withServer({ collection }, async (baseUrl) => {
    const url = new URL(`${baseUrl}${PATH}`);
    const response = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          ...syncHeaders(record),
          'Content-Length': '2',
        },
      }, async (res) => {
        const chunks = [];
        for await (const chunk of res) chunks.push(chunk);
        resolve({
          status: res.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        });
      });
      request.once('error', reject);
      request.end(Buffer.from([0xc3, 0x28]));
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_UTF8_BODY');
  });
});

test('maps an equal-revision digest conflict to an explicit 409', async () => {
  const existing = signedRecord();
  const collection = new MemoryCollection({
    ...materializeVerifiedRecord(existing.verifiedRequest),
    _id: 'record-1',
  });
  const conflict = signedRecord({
    payload: validRecordPayload({ maskedName: 'X****, Y****' }),
  });

  await withServer({ collection }, async (baseUrl) => {
    const response = await postRecord(baseUrl, conflict);
    assert.equal(response.status, 409);
    assert.equal((await readJson(response)).error.code, 'EQUAL_REVISION_DIGEST_CONFLICT');
  });
});

test('fails closed on an unexpected persistence error without exposing its message', async () => {
  const collection = new MemoryCollection();
  const privateError = new Error('mongodb://secret-user:secret-password@cluster');
  collection.failWith = privateError;
  const observed = [];

  await withServer({ collection, onError: (error) => observed.push(error) }, async (baseUrl) => {
    const response = await postRecord(baseUrl, signedRecord());
    assert.equal(response.status, 503);
    const body = await readJson(response);
    assert.equal(body.error.code, 'VERIFICATION_STORE_UNAVAILABLE');
    assert.equal(JSON.stringify(body).includes('secret-password'), false);
  });

  assert.deepEqual(observed, [privateError]);
});
