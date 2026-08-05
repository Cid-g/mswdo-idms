'use strict';

const { EventEmitter } = require('node:events');

const {
  createServerLifecycle,
  registerSignalHandlers,
} = require('../../src/server');
const {
  startExpiryJob,
  stopExpiryJob,
} = require('../../src/jobs/expiryJob');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function fakeHttpApp(events) {
  const server = new EventEmitter();
  server.close = jest.fn((callback) => {
    events.push('http:close');
    callback();
  });

  return {
    app: {
      listen: jest.fn((_port, callback) => {
        events.push('http:listen');
        setImmediate(callback);
        return server;
      }),
    },
    server,
  };
}

function lifecycleFixture(overrides = {}) {
  const events = [];
  const { app, server } = fakeHttpApp(events);
  const logger = {
    error: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
  };
  const mongooseClient = {
    connect: jest.fn(async () => {
      events.push('mongo:connect');
    }),
    disconnect: jest.fn(async () => {
      events.push('mongo:disconnect');
    }),
  };

  const lifecycle = createServerLifecycle({
    appInstance: app,
    mongooseClient,
    mongoUri: 'mongodb://test/rs0',
    port: 5050,
    migrationRunner: jest.fn(async () => {
      events.push('migrations');
    }),
    fabricConnector: jest.fn(() => {
      events.push('fabric:attempt');
      return Promise.resolve({ available: true });
    }),
    fabricDisconnector: jest.fn(async () => {
      events.push('fabric:disconnect');
    }),
    outboxStarter: jest.fn(() => {
      events.push('outbox:start');
    }),
    outboxStopper: jest.fn(async () => {
      events.push('outbox:stop');
    }),
    expiryStarter: jest.fn(() => {
      events.push('expiry:start');
    }),
    expiryStopper: jest.fn(async () => {
      events.push('expiry:stop');
    }),
    logger,
    ...overrides,
  });

  return {
    events,
    lifecycle,
    logger,
    mongooseClient,
    server,
  };
}

