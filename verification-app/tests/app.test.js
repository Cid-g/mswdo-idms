'use strict';

const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVerificationRequestHandler, HEALTH_PATH } = require('../src/http/app');
const { AUDIENCE, PATH, publicKey } = require('./fixtures');

async function withApp(run) {
  const handler = createVerificationRequestHandler({
    collection: { findOne: async () => null },
    protocolConfig: { audience: AUDIENCE, maxClockSkewMs: 300_000, syncPath: PATH },
    publicKeys: { key1: publicKey },
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

test('serves a minimal no-store liveness response', async () => {
  await withApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}${HEALTH_PATH}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
});

test('supports HEAD health checks without a response body', async () => {
  await withApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}${HEALTH_PATH}`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-length'), '0');
    assert.equal(await response.text(), '');
  });
});

test('rejects health mutation methods and query-string variants', async () => {
  await withApp(async (baseUrl) => {
    const post = await fetch(`${baseUrl}${HEALTH_PATH}`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');

    const query = await fetch(`${baseUrl}${HEALTH_PATH}?token=secret`);
    assert.equal(query.status, 404);
  });
});
