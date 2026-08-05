'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VerifiedRecordConflictError,
  applyVerifiedRecord,
  decideRecordApplication,
  ensureVerifiedRecordIndexes,
} = require('../src/services/verifiedRecordStore');
const {
  StoredRecordIntegrityError,
  materializeVerifiedRecord,
} = require('../src/models/verifiedRecord');
const {
  AUDIENCE,
  PATH,
  publicKey,
  signedRecord,
  validRecordPayload,
} = require('./fixtures');

const INTEGRITY_OPTIONS = Object.freeze({
  audience: AUDIENCE,
  path: PATH,
  publicKeys: { 'office-key-2026-01': publicKey },
});

function matches(record, filter) {
  return Object.entries(filter).every(([key, value]) => record?.[key] === value);
}

class MemoryCollection {
  constructor(record = null) {
    this.record = record ? { ...record } : null;
    this.beforeInsert = null;
    this.beforeUpdate = null;
    this.nextId = 1;
    this.indexes = [];
  }

  async createIndex(key, options) {
    this.indexes.push({ key, options });
    return options.name;
  }

  async findOne(filter) {
    return matches(this.record, filter) ? { ...this.record } : null;
  }

  async insertOne(document) {
    if (this.beforeInsert) await this.beforeInsert(this, document);
    if (this.record?.tokenHash === document.tokenHash) {
      const error = new Error('duplicate tokenHash');
      error.code = 11000;
      throw error;
    }
    this.record = { ...document, _id: `record-${this.nextId++}` };
    return { insertedId: this.record._id };
  }

  async findOneAndUpdate(filter, update) {
    if (this.beforeUpdate) await this.beforeUpdate(this, filter, update);
    if (!matches(this.record, filter)) return { value: null };
    this.record = { ...this.record, ...update.$set };
    return { value: { ...this.record } };
  }
}

function incoming(options = {}) {
  return materializeVerifiedRecord(signedRecord(options).verifiedRequest);
}

test('creates the required unique token-hash index before serving writes', async () => {
  const collection = new MemoryCollection();
  const names = await ensureVerifiedRecordIndexes(collection);

  assert.deepEqual(names, ['uniq_token_hash', 'status_1']);
  assert.deepEqual(collection.indexes[0], {
    key: { tokenHash: 1 },
    options: { name: 'uniq_token_hash', unique: true },
  });
});

test('decision table inserts new tokens and accepts strictly newer revisions', () => {
  const next = incoming({ revision: 2 });
  assert.equal(decideRecordApplication(null, next).action, 'INSERT');

  const existing = incoming({ revision: 1 });
  assert.deepEqual(decideRecordApplication(existing, next), {
    action: 'UPDATE',
    reason: 'NEWER_REVISION',
  });
});

test('higher epoch supersedes any older revision number', () => {
  const existing = incoming({ epoch: 3, revision: 999 });
  const restored = incoming({ epoch: 4, revision: 1 });
  assert.deepEqual(decideRecordApplication(existing, restored), {
    action: 'UPDATE',
    reason: 'NEWER_EPOCH',
  });
});

test('equal epoch and revision are idempotent only for the same digest', () => {
  const existing = incoming({ epoch: 2, revision: 7 });
  const same = incoming({ epoch: 2, revision: 7 });
  assert.equal(decideRecordApplication(existing, same).action, 'IDEMPOTENT');

  const conflict = incoming({
    epoch: 2,
    revision: 7,
    payload: validRecordPayload({ maskedName: 'X****, Y****' }),
  });
  assert.throws(
    () => decideRecordApplication(existing, conflict),
    (error) => error.code === 'EQUAL_REVISION_DIGEST_CONFLICT',
  );
});

test('rejects stale epochs and stale revisions explicitly', () => {
  const existing = incoming({ epoch: 5, revision: 10 });
  assert.throws(
    () => decideRecordApplication(existing, incoming({ epoch: 4, revision: 999 })),
    (error) => error.code === 'STALE_VERIFICATION_EPOCH',
  );
  assert.throws(
    () => decideRecordApplication(existing, incoming({ epoch: 5, revision: 9 })),
    (error) => error.code === 'STALE_VERIFICATION_REVISION',
  );
});

test('keeps REVOKED terminal across revisions and restore epochs', () => {
  const revoked = incoming({ payload: validRecordPayload({ status: 'REVOKED' }) });
  for (const candidate of [
    incoming({ revision: 2, payload: validRecordPayload({ status: 'ACTIVE' }) }),
    incoming({ epoch: 2, revision: 1, payload: validRecordPayload({ status: 'EXPIRED' }) }),
  ]) {
    assert.throws(
      () => decideRecordApplication(revoked, candidate),
      (error) => error.code === 'TERMINAL_REVOKED_RECORD',
    );
  }

  assert.equal(
    decideRecordApplication(
      revoked,
      incoming({ revision: 2, payload: validRecordPayload({ status: 'REVOKED', maskedName: 'D****, L****' }) }),
    ).action,
    'UPDATE',
  );
});

