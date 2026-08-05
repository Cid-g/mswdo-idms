'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MONGO_APP_NAME,
  connectVerificationStore,
  validateMongoConfig,
} = require('../src/db/mongo');
const { SOURCE_HEALTH_COLLECTION } = require('../src/models/sourceHealth');
const { VERIFIED_RECORD_COLLECTION } = require('../src/models/verifiedRecord');

function fakeMongo({ events, failCommand, failConnect } = {}) {
  const collection = { name: VERIFIED_RECORD_COLLECTION };
  const healthCollection = { name: SOURCE_HEALTH_COLLECTION };
  class FakeMongoClient {
    constructor(uri, options) {
      this.uri = uri;
      this.options = options;
      this.closeCalls = 0;
      FakeMongoClient.instance = this;
      events?.push('construct');
    }

    async connect() {
      events?.push('connect');
      if (failConnect) throw failConnect;
    }

    db(name) {
      events?.push(`db:${name}`);
      return {
        async command(command) {
          events?.push(`command:${Object.keys(command)[0]}`);
          if (failCommand) throw failCommand;
          return { ok: 1 };
        },
        collection(collectionName) {
          events?.push(`collection:${collectionName}`);
          return collectionName === SOURCE_HEALTH_COLLECTION ? healthCollection : collection;
        },
      };
    }

    async close() {
      this.closeCalls += 1;
      events?.push('close');
    }
  }
  return { collection, healthCollection, FakeMongoClient };
}

const config = Object.freeze({
  databaseName: 'verification_test',
  serverSelectionTimeoutMs: 4321,
  uri: 'mongodb://example.invalid:27017',
});

test('connects, pings, and creates required indexes before returning the store', async () => {
  const events = [];
  const { collection, healthCollection, FakeMongoClient } = fakeMongo({ events });
  const store = await connectVerificationStore(config, {
    MongoClientClass: FakeMongoClient,
    ensureIndexes: async (received) => {
      events.push('indexes');
      assert.equal(received, collection);
      return Object.freeze(['uniq_token_hash', 'status_1']);
    },
  });

  assert.deepEqual(events, [
    'construct',
    'connect',
    'db:verification_test',
    'command:ping',
    `collection:${VERIFIED_RECORD_COLLECTION}`,
    `collection:${SOURCE_HEALTH_COLLECTION}`,
    'indexes',
  ]);
  assert.equal(FakeMongoClient.instance.uri, config.uri);
  assert.equal(FakeMongoClient.instance.options.appName, MONGO_APP_NAME);
  assert.equal(FakeMongoClient.instance.options.serverSelectionTimeoutMS, 4321);
  assert.equal(store.collection, collection);
  assert.equal(store.healthCollection, healthCollection);
  assert.deepEqual(store.indexNames, ['uniq_token_hash', 'status_1']);

  await store.close();
  await store.close();
  assert.equal(FakeMongoClient.instance.closeCalls, 1);
});

test('closes the client and preserves the original startup failure', async () => {
  const events = [];
  const indexFailure = new Error('index contract mismatch');
  const { FakeMongoClient } = fakeMongo({ events });

  await assert.rejects(
    connectVerificationStore(config, {
      MongoClientClass: FakeMongoClient,
      ensureIndexes: async () => { throw indexFailure; },
    }),
    (error) => error === indexFailure,
  );
  assert.equal(FakeMongoClient.instance.closeCalls, 1);
  assert.equal(events.at(-1), 'close');
});

test('closes a client whose connection attempt fails', async () => {
  const connectFailure = new Error('unreachable');
  const { FakeMongoClient } = fakeMongo({ failConnect: connectFailure });
  await assert.rejects(
    connectVerificationStore(config, { MongoClientClass: FakeMongoClient }),
    (error) => error === connectFailure,
  );
  assert.equal(FakeMongoClient.instance.closeCalls, 1);
});

test('rejects incomplete Mongo lifecycle configuration', () => {
  assert.throws(() => validateMongoConfig(), /required/);
  assert.throws(() => validateMongoConfig({ ...config, uri: '' }), /URI/);
  assert.throws(() => validateMongoConfig({ ...config, databaseName: '' }), /database name/);
  assert.throws(() => validateMongoConfig({ ...config, serverSelectionTimeoutMs: 0 }), /timeout/);
});
