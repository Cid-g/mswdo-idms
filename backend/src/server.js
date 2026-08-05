'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const app = require('./app');
const {
  connectToFabric,
  disconnectFromFabric,
} = require('./fabric/connect');
const {
  startChainOutboxWorker,
  stopChainOutboxWorker,
} = require('./workers/chainOutboxWorker');
const {
  startExpiryJob,
  stopExpiryJob,
} = require('./jobs/expiryJob');

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mswdo_idms';

async function dropLegacyIndex(model, indexName, logger = console) {
  try {
    await model.collection.dropIndex(indexName);
    logger.log(`[migration] Dropped legacy index: ${indexName}`);
  } catch (err) {
    if (err.codeName !== 'IndexNotFound' && err.code !== 27) {
      logger.warn(`[migration] Could not drop ${indexName} index:`, err.message);
    }
  }
}

async function runMigrations({ logger = console } = {}) {
  const IDTemplate = require('./models/IDTemplate');
  const IDRecord = require('./models/IDRecord');
  await dropLegacyIndex(IDTemplate, 'department_1', logger);
  // Legacy full-unique index on applicantId blocked re-issuing an ID after revocation.
  // Dropped so the new partial unique index (ACTIVE-only) can take effect.
  await dropLegacyIndex(IDRecord, 'applicantId_1', logger);
}

function closeHttpServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function createServerLifecycle({
  appInstance = app,
  mongooseClient = mongoose,
  mongoUri = MONGODB_URI,
  port = PORT,
  migrationRunner = runMigrations,
  fabricConnector = connectToFabric,
  fabricDisconnector = disconnectFromFabric,
  outboxStarter = startChainOutboxWorker,
  outboxStopper = stopChainOutboxWorker,
  expiryStarter = startExpiryJob,
  expiryStopper = stopExpiryJob,
  logger = console,
} = {}) {
  let httpServer = null;
  let startPromise = null;
  let shutdownPromise = null;
  let shutdownRequested = false;
  let mongoConnected = false;
  let outboxStarted = false;
  let expiryStarted = false;
  let resourcesStopPromise = null;

  function attemptFabricConnection() {
    let attempt;
    try {
      // Invoke immediately so startup ordering is deterministic, but never await
      // this promise before starting workers or the HTTP listener.
      attempt = fabricConnector();
    } catch (error) {
      logger.error('[Fabric] Initial connection failed; worker will retry:', error.message);
      return;
    }

    Promise.resolve(attempt)
      .then((result) => {
        if (result?.available === false && result.reason === 'DISABLED') {
          logger.log('[Fabric] FABRIC_ENABLED=false — blockchain execution disabled');
        } else {
          logger.log('[Fabric] Initial connection established');
        }
      })
      .catch((error) => {
        logger.error('[Fabric] Initial connection failed; worker will retry:', error.message);
      });
  }

  function listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      const onListening = () => {
        if (typeof httpServer.off === 'function') httpServer.off('error', onError);
        resolve(httpServer);
      };
      httpServer = appInstance.listen(port, onListening);
      if (typeof httpServer.once === 'function') httpServer.once('error', onError);
    });
  }

  function assertStartupActive() {
    if (shutdownRequested) {
      const error = new Error('Server startup aborted by shutdown request');
      error.code = 'SERVER_STARTUP_ABORTED';
      throw error;
    }
  }

  function stopResources() {
    if (resourcesStopPromise) return resourcesStopPromise;

    resourcesStopPromise = (async () => {
      const errors = [];
      const capture = async (step) => {
        try {
          await step();
        } catch (error) {
          errors.push(error);
        }
      };

      // Both schedulers must be fully idle before the HTTP/Fabric/Mongo layers
      // are closed. This prevents an in-flight expiry transaction or outbox
      // settlement from losing its database connection during shutdown.
      await Promise.all([
        capture(async () => {
          if (outboxStarted) await outboxStopper();
          outboxStarted = false;
        }),
        capture(async () => {
          if (expiryStarted) await expiryStopper();
          expiryStarted = false;
        }),
      ]);

      await capture(async () => {
        await closeHttpServer(httpServer);
        httpServer = null;
      });
      await capture(async () => {
        await fabricDisconnector();
      });
      await capture(async () => {
        if (mongoConnected) await mongooseClient.disconnect();
        mongoConnected = false;
      });

      if (errors.length > 0) {
        throw new AggregateError(errors, 'Server shutdown completed with errors');
      }
    })();

    return resourcesStopPromise;
  }

  function start() {
    if (startPromise) return startPromise;
    if (shutdownPromise) {
      return Promise.reject(new Error('Server lifecycle is shutting down'));
    }

    startPromise = (async () => {
      try {
        await mongooseClient.connect(mongoUri);
        mongoConnected = true;
        assertStartupActive();
        // Preserved intentionally for this task; URI logging is a separately
        // documented issue and changing it is outside the approved scope.
        logger.log(`MongoDB connected: ${mongoUri}`);

        await migrationRunner({ logger });
        assertStartupActive();

        attemptFabricConnection();

        outboxStarter();
        outboxStarted = true;

        expiryStarter();
        expiryStarted = true;

        await listen();
        assertStartupActive();
        logger.log(`Backend running on http://localhost:${port}`);
        return httpServer;
      } catch (error) {
        try {
          await stopResources();
        } catch (cleanupError) {
          logger.error('Server startup cleanup failed:', cleanupError);
        }
        throw error;
      }
    })();

    return startPromise;
  }

  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shutdownRequested = true;
    shutdownPromise = (async () => {
      if (startPromise) {
        try {
          await startPromise;
        } catch (_) {
          // Startup failures run the same cleanup path below.
        }
      }
      await stopResources();
    })();
    return shutdownPromise;
  }

  return {
    shutdown,
    start,
  };
}

function registerSignalHandlers(lifecycle, {
  processRef = process,
  logger = console,
} = {}) {
  let signalHandled = false;

  const handleSignal = (signal) => {
    if (signalHandled) return;
    signalHandled = true;
    lifecycle.shutdown()
      .then(() => {
        logger.log(`[shutdown] ${signal} cleanup complete`);
        processRef.exitCode = 0;
      })
      .catch((error) => {
        logger.error(`[shutdown] ${signal} cleanup failed:`, error);
        processRef.exitCode = 1;
      });
  };

  processRef.once('SIGINT', () => handleSignal('SIGINT'));
  processRef.once('SIGTERM', () => handleSignal('SIGTERM'));
}

if (require.main === module) {
  const lifecycle = createServerLifecycle();
  registerSignalHandlers(lifecycle);
  lifecycle.start().catch((error) => {
    console.error('Backend startup failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  createServerLifecycle,
  dropLegacyIndex,
  registerSignalHandlers,
  runMigrations,
};
