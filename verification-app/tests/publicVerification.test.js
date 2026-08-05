'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SOURCE_HEALTH_ID,
  SourceHealthIntegrityError,
  materializeSourceHealth,
} = require('../src/models/sourceHealth');
const {
  StoredRecordIntegrityError,
  materializeVerifiedRecord,
} = require('../src/models/verifiedRecord');
const {
  PublicVerificationError,
  hashVerificationToken,
  normalizeVerificationToken,
  verifyPublicToken,
} = require('../src/services/publicVerification');
const {
  AUDIENCE,
  HEALTH_PATH,
  KEY_ID,
  PATH,
  publicKey,
  signedHealth,
  signedRecord,
  validRecordPayload,
} = require('./fixtures');

const RAW_TOKEN = '11111111-1111-4111-8111-111111111111';
const TOKEN_HASH = hashVerificationToken(RAW_TOKEN);
const NOW = Date.parse('2026-08-05T16:45:00.000Z');
const MAX_SYNC_AGE_MS = 300_000;

function recordDocument({
  epoch = 1,
  payload = validRecordPayload(),
  revision = 1,
} = {}) {
  const signed = signedRecord({ epoch, payload, revision, tokenHash: TOKEN_HASH });
  return {
    _id: 'record-1',
    ...materializeVerifiedRecord(signed.verifiedRequest),
  };
}

function healthDocument({
  epoch = 1,
  timestamp = NOW - 60_000,
} = {}) {
  const signed = signedHealth({ epoch, timestamp });
  return {
    _id: SOURCE_HEALTH_ID,
    ...materializeSourceHealth(signed.verifiedRequest),
    receivedAt: new Date(timestamp + 1_000).toISOString(),
  };
}

function collections(record, health) {
  return {
    collection: {
      filters: [],
      async findOne(filter) {
        this.filters.push(filter);
        return record ? { ...record } : null;
      },
    },
    healthCollection: {
      async findOne(filter) {
        assert.deepEqual(filter, { _id: SOURCE_HEALTH_ID });
        return health ? { ...health } : null;
      },
    },
  };
}

function verifyOptions(record, health, overrides = {}) {
  return {
    ...collections(record, health),
    healthPath: HEALTH_PATH,
    maxSyncAgeMs: MAX_SYNC_AGE_MS,
    now: () => NOW,
    publicKeys: { [KEY_ID]: publicKey },
    rawToken: RAW_TOKEN,
    recordAudience: AUDIENCE,
    recordPath: PATH,
    ...overrides,
  };
}

test('normalizes canonical UUID spelling and hashes the opaque token only', () => {
  assert.equal(normalizeVerificationToken(RAW_TOKEN.toUpperCase()), RAW_TOKEN);
  assert.equal(hashVerificationToken(RAW_TOKEN), TOKEN_HASH);
  assert.throws(
    () => normalizeVerificationToken('not-a-token'),
    (error) => error instanceof PublicVerificationError && error.code === 'INVALID_VERIFICATION_TOKEN',
  );
});

test('returns VALID only for signed ACTIVE state with fresh same-epoch source health', async () => {
  const record = recordDocument();
  const health = healthDocument();
  const options = verifyOptions(record, health, { rawToken: RAW_TOKEN.toUpperCase() });
  const result = await verifyPublicToken(options);

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.result, 'VALID');
  assert.equal(result.body.valid, true);
  assert.equal(result.body.status, 'ACTIVE');
  assert.equal(result.body.idTypeLabel, 'Person with Disability (PWD)');
  assert.equal(result.body.sourceLastHealthyAt, health.sourceLastHealthyAt);
  assert.equal(result.body.issuanceAnchor.anchored, true);
  assert.equal(result.body.issuanceAnchor.txId, record.txId);
  assert.deepEqual(options.collection.filters, [{ tokenHash: TOKEN_HASH }]);
  assert.equal(JSON.stringify(result.body).includes(RAW_TOKEN), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.body, 'anchoredHash'), false);
});

