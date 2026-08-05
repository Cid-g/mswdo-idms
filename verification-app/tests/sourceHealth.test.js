'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SOURCE_HEALTH_ID,
  assertStoredSourceHealthIntegrity,
  materializeSourceHealth,
} = require('../src/models/sourceHealth');
const {
  SourceHealthConflictError,
  applySourceHealth,
  decideSourceHealthApplication,
} = require('../src/services/sourceHealthStore');
const {
  AUDIENCE,
  HEALTH_PATH,
  KEY_ID,
  TIMESTAMP,
  publicKey,
  signedHealth,
} = require('./fixtures');

const INTEGRITY_OPTIONS = Object.freeze({
  audience: AUDIENCE,
  path: HEALTH_PATH,
  publicKeys: Object.freeze({ [KEY_ID]: publicKey }),
});

class MemoryCollection {
  constructor(record = null) {
    this.record = record ? { ...record } : null;
    this.failWith = null;
  }

  async findOne(filter) {
    if (this.failWith) throw this.failWith;
    return this.record?._id === filter._id ? { ...this.record } : null;
  }

  async insertOne(document) {
    if (this.failWith) throw this.failWith;
    if (this.record) {
      const error = new Error('duplicate _id');
      error.code = 11000;
      throw error;
    }
    this.record = { ...document };
    return { insertedId: document._id };
  }

  async findOneAndUpdate(filter, update) {
    if (this.failWith) throw this.failWith;
    const matches = this.record
      && Object.entries(filter).every(([key, value]) => this.record[key] === value);
    if (!matches) return { value: null };
    this.record = { ...this.record, ...update.$set };
    return { value: { ...this.record } };
  }
}

function storedHealth(options = {}, receivedAt = TIMESTAMP + 50) {
  const health = signedHealth(options);
  return {
    ...materializeSourceHealth(health.verifiedRequest),
    _id: SOURCE_HEALTH_ID,
    receivedAt: new Date(receivedAt).toISOString(),
  };
}

test('materializes signed source health and re-verifies stored integrity', () => {
  const record = storedHealth();
  assert.equal(record.sourceLastHealthyAt, new Date(TIMESTAMP).toISOString());
  assert.equal(record.epoch, 1);
  assert.equal(assertStoredSourceHealthIntegrity(record, INTEGRITY_OPTIONS).payloadDigest, record.payloadDigest);
});

test('detects database mutation and unexpected fields in source health', () => {
  const record = storedHealth();
  assert.throws(
    () => assertStoredSourceHealthIntegrity({ ...record, sourceLastHealthyAt: new Date(TIMESTAMP + 1).toISOString() }, INTEGRITY_OPTIONS),
    (error) => error.code === 'SOURCE_HEALTH_MATERIALIZATION_MISMATCH',
  );
  assert.throws(
    () => assertStoredSourceHealthIntegrity({ ...record, fullName: 'Forbidden' }, INTEGRITY_OPTIONS),
    (error) => error.code === 'SOURCE_HEALTH_UNEXPECTED_FIELDS',
  );
});

test('source health ordering accepts newer epoch or heartbeat and exact replay only', () => {
  const existing = storedHealth();
  assert.equal(decideSourceHealthApplication(null, existing).action, 'INSERT');
  assert.equal(decideSourceHealthApplication(existing, storedHealth({ timestamp: TIMESTAMP + 1 })).reason, 'NEWER_HEARTBEAT');
  assert.equal(decideSourceHealthApplication(existing, storedHealth({ epoch: 2, timestamp: TIMESTAMP + 2 })).reason, 'NEWER_EPOCH');
  assert.equal(decideSourceHealthApplication(existing, { ...existing }).action, 'IDEMPOTENT');
});

test('source health ordering rejects stale epochs and timestamps', () => {
  const existing = storedHealth({ epoch: 2, timestamp: TIMESTAMP + 10 });
  assert.throws(
    () => decideSourceHealthApplication(existing, storedHealth({ epoch: 1, timestamp: TIMESTAMP + 20 })),
    (error) => error.code === 'STALE_SOURCE_HEALTH_EPOCH',
  );
  assert.throws(
    () => decideSourceHealthApplication(existing, storedHealth({ epoch: 2, timestamp: TIMESTAMP + 9 })),
    (error) => error.code === 'STALE_SOURCE_HEALTH_TIMESTAMP',
  );
});

test('atomically inserts, replays, and updates source health', async () => {
  const collection = new MemoryCollection();
  const first = signedHealth();
  const inserted = await applySourceHealth({
    collection,
    integrityOptions: INTEGRITY_OPTIONS,
    receivedAt: TIMESTAMP + 50,
    verifiedRequest: first.verifiedRequest,
  });
  assert.equal(inserted.outcome, 'INSERTED');
  assert.equal(collection.record._id, SOURCE_HEALTH_ID);

  const replay = await applySourceHealth({
    collection,
    integrityOptions: INTEGRITY_OPTIONS,
    receivedAt: TIMESTAMP + 60,
    verifiedRequest: first.verifiedRequest,
  });
  assert.equal(replay.outcome, 'IDEMPOTENT');
  assert.equal(collection.record.receivedAt, new Date(TIMESTAMP + 50).toISOString());

  const next = signedHealth({ timestamp: TIMESTAMP + 100 });
  const updated = await applySourceHealth({
    collection,
    integrityOptions: INTEGRITY_OPTIONS,
    receivedAt: TIMESTAMP + 110,
    verifiedRequest: next.verifiedRequest,
  });
  assert.equal(updated.outcome, 'UPDATED');
  assert.equal(collection.record.sourceLastHealthyAt, new Date(TIMESTAMP + 100).toISOString());
});

test('retries duplicate-key races and fails closed on repeated CAS contention', async () => {
  const incoming = signedHealth({ timestamp: TIMESTAMP + 100 });
  const winner = storedHealth({ timestamp: TIMESTAMP + 100 });
  const collection = new MemoryCollection();
  let inserts = 0;
  collection.insertOne = async () => {
    inserts += 1;
    collection.record = { ...winner };
    const error = new Error('duplicate');
    error.code = 11000;
    throw error;
  };
  const result = await applySourceHealth({
    collection,
    integrityOptions: INTEGRITY_OPTIONS,
    receivedAt: TIMESTAMP + 110,
    verifiedRequest: incoming.verifiedRequest,
  });
  assert.equal(inserts, 1);
  assert.equal(result.outcome, 'IDEMPOTENT');

  const stuck = new MemoryCollection(storedHealth());
  stuck.findOneAndUpdate = async () => ({ value: null });
  await assert.rejects(
    applySourceHealth({
      collection: stuck,
      integrityOptions: INTEGRITY_OPTIONS,
      maxAttempts: 2,
      receivedAt: TIMESTAMP + 110,
      verifiedRequest: incoming.verifiedRequest,
    }),
    (error) => error instanceof SourceHealthConflictError && error.code === 'SOURCE_HEALTH_CAS_EXHAUSTED',
  );
});