test('re-authenticates incoming signed bytes at the persistence boundary', async () => {
  const request = signedRecord().verifiedRequest;
  const collection = new MemoryCollection();

  await assert.rejects(
    applyVerifiedRecord({
      collection,
      integrityOptions: INTEGRITY_OPTIONS,
      verifiedRequest: { ...request, signature: 'A'.repeat(88) },
    }),
    (error) => error.code === 'INVALID_SIGNATURE_ENCODING',
  );
});

test('atomically inserts a new verified record', async () => {
  const request = signedRecord({ revision: 3 }).verifiedRequest;
  const collection = new MemoryCollection();
  const result = await applyVerifiedRecord({ collection, integrityOptions: INTEGRITY_OPTIONS, verifiedRequest: request });

  assert.equal(result.outcome, 'INSERTED');
  assert.equal(result.applied, true);
  assert.equal(collection.record.revision, 3);
  assert.equal(collection.record.signedPayload, request.signedPayload);
});

test('treats exact replay as idempotent without replacing stored signed evidence', async () => {
  const first = signedRecord({ timestamp: 1785940200123 }).verifiedRequest;
  const existing = materializeVerifiedRecord(first);
  const collection = new MemoryCollection({ ...existing, _id: 'record-1' });
  const replay = signedRecord({ timestamp: 1785940200999 }).verifiedRequest;

  const result = await applyVerifiedRecord({ collection, integrityOptions: INTEGRITY_OPTIONS, verifiedRequest: replay });
  assert.equal(result.outcome, 'IDEMPOTENT');
  assert.equal(collection.record.signedPayload, first.signedPayload);
});

test('uses compare-and-swap and retries after a concurrent winner', async () => {
  const existing = materializeVerifiedRecord(signedRecord({ revision: 1 }).verifiedRequest);
  const collection = new MemoryCollection({ ...existing, _id: 'record-1' });
  let raced = false;
  collection.beforeUpdate = async (store) => {
    if (raced) return;
    raced = true;
    const concurrent = materializeVerifiedRecord(signedRecord({ revision: 2 }).verifiedRequest);
    store.record = { ...store.record, ...concurrent };
  };

  const incomingRequest = signedRecord({ revision: 3 }).verifiedRequest;
  const result = await applyVerifiedRecord({ collection, integrityOptions: INTEGRITY_OPTIONS, verifiedRequest: incomingRequest });

  assert.equal(result.outcome, 'UPDATED');
  assert.equal(collection.record.revision, 3);
});

test('retries duplicate-key insert races and then returns idempotent', async () => {
  const request = signedRecord({ revision: 1 }).verifiedRequest;
  const collection = new MemoryCollection();
  collection.beforeInsert = async (store) => {
    if (store.record) return;
    store.record = {
      ...materializeVerifiedRecord(request),
      _id: 'concurrent-record',
    };
  };

  const result = await applyVerifiedRecord({ collection, integrityOptions: INTEGRITY_OPTIONS, verifiedRequest: request });
  assert.equal(result.outcome, 'IDEMPOTENT');
  assert.equal(collection.record._id, 'concurrent-record');
});

test('refuses to make ordering decisions from database-tampered stored state', async () => {
  const existing = materializeVerifiedRecord(signedRecord({ revision: 1 }).verifiedRequest);
  const collection = new MemoryCollection({ ...existing, _id: 'record-1', status: 'REVOKED' });

  await assert.rejects(
    applyVerifiedRecord({
      collection,
      integrityOptions: INTEGRITY_OPTIONS,
      verifiedRequest: signedRecord({ revision: 2 }).verifiedRequest,
    }),
    StoredRecordIntegrityError,
  );
});

test('fails closed when compare-and-swap contention never settles', async () => {
  const existing = materializeVerifiedRecord(signedRecord({ revision: 1 }).verifiedRequest);
  const collection = new MemoryCollection({ ...existing, _id: 'record-1' });
  collection.findOneAndUpdate = async () => ({ value: null });

  await assert.rejects(
    applyVerifiedRecord({
      collection,
      integrityOptions: INTEGRITY_OPTIONS,
      maxAttempts: 2,
      verifiedRequest: signedRecord({ revision: 2 }).verifiedRequest,
    }),
    (error) => error instanceof VerifiedRecordConflictError
      && error.code === 'VERIFICATION_RECORD_CAS_EXHAUSTED',
  );
});

test('rejects malformed stored ordering metadata instead of guessing', () => {
  assert.throws(
    () => decideRecordApplication({
      tokenHash: 'c'.repeat(64),
      epoch: 1,
      revision: Number.MAX_SAFE_INTEGER + 1,
      payloadDigest: 'a'.repeat(64),
      status: 'ACTIVE',
    }, incoming()),
    (error) => error.code === 'STORED_RECORD_ORDERING_INVALID',
  );
});
