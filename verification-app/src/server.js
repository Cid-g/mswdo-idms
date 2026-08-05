'use strict';

const http = require('node:http');
const { loadRuntimeConfig } = require('./config');
const { connectVerificationStore } = require('./db/mongo');
const { createVerificationRequestHandler } = require('./http/app');
const { writeJson } = require('./http/syncHandler');

function operationalErrorLabel(error) {
  const name = typeof error?.name === 'string' && error.name ? error.name : 'Error';
  const code = typeof error?.code === 'string' || typeof error?.code === 'number'
    ? String(error.code).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
    : '';
  return code ? `${name} (${code})` : name;
}

function logOperationalError(logger, scope, error) {
  try {
    logger.error(`[verification] ${scope} failed: ${operationalErrorLabel(error)}`);
  } catch {
    // Logging must not interfere with cleanup or protocol handling.
  }
}


function createSafeRequestListener(handler, onError = () => {}) {
  if (typeof handler !== 'function') throw new TypeError('handler must be a function.');
  if (typeof onError !== 'function') throw new TypeError('onError must be a function.');

  return function safeRequestListener(req, res) {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((error) => {
        try {
          onError(error);
        } catch {
          // Observability hooks must not alter the fail-closed response.
        }

        if (!res.headersSent && !res.destroyed) {
          try {
            writeJson(res, 503, {
              error: {
                code: 'VERIFICATION_SERVICE_UNAVAILABLE',
                message: 'Verification service is temporarily unavailable.',
              },
            });
            return;
          } catch {
            // Fall through to terminate an unusable response stream.
          }
        }
        res.destroy();
      });
  };
}

function listen(server, { host, port }) {
  return new Promise((resolve, reject) => {
    function onError(error) {
      server.removeListener('listening', onListening);
      reject(error);
    }
    function onListening() {
      server.removeListener('error', onError);
      resolve();
    }
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeHttpServer(server, graceMs) {
  if (!server || !server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    function settle(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    }

    const timer = setTimeout(() => {
      try {
        server.closeAllConnections?.();
      } finally {
        settle();
      }
    }, graceMs);
    timer.unref?.();

    server.close((error) => settle(error));
    server.closeIdleConnections?.();
  });
}

function installShutdownSignals({ onSignal, signalSource = process }) {
  if (!signalSource || typeof signalSource.once !== 'function' || typeof signalSource.removeListener !== 'function') {
    throw new TypeError('signalSource must support once and removeListener.');
  }
  if (typeof onSignal !== 'function') throw new TypeError('onSignal must be a function.');

  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => onSignal(signal);
    handlers.set(signal, handler);
    signalSource.once(signal, handler);
  }

  return function uninstall() {
    for (const [signal, handler] of handlers) signalSource.removeListener(signal, handler);
    handlers.clear();
  };
}

async function startVerificationServer({
  connectStore = connectVerificationStore,
  createRequestHandler = createVerificationRequestHandler,
  createServer = http.createServer,
  env = process.env,
  installSignals = true,
  logger = console,
  now = Date.now,
  signalSource = process,
} = {}) {
  if (typeof connectStore !== 'function') throw new TypeError('connectStore must be a function.');
  if (typeof createRequestHandler !== 'function') throw new TypeError('createRequestHandler must be a function.');
  if (typeof createServer !== 'function') throw new TypeError('createServer must be a function.');
  if (!logger || typeof logger.info !== 'function' || typeof logger.error !== 'function') {
    throw new TypeError('logger must provide info and error functions.');
  }

  const config = loadRuntimeConfig(env);
  let store;
  let server;
  let uninstallSignals = () => {};
  let shutdownPromise;

  async function shutdown(reason = 'manual') {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      uninstallSignals();
      const failures = [];

      try {
        await closeHttpServer(server, config.http.shutdownGraceMs);
      } catch (error) {
        failures.push(error);
        logOperationalError(logger, 'HTTP shutdown', error);
      }

      try {
        await store?.close();
      } catch (error) {
        failures.push(error);
        logOperationalError(logger, 'MongoDB shutdown', error);
      }

      try {
        logger.info(`[verification] shutdown complete (${reason})`);
      } catch {
        // Logging is best effort.
      }

      if (failures.length) throw new AggregateError(failures, 'Verification service shutdown failed.');
    })();
    return shutdownPromise;
  }

  try {
    // The listener is intentionally created only after MongoDB is reachable and all required
    // indexes have been established by connectStore().
    store = await connectStore(config.mongo);
    const handler = createRequestHandler({
      collection: store.collection,
      healthCollection: store.healthCollection,
      now,
      onError: (error) => logOperationalError(logger, 'sync request', error),
      protocolConfig: config.protocol,
      publicConfig: config.publicVerification,
      publicKeys: config.publicKeys,
    });
    const requestListener = createSafeRequestListener(
      handler,
      (error) => logOperationalError(logger, 'request listener', error),
    );
    server = createServer(requestListener);
    await listen(server, config.http);

    if (installSignals) {
      uninstallSignals = installShutdownSignals({
        onSignal: (signal) => {
          shutdown(signal).catch((error) => {
            logOperationalError(logger, 'shutdown', error);
            if (signalSource === process) process.exitCode = 1;
          });
        },
        signalSource,
      });
    }

    const address = server.address();
    const listeningPort = typeof address === 'object' && address ? address.port : config.http.port;
    logger.info(`[verification] listening on ${config.http.host}:${listeningPort}`);

    return Object.freeze({
      address,
      config,
      server,
      shutdown,
      store,
    });
  } catch (error) {
    uninstallSignals();
    try {
      await closeHttpServer(server, config.http.shutdownGraceMs);
    } catch {
      // Preserve the startup error.
    }
    try {
      await store?.close();
    } catch {
      // Preserve the startup error.
    }
    throw error;
  }
}

if (require.main === module) {
  startVerificationServer().catch((error) => {
    logOperationalError(console, 'startup', error);
    process.exitCode = 1;
  });
}

module.exports = {
  createSafeRequestListener,
  closeHttpServer,
  installShutdownSignals,
  listen,
  logOperationalError,
  operationalErrorLabel,
  startVerificationServer,
};