test('treats the exact freshness boundary as VALID and one millisecond beyond as UNKNOWN', async () => {
  const exact = await verifyPublicToken(verifyOptions(
    recordDocument(),
    healthDocument({ timestamp: NOW - MAX_SYNC_AGE_MS }),
  ));
  assert.equal(exact.body.result, 'VALID');

  const stale = await verifyPublicToken(verifyOptions(
    recordDocument(),
    healthDocument({ timestamp: NOW - MAX_SYNC_AGE_MS - 1 }),
  ));
  assert.equal(stale.body.result, 'UNKNOWN');
});

test('returns UNKNOWN when signed ACTIVE state has missing, stale, or different-epoch health', async () => {
  for (const health of [
    null,
    healthDocument({ timestamp: NOW - MAX_SYNC_AGE_MS - 1 }),
    healthDocument({ epoch: 2 }),
  ]) {
    const result = await verifyPublicToken(verifyOptions(recordDocument(), health));
    assert.equal(result.body.result, 'UNKNOWN');
    assert.equal(result.body.valid, null);
    assert.equal(result.body.status, 'ACTIVE');
    assert.match(result.body.message, /cannot be confirmed/i);
  }
});

test('returns terminal NOT_VALID for signed REVOKED state without requiring fresh health', async () => {
  const record = recordDocument({ payload: validRecordPayload({ status: 'REVOKED' }) });
  const result = await verifyPublicToken(verifyOptions(record, null));

  assert.equal(result.body.result, 'NOT_VALID');
  assert.equal(result.body.valid, false);
  assert.equal(result.body.status, 'REVOKED');
  assert.equal(result.body.sourceLastHealthyAt, null);
  assert.equal(Object.prototype.hasOwnProperty.call(result.body, 'revocationReason'), false);
});

test('applies read-time expiry to ACTIVE state before freshness evaluation', async () => {
  const record = recordDocument({
    payload: validRecordPayload({ expiryDate: '2026-08-05' }),
  });
  const result = await verifyPublicToken(verifyOptions(record, null));

  assert.equal(result.body.result, 'NOT_VALID');
  assert.equal(result.body.valid, false);
  assert.equal(result.body.status, 'EXPIRED');
});

test('returns stored EXPIRED as NOT_VALID and preserves a pending issuance receipt truthfully', async () => {
  const record = recordDocument({
    payload: validRecordPayload({
      anchoredAt: null,
      anchoredHash: null,
      blockNumber: null,
      status: 'EXPIRED',
      txId: null,
    }),
  });
  const result = await verifyPublicToken(verifyOptions(record, healthDocument()));

  assert.equal(result.body.result, 'NOT_VALID');
  assert.equal(result.body.status, 'EXPIRED');
  assert.deepEqual(result.body.issuanceAnchor, {
    anchored: false,
    txId: null,
    blockNumber: null,
    anchoredAt: null,
  });
});

test('returns a token-redacted NOT_FOUND result without reading source health', async () => {
  let healthReads = 0;
  const result = await verifyPublicToken({
    collection: { async findOne() { return null; } },
    healthCollection: { async findOne() { healthReads += 1; return null; } },
    healthPath: HEALTH_PATH,
    maxSyncAgeMs: MAX_SYNC_AGE_MS,
    now: () => NOW,
    publicKeys: { [KEY_ID]: publicKey },
    rawToken: RAW_TOKEN,
    recordAudience: AUDIENCE,
    recordPath: PATH,
  });

  assert.equal(result.statusCode, 404);
  assert.equal(result.body.result, 'NOT_FOUND');
  assert.equal(result.body.valid, false);
  assert.equal(healthReads, 0);
  assert.equal(JSON.stringify(result.body).includes(RAW_TOKEN), false);
  assert.equal(JSON.stringify(result.body).includes(TOKEN_HASH), false);
});

test('fails closed when stored signed record materialization was changed in the database', async () => {
  const record = recordDocument();
  record.maskedName = 'TAMPERED';
  await assert.rejects(
    verifyPublicToken(verifyOptions(record, healthDocument())),
    (error) => error instanceof StoredRecordIntegrityError,
  );
});

test('fails closed when stored signed source health was changed in the database', async () => {
  const health = healthDocument();
  health.sourceLastHealthyAt = new Date(NOW).toISOString();
  await assert.rejects(
    verifyPublicToken(verifyOptions(recordDocument(), health)),
    (error) => error instanceof SourceHealthIntegrityError,
  );
});