describe('production server lifecycle', () => {
  afterEach(async () => {
    await stopExpiryJob();
    jest.useRealTimers();
  });

  test('importing app.js starts no background timers', () => {
    jest.useFakeTimers();
    jest.isolateModules(() => {
      require('../../src/app');
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  test('starts workers only after MongoDB and migrations, without awaiting Fabric', async () => {
    const fabricAttempt = deferred();
    const events = [];
    const { app } = fakeHttpApp(events);
    const lifecycle = createServerLifecycle({
      appInstance: app,
      mongooseClient: {
        connect: jest.fn(async () => events.push('mongo:connect')),
        disconnect: jest.fn(async () => events.push('mongo:disconnect')),
      },
      mongoUri: 'mongodb://test/rs0',
      port: 5050,
      migrationRunner: jest.fn(async () => events.push('migrations')),
      fabricConnector: jest.fn(() => {
        events.push('fabric:attempt');
        return fabricAttempt.promise;
      }),
      fabricDisconnector: jest.fn(() => events.push('fabric:disconnect')),
      outboxStarter: jest.fn(() => events.push('outbox:start')),
      outboxStopper: jest.fn(async () => events.push('outbox:stop')),
      expiryStarter: jest.fn(() => events.push('expiry:start')),
      expiryStopper: jest.fn(async () => events.push('expiry:stop')),
      logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
    });

    await lifecycle.start();

    expect(events.slice(0, 6)).toEqual([
      'mongo:connect',
      'migrations',
      'fabric:attempt',
      'outbox:start',
      'expiry:start',
      'http:listen',
    ]);

    // The HTTP server is already live even though the first Fabric attempt is unresolved.
    fabricAttempt.reject(new Error('Fabric unavailable'));
    await Promise.resolve();
    await Promise.resolve();
    await lifecycle.shutdown();
  });

  test('a rejected initial Fabric connection does not block HTTP startup', async () => {
    const { lifecycle, logger, events } = lifecycleFixture({
      fabricConnector: jest.fn(() => {
        events.push('fabric:attempt');
        return Promise.reject(new Error('peer offline'));
      }),
    });

    await expect(lifecycle.start()).resolves.toBeDefined();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toContain('http:listen');
    expect(logger.error).toHaveBeenCalledWith(
      '[Fabric] Initial connection failed; worker will retry:',
      'peer offline'
    );
    await lifecycle.shutdown();
  });

  test('waits for both schedulers before closing HTTP, Fabric, and MongoDB', async () => {
    const outboxStop = deferred();
    const expiryStop = deferred();
    const events = [];
    const { app } = fakeHttpApp(events);
    const lifecycle = createServerLifecycle({
      appInstance: app,
      mongooseClient: {
        connect: jest.fn(async () => events.push('mongo:connect')),
        disconnect: jest.fn(async () => events.push('mongo:disconnect')),
      },
      migrationRunner: jest.fn(async () => events.push('migrations')),
      fabricConnector: jest.fn(() => Promise.resolve({ available: false, reason: 'DISABLED' })),
      fabricDisconnector: jest.fn(() => events.push('fabric:disconnect')),
      outboxStarter: jest.fn(() => events.push('outbox:start')),
      outboxStopper: jest.fn(() => {
        events.push('outbox:stop');
        return outboxStop.promise;
      }),
      expiryStarter: jest.fn(() => events.push('expiry:start')),
      expiryStopper: jest.fn(() => {
        events.push('expiry:stop');
        return expiryStop.promise;
      }),
      logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
    });

    await lifecycle.start();
    const shutdown = lifecycle.shutdown();
    await Promise.resolve();

    expect(events).toEqual(expect.arrayContaining(['outbox:stop', 'expiry:stop']));
    expect(events).not.toContain('http:close');

    outboxStop.resolve();
    await Promise.resolve();
    expect(events).not.toContain('http:close');

    expiryStop.resolve();
    await shutdown;

    const closeIndex = events.indexOf('http:close');
    expect(closeIndex).toBeGreaterThan(events.indexOf('outbox:stop'));
    expect(closeIndex).toBeGreaterThan(events.indexOf('expiry:stop'));
    expect(events.slice(closeIndex)).toEqual([
      'http:close',
      'fabric:disconnect',
      'mongo:disconnect',
    ]);
  });

  test('stopExpiryJob waits for the in-flight boot run before resolving', async () => {
    jest.useFakeTimers();
    const inFlight = deferred();
    const runOnce = jest.fn(() => inFlight.promise);

    startExpiryJob({
      intervalMs: 60_000,
      owner: 'shutdown-test',
      runOnce,
      now: () => new Date('2026-08-05T12:00:00.000Z'),
      onError: jest.fn(),
    });

    await jest.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = stopExpiryJob().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(jest.getTimerCount()).toBe(0);

    inFlight.resolve({ acquired: true, expired: 0, queued: 0 });
    await stopping;
    expect(stopped).toBe(true);
  });

  test('a shutdown requested during migrations prevents workers and HTTP from starting', async () => {
    const migrations = deferred();
    const events = [];
    const { app } = fakeHttpApp(events);
    const lifecycle = createServerLifecycle({
      appInstance: app,
      mongooseClient: {
        connect: jest.fn(async () => events.push('mongo:connect')),
        disconnect: jest.fn(async () => events.push('mongo:disconnect')),
      },
      migrationRunner: jest.fn(() => {
        events.push('migrations');
        return migrations.promise;
      }),
      fabricConnector: jest.fn(() => events.push('fabric:attempt')),
      fabricDisconnector: jest.fn(() => events.push('fabric:disconnect')),
      outboxStarter: jest.fn(() => events.push('outbox:start')),
      outboxStopper: jest.fn(async () => events.push('outbox:stop')),
      expiryStarter: jest.fn(() => events.push('expiry:start')),
      expiryStopper: jest.fn(async () => events.push('expiry:stop')),
      logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
    });

    const starting = lifecycle.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['mongo:connect', 'migrations']);

    const stopping = lifecycle.shutdown();
    migrations.resolve();

    await expect(starting).rejects.toMatchObject({ code: 'SERVER_STARTUP_ABORTED' });
    await stopping;

    expect(events).not.toContain('fabric:attempt');
    expect(events).not.toContain('outbox:start');
    expect(events).not.toContain('expiry:start');
    expect(events).not.toContain('http:listen');
    expect(events.slice(-2)).toEqual(['fabric:disconnect', 'mongo:disconnect']);
  });

  test('signal handling runs cleanup once and sets the process exit code', async () => {
    const processRef = new EventEmitter();
    processRef.exitCode = undefined;
    const cleanup = deferred();
    const lifecycle = {
      shutdown: jest.fn(() => cleanup.promise),
    };
    const logger = { error: jest.fn(), log: jest.fn() };

    registerSignalHandlers(lifecycle, { processRef, logger });
    processRef.emit('SIGTERM');
    processRef.emit('SIGINT');

    expect(lifecycle.shutdown).toHaveBeenCalledTimes(1);
    cleanup.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(processRef.exitCode).toBe(0);
    expect(logger.log).toHaveBeenCalledWith('[shutdown] SIGTERM cleanup complete');
  });
});
