'use strict';

const { SOURCE_HEALTH_COLLECTION } = require('../models/sourceHealth');
const { VERIFIED_RECORD_COLLECTION } = require('../models/verifiedRecord');
const { ensureVerifiedRecordIndexes } = require('../services/verifiedRecordStore');

const MONGO_APP_NAME = 'mswdo-verification-service';

function resolveMongoClientClass(override) {
  if (override) return override;
  // Loaded lazily so protocol/unit tests remain independent from a running database.
  // eslint-disable-next-line global-require
  return require('mongodb').MongoClient;
}

function validateMongoConfig(config) {
  if (!config || typeof config !== 'object') throw new TypeError('Mongo configuration is required.');
  if (typeof config.uri !== 'string' || !config.uri) throw new TypeError('Mongo URI is required.');
  if (typeof config.databaseName !== 'string' || !config.databaseName) {
    throw new TypeError('Mongo database name is required.');
  }
  if (!Number.isSafeInteger(config.serverSelectionTimeoutMs) || config.serverSelectionTimeoutMs <= 0) {
    throw new TypeError('Mongo server-selection timeout must be a positive safe integer.');
  }
}

async function connectVerificationStore(config, {
  MongoClientClass,
  ensureIndexes = ensureVerifiedRecordIndexes,
} = {}) {
  validateMongoConfig(config);
  if (typeof ensureIndexes !== 'function') throw new TypeError('ensureIndexes must be a function.');

  const Client = resolveMongoClientClass(MongoClientClass);
  const client = new Client(config.uri, {
    appName: MONGO_APP_NAME,
    serverSelectionTimeoutMS: config.serverSelectionTimeoutMs,
  });
  let closed = false;

  async function close() {
    if (closed) return;
    closed = true;
    await client.close();
  }

  try {
    await client.connect();
    const database = client.db(config.databaseName);
    await database.command({ ping: 1 });
    const collection = database.collection(VERIFIED_RECORD_COLLECTION);
    const healthCollection = database.collection(SOURCE_HEALTH_COLLECTION);
    const indexNames = await ensureIndexes(collection);

    return Object.freeze({
      client,
      close,
      collection,
      database,
      healthCollection,
      indexNames,
    });
  } catch (error) {
    try {
      await close();
    } catch {
      // Preserve the startup failure that prevented a safe listener.
    }
    throw error;
  }
}

module.exports = {
  MONGO_APP_NAME,
  connectVerificationStore,
  resolveMongoClientClass,
  validateMongoConfig,
};
