'use strict';

const { EventEmitter } = require('node:events');

const {
  DEFAULT_VERIFICATION_HEARTBEAT_INTERVAL_MS,
  DEFAULT_VERIFICATION_WORKER_INTERVAL_MS,
  createServerLifecycle,
  loadVerificationWorkerConfig,
  registerSignalHandlers,
} = require('../../src/server');
const {
  startExpiryJob,
  stopExpiryJob,
} = require('../../src/jobs/expiryJob');
const {
  stopVerificationOutboxWorker,
} = require('../../src/workers/verificationOutboxWorker');
const {
  stopVerificationHeartbeatWorker,
} = require('../../src/workers/verificationHeartbeatWorker');

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
    environment: { NODE_ENV: 'test', VERIFICATION_SYNC_ENABLED: 'false' },
    verificationConfigLoader: jest.fn(() => ({ enabled: false })),
    verificationClientFactory: jest.fn(),
    verificationWorkerStarter: jest.fn(() => {
      events.push('verification:start');
    }),
    verificationWorkerStopper: jest.fn(async () => {
      events.push('verification:stop');
    }),
    verificationHeartbeatStarter: jest.fn(() => {
      events.push('heartbeat:start');
    }),
    verificationHeartbeatStopper: jest.fn(async () => {
      events.push('heartbeat:stop');
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
    await Promise.all([
      stopExpiryJob(),
      stopVerificationOutboxWorker(),
      stopVerificationHeartbeatWorker(),
    ]);
    jest.useRealTimers();
  });



  test('verification sync defaults off outside production and requires an explicit production choice', () => {
    expect(loadVerificationWorkerConfig({ NODE_ENV: 'test' }))
      .toEqual({ enabled: false });

    let productionError;
    try {
      loadVerificationWorkerConfig({ NODE_ENV: 'production' });
    } catch (error) {
      productionError = error;
    }
    expect(productionError).toMatchObject({
      code: 'VERIFICATION_SYNC_ENABLEMENT_REQUIRED',
    });
  });

  test('verification sync false does not load key material or client configuration', () => {
    const syncConfigLoader = jest.fn();

    expect(loadVerificationWorkerConfig({
      NODE_ENV: 'production',
      VERIFICATION_SYNC_ENABLED: 'false',
    }, { syncConfigLoader })).toEqual({ enabled: false });
    expect(syncConfigLoader).not.toHaveBeenCalled();
  });

  test('verification sync true loads the signed client configuration and worker cadence', () => {
    const clientConfig = Object.freeze({ keyId: 'office-key-1' });
    const syncConfigLoader = jest.fn(() => clientConfig);

    expect(loadVerificationWorkerConfig({
      NODE_ENV: 'production',
      VERIFICATION_SYNC_ENABLED: 'true',
      VERIFICATION_HEARTBEAT_INTERVAL_MS: '90000',
      VERIFICATION_SYNC_WORKER_INTERVAL_MS: '45000',
      VERIFY_EPOCH: '3',
    }, { syncConfigLoader })).toEqual({
      clientConfig,
      enabled: true,
      epoch: 3,
      heartbeatIntervalMs: 90_000,
      intervalMs: 45_000,
    });
    expect(syncConfigLoader).toHaveBeenCalledTimes(1);
  });

  test('verification sync rejects ambiguous enablement and unsafe worker intervals', () => {
    expect(() => loadVerificationWorkerConfig({
      NODE_ENV: 'production',
      VERIFICATION_SYNC_ENABLED: 'TRUE',
    })).toThrow('exactly true or false');

    const syncConfigLoader = jest.fn(() => ({ keyId: 'office-key-1' }));
    for (const interval of ['999', '3600001', '1.5', 'not-a-number']) {
      expect(() => loadVerificationWorkerConfig({
        NODE_ENV: 'production',
        VERIFICATION_SYNC_ENABLED: 'true',
        VERIFICATION_SYNC_WORKER_INTERVAL_MS: interval,
      }, { syncConfigLoader })).toThrow('VERIFICATION_SYNC_WORKER_INTERVAL_MS');
    }

    for (const interval of ['999', '300001', '1.5', 'not-a-number']) {
      expect(() => loadVerificationWorkerConfig({
        NODE_ENV: 'production',
        VERIFICATION_HEARTBEAT_INTERVAL_MS: interval,
        VERIFICATION_SYNC_ENABLED: 'true',
      }, { syncConfigLoader })).toThrow('VERIFICATION_HEARTBEAT_INTERVAL_MS');
    }
    for (const epoch of ['0', '-1', '1.5', 'not-a-number']) {
      expect(() => loadVerificationWorkerConfig({
        NODE_ENV: 'production',
        VERIFICATION_SYNC_ENABLED: 'true',
        VERIFY_EPOCH: epoch,
      }, { syncConfigLoader })).toThrow('VERIFY_EPOCH');
    }

    const defaults = loadVerificationWorkerConfig({
      NODE_ENV: 'production',
      VERIFICATION_SYNC_ENABLED: 'true',
    }, { syncConfigLoader });
    expect(defaults.intervalMs).toBe(DEFAULT_VERIFICATION_WORKER_INTERVAL_MS);
    expect(defaults.heartbeatIntervalMs).toBe(DEFAULT_VERIFICATION_HEARTBEAT_INTERVAL_MS);
    expect(defaults.epoch).toBe(1);
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
      verificationConfigLoader: jest.fn(() => ({ enabled: false })),
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


  test('validates verification configuration before Mongo and starts the sender after migrations', async () => {
    const events = [];
    const { app } = fakeHttpApp(events);
    const clientConfig = { keyId: 'office-key-1' };
    const syncClient = { sendHealth: jest.fn(), sendRecord: jest.fn() };
    const lifecycle = createServerLifecycle({
      appInstance: app,
      mongooseClient: {
        connect: jest.fn(async () => events.push('mongo:connect')),
        disconnect: jest.fn(async () => events.push('mongo:disconnect')),
      },
      migrationRunner: jest.fn(async () => events.push('migrations')),
      fabricConnector: jest.fn(() => {
        events.push('fabric:attempt');
        return Promise.resolve({ available: false, reason: 'DISABLED' });
      }),
      fabricDisconnector: jest.fn(() => events.push('fabric:disconnect')),
      outboxStarter: jest.fn(() => events.push('outbox:start')),
      outboxStopper: jest.fn(async () => events.push('outbox:stop')),
      expiryStarter: jest.fn(() => events.push('expiry:start')),
      expiryStopper: jest.fn(async () => events.push('expiry:stop')),
      environment: { NODE_ENV: 'production', VERIFICATION_SYNC_ENABLED: 'true' },
      verificationConfigLoader: jest.fn(() => {
        events.push('verification:config');
        return {
          clientConfig,
          enabled: true,
          epoch: 3,
          heartbeatIntervalMs: 90_000,
          intervalMs: 45_000,
        };
      }),
      verificationClientFactory: jest.fn(({ config }) => {
        events.push('verification:client');
        expect(config).toBe(clientConfig);
        return syncClient;
      }),
      verificationWorkerStarter: jest.fn((options) => {
        events.push('verification:start');
        expect(options).toEqual({ intervalMs: 45_000, syncClient });
      }),
      verificationWorkerStopper: jest.fn(async () => events.push('verification:stop')),
      verificationHeartbeatStarter: jest.fn((options) => {
        events.push('heartbeat:start');
        expect(options).toEqual({ epoch: 3, intervalMs: 90_000, syncClient });
      }),
      verificationHeartbeatStopper: jest.fn(async () => events.push('heartbeat:stop')),
      logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
    });

    await lifecycle.start();

    expect(events.slice(0, 10)).toEqual([
      'verification:config',
      'verification:client',
      'mongo:connect',
      'migrations',
      'fabric:attempt',
      'outbox:start',
      'expiry:start',
      'verification:start',
      'heartbeat:start',
      'http:listen',
    ]);
    await lifecycle.shutdown();
  });

  test('invalid verification configuration fails before MongoDB and all workers', async () => {
    const { lifecycle, events, mongooseClient } = lifecycleFixture({
      verificationConfigLoader: jest.fn(() => {
        const error = new Error('invalid verification configuration');
        error.code = 'INVALID_VERIFICATION_SYNC_CONFIG';
        throw error;
      }),
    });

    await expect(lifecycle.start()).rejects.toMatchObject({
      code: 'INVALID_VERIFICATION_SYNC_CONFIG',
    });

    expect(mongooseClient.connect).not.toHaveBeenCalled();
    expect(events).not.toContain('outbox:start');
    expect(events).not.toContain('expiry:start');
    expect(events).not.toContain('verification:start');
    expect(events).not.toContain('heartbeat:start');
    expect(events).not.toContain('http:listen');
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

  test('waits for every scheduler before closing HTTP, Fabric, and MongoDB', async () => {
    const outboxStop = deferred();
    const expiryStop = deferred();
    const verificationStop = deferred();
    const heartbeatStop = deferred();
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
      environment: { NODE_ENV: 'production', VERIFICATION_SYNC_ENABLED: 'true' },
      verificationConfigLoader: jest.fn(() => ({
        clientConfig: { keyId: 'office-key-1' },
        enabled: true,
        epoch: 1,
        heartbeatIntervalMs: 60_000,
        intervalMs: 30_000,
      })),
      verificationClientFactory: jest.fn(() => ({
        sendHealth: jest.fn(),
        sendRecord: jest.fn(),
      })),
      verificationWorkerStarter: jest.fn(() => events.push('verification:start')),
      verificationWorkerStopper: jest.fn(() => {
        events.push('verification:stop');
        return verificationStop.promise;
      }),
      verificationHeartbeatStarter: jest.fn(() => events.push('heartbeat:start')),
      verificationHeartbeatStopper: jest.fn(() => {
        events.push('heartbeat:stop');
        return heartbeatStop.promise;
      }),
      logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
    });

    await lifecycle.start();
    const shutdown = lifecycle.shutdown();
    await Promise.resolve();

    expect(events).toEqual(expect.arrayContaining([
      'outbox:stop',
      'expiry:stop',
      'verification:stop',
      'heartbeat:stop',
    ]));
    expect(events).not.toContain('http:close');

    outboxStop.resolve();
    await Promise.resolve();
    expect(events).not.toContain('http:close');

    expiryStop.resolve();
    await Promise.resolve();
    expect(events).not.toContain('http:close');

    verificationStop.resolve();
    await Promise.resolve();
    expect(events).not.toContain('http:close');

    heartbeatStop.resolve();
    await shutdown;

    const closeIndex = events.indexOf('http:close');
    expect(closeIndex).toBeGreaterThan(events.indexOf('outbox:stop'));
    expect(closeIndex).toBeGreaterThan(events.indexOf('expiry:stop'));
    expect(closeIndex).toBeGreaterThan(events.indexOf('verification:stop'));
    expect(closeIndex).toBeGreaterThan(events.indexOf('heartbeat:stop'));
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
      environment: { NODE_ENV: 'production', VERIFICATION_SYNC_ENABLED: 'true' },
      verificationConfigLoader: jest.fn(() => ({
        clientConfig: { keyId: 'office-key-1' },
        enabled: true,
        epoch: 1,
        heartbeatIntervalMs: 60_000,
        intervalMs: 30_000,
      })),
      verificationClientFactory: jest.fn(() => ({
        sendHealth: jest.fn(),
        sendRecord: jest.fn(),
      })),
      verificationWorkerStarter: jest.fn(() => events.push('verification:start')),
      verificationWorkerStopper: jest.fn(async () => events.push('verification:stop')),
      verificationHeartbeatStarter: jest.fn(() => events.push('heartbeat:start')),
      verificationHeartbeatStopper: jest.fn(async () => events.push('heartbeat:stop')),
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
    expect(events).not.toContain('verification:start');
    expect(events).not.toContain('heartbeat:start');
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
