'use strict';

// fabric-contract-api is mapped to a stub in jest.config.js moduleNameMapper
const IDContract = require('../../../blockchain/chaincode/id-contract');

// ── Mock ctx factory ──────────────────────────────────────────────────────────
function makeMockCtx() {
  const store  = {};
  const events = [];
  const txTime = '2026-08-03T12:34:56.789Z';

  const stub = {
    getState: jest.fn(async (key) => {
      const val = store[key];
      return val ? Buffer.from(val) : Buffer.alloc(0);
    }),
    putState: jest.fn(async (key, value) => {
      store[key] = value.toString();
    }),
    setEvent: jest.fn((name, data) => {
      events.push({ name, data: data.toString() });
    }),
    getHistoryForKey: jest.fn(async () => {
      // Return an empty iterator by default
      return {
        next:  jest.fn(async () => ({ done: true })),
        close: jest.fn(async () => {}),
      };
    }),
    getTxTimestamp: jest.fn(() => ({
      seconds: { toString: () => String(Math.floor(Date.parse(txTime) / 1000)) },
      nanos: 789000000,
    })),
  };

  return { stub, _store: store, _events: events };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IDContract — issueID', () => {
  let contract;

  beforeEach(() => { contract = new IDContract(); });

  test('creates a new record with ACTIVE status', async () => {
    const ctx = makeMockCtx();
    const result = JSON.parse(
      await contract.issueID(ctx, 'PWD-2026-0001', 'PWD', '', 'abc123hash', 'MSWDO-GERONA')
    );

    expect(result.recordRef).toBe('PWD-2026-0001');
    expect(result.status).toBe('ACTIVE');
    expect(result.hash).toBe('abc123hash');
    expect(result.issuingOffice).toBe('MSWDO-GERONA');
    expect(result.issuedAt).toBe('2026-08-03T12:34:56.789Z');
    expect(result.lastUpdatedAt).toBe('2026-08-03T12:34:56.789Z');
    expect(ctx.stub.putState).toHaveBeenCalledTimes(1);
    expect(ctx._events).toHaveLength(1);
    expect(ctx._events[0].name).toBe('IDIssued');
  });

  test('throws if the record already exists', async () => {
    const ctx = makeMockCtx();
    // Pre-populate store to simulate existing record
    ctx._store['PWD-2026-0001'] = JSON.stringify({ recordRef: 'PWD-2026-0001' });

    await expect(
      contract.issueID(ctx, 'PWD-2026-0001', 'PWD', '', 'hash', 'MSWDO')
    ).rejects.toThrow('already exists');
  });
});

describe('IDContract — verifyID', () => {
  let contract;

  beforeEach(() => { contract = new IDContract(); });

  test('returns found:false when record does not exist', async () => {
    const ctx = makeMockCtx();
    const result = JSON.parse(await contract.verifyID(ctx, 'PWD-MISSING'));
    expect(result.found).toBe(false);
    expect(result.recordRef).toBe('PWD-MISSING');
  });

  test('returns found:true with record data when record exists', async () => {
    const ctx = makeMockCtx();
    ctx._store['PWD-2026-0001'] = JSON.stringify({
      recordRef: 'PWD-2026-0001', status: 'ACTIVE', hash: 'abc',
    });
    const result = JSON.parse(await contract.verifyID(ctx, 'PWD-2026-0001'));
    expect(result.found).toBe(true);
    expect(result.status).toBe('ACTIVE');
  });
});

describe('IDContract — revokeID', () => {
  let contract;

  beforeEach(() => { contract = new IDContract(); });

  test('sets status to REVOKED and stores reason', async () => {
    const ctx = makeMockCtx();
    ctx._store['PWD-2026-0001'] = JSON.stringify({ recordRef: 'PWD-2026-0001', status: 'ACTIVE' });

    const result = JSON.parse(
      await contract.revokeID(ctx, 'PWD-2026-0001', 'Lost card reported')
    );
    expect(result.status).toBe('REVOKED');
    expect(result.revokedReason).toBe('Lost card reported');
    expect(result.revokedAt).toBe('2026-08-03T12:34:56.789Z');
    expect(result.lastUpdatedAt).toBe('2026-08-03T12:34:56.789Z');
    expect(ctx._events[0].name).toBe('IDRevoked');
  });

  test('throws if record does not exist', async () => {
    const ctx = makeMockCtx();
    await expect(
      contract.revokeID(ctx, 'PWD-MISSING', 'reason')
    ).rejects.toThrow('not found');
  });
});

describe('IDContract — expireID', () => {
  let contract;

  beforeEach(() => { contract = new IDContract(); });

  test('sets status to EXPIRED', async () => {
    const ctx = makeMockCtx();
    ctx._store['PWD-2026-0001'] = JSON.stringify({ recordRef: 'PWD-2026-0001', status: 'ACTIVE' });

    const result = JSON.parse(await contract.expireID(ctx, 'PWD-2026-0001'));
    expect(result.status).toBe('EXPIRED');
    expect(result.expiredAt).toBe('2026-08-03T12:34:56.789Z');
    expect(result.lastUpdatedAt).toBe('2026-08-03T12:34:56.789Z');
  });

  test('throws if record does not exist', async () => {
    const ctx = makeMockCtx();
    await expect(contract.expireID(ctx, 'MISSING')).rejects.toThrow('not found');
  });

  test('throws if record is already REVOKED', async () => {
    const ctx = makeMockCtx();
    ctx._store['PWD-2026-0001'] = JSON.stringify({ status: 'REVOKED' });
    await expect(contract.expireID(ctx, 'PWD-2026-0001')).rejects.toThrow('Cannot expire a revoked record');
  });
});

describe('IDContract — getIDHistory', () => {
  let contract;

  beforeEach(() => { contract = new IDContract(); });

  test('returns empty array when no history exists', async () => {
    const ctx = makeMockCtx();
    const result = JSON.parse(await contract.getIDHistory(ctx, 'PWD-2026-0001'));
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('maps iterator entries into history objects', async () => {
    const ctx = makeMockCtx();
    const fakeEntry = {
      txId:     'tx-abc123',
      timestamp: { seconds: { low: 1716000000 } },
      isDelete: false,
      value:    Buffer.from(JSON.stringify({ status: 'ACTIVE' })),
    };
    let called = false;
    ctx.stub.getHistoryForKey = jest.fn(async () => ({
      next: jest.fn(async () => {
        if (!called) { called = true; return { done: false, value: fakeEntry }; }
        return { done: true };
      }),
      close: jest.fn(async () => {}),
    }));

    const result = JSON.parse(await contract.getIDHistory(ctx, 'PWD-2026-0001'));
    expect(result).toHaveLength(1);
    expect(result[0].txId).toBe('tx-abc123');
    expect(result[0].record.status).toBe('ACTIVE');
  });
});
