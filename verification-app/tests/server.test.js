'use strict';

const { EventEmitter } = require('node:events');
const { generateKeyPairSync } = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  installShutdownSignals,
  operationalErrorLabel,
  startVerificationServer,
} = require('../src/server');
const { HEALTH_PATH } = require('../src/http/app');

function runtimeEnv(overrides = {}) {
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  return {
    HOST: '127.0.0.1',
    PORT: '0',
    MONGODB_URI: 'mongodb://secret-user:secret-password@example.invalid:27017',
    VERIFY_MONGODB_DATABASE: 'verification_test',
    VERIFY_PUBLIC_KEYS: JSON.stringify({ 'office-key-1': publicKey }),
    VERIFY_SHUTDOWN_GRACE_MS: '1000',
    ...overrides,
  };
}

function logger() {
  return {
    errors: [],
    infos: [],
    error(message) { this.errors.push(message); },
    info(message) { this.infos.push(message); },
  };
}

class FakeServer extends EventEmitter {
  constructor(events) {
    super();
    this.events = events;
    this.listening = false;
    this.closeCalls = 0;
  }

  listen(port, host) {
    this.events.push(`listen:${host}:${port}`);
    this.listening = true;
    queueMicrotask(() => this.emit('listening'));
  }

  address() {
    return { address: '127.0.0.1', family: 'IPv4', port: 43210 };
  }

  close(callback) {
    this.closeCalls += 1;
    this.events.push('http:close');
    this.listening = false;
    queueMicrotask(() => callback());
  }

  closeIdleConnections() {
    this.events.push('http:close-idle');
  }
}

test('does not create or listen on HTTP until the store is ready', async () => {
  const events = [];
  const log = logger();
  const fakeServer = new FakeServer(events);
  const store = {
    collection: { findOne: async () => null },
    healthCollection: { findOne: async () => null },
    async close() { events.push('store:close'); },
  };

  const runtime = await startVerificationServer({
    connectStore: async () => {
      events.push('store:ready');
      return store;
    },
    createServer: () => {
      events.push('server:create');
      return fakeServer;
    },
    env: runtimeEnv(),
    installSignals: false,
    logger: log,
  });

  assert.deepEqual(events.slice(0, 3), ['store:ready', 'server:create', 'listen:127.0.0.1:0']);
  assert.equal(log.infos[0], '[verification] listening on 127.0.0.1:43210');
  await runtime.shutdown('test');
  await runtime.shutdown('again');
  assert.equal(fakeServer.closeCalls, 1);
  assert.equal(events.filter((event) => event === 'store:close').length, 1);
});

test('closes an initialized store when listener construction fails', async () => {
  let closeCalls = 0;
  const startupFailure = new Error('listener construction failed');
  await assert.rejects(
    startVerificationServer({
      connectStore: async () => ({
        collection: { findOne: async () => null },
        healthCollection: { findOne: async () => null },
        async close() { closeCalls += 1; },
      }),
      createServer: () => { throw startupFailure; },
      env: runtimeEnv(),
      installSignals: false,
      logger: logger(),
    }),
    (error) => error === startupFailure,
  );
  assert.equal(closeCalls, 1);
});

test('serves health only after startup and shuts down the real listener cleanly', async () => {
  let closeCalls = 0;
  const runtime = await startVerificationServer({
    connectStore: async () => ({
      collection: { findOne: async () => null },
      healthCollection: { findOne: async () => null },
      async close() { closeCalls += 1; },
    }),
    env: runtimeEnv(),
    installSignals: false,
    logger: logger(),
  });

  const response = await fetch(`http://127.0.0.1:${runtime.address.port}${HEALTH_PATH}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  await runtime.shutdown('test');
  assert.equal(closeCalls, 1);
  assert.equal(runtime.server.listening, false);
});

test('registers removable one-shot SIGINT and SIGTERM handlers', () => {
  const signalSource = new EventEmitter();
  const seen = [];
  const uninstall = installShutdownSignals({
    onSignal: (signal) => seen.push(signal),
    signalSource,
  });

  signalSource.emit('SIGINT');
  signalSource.emit('SIGINT');
  assert.deepEqual(seen, ['SIGINT']);
  uninstall();
  signalSource.emit('SIGTERM');
  assert.deepEqual(seen, ['SIGINT']);
});

test('credential-safe operational labels never include private error messages', () => {
  const error = new Error('mongodb://secret-user:secret-password@cluster.example');
  error.code = 'ECONNREFUSED';
  const label = operationalErrorLabel(error);
  assert.equal(label, 'Error (ECONNREFUSED)');
  assert.equal(label.includes('secret-password'), false);
  assert.equal(label.includes('cluster.example'), false);
});

test('contains unexpected async request failures behind a generic 503', async () => {
  const observed = [];
  const runtime = await startVerificationServer({
    connectStore: async () => ({
      collection: { findOne: async () => null },
      healthCollection: { findOne: async () => null },
      async close() {},
    }),
    createRequestHandler: () => async () => {
      throw new Error('mongodb://private-user:private-password@cluster');
    },
    env: runtimeEnv(),
    installSignals: false,
    logger: {
      info() {},
      error(message) { observed.push(message); },
    },
  });

  try {
    const response = await fetch(`http://127.0.0.1:${runtime.address.port}/unexpected`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'VERIFICATION_SERVICE_UNAVAILABLE');
    assert.equal(JSON.stringify(body).includes('private-password'), false);
    assert.equal(observed.some((message) => message.includes('private-password')), false);
  } finally {
    await runtime.shutdown('test');
  }
});
