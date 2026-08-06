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

function makeHistoryIterator(entries) {
  let index = 0;
  return {
    next: jest.fn(async () => {
      if (index >= entries.length) return { done: true };
      const value = entries[index];
      index += 1;
      return { done: false, value };
    }),
    close: jest.fn(async () => {}),
  };
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

describe('IDContract â€” getIDHistory', () => {
  let contract;

  beforeEach(() => { contract = new IDContract(); });

  test('returns empty array when no history exists', async () => {
    const ctx = makeMockCtx();
    const iterator = makeHistoryIterator([]);
    ctx.stub.getHistoryForKey.mockResolvedValue(iterator);

    const result = JSON.parse(await contract.getIDHistory(ctx, 'PWD-2026-0001'));

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
    expect(iterator.close).toHaveBeenCalledTimes(1);
  });

  test('maps a Fabric Long-like timestamp and preserves milliseconds', async () => {
    const ctx = makeMockCtx();
    const fakeEntry = {
      txId: 'tx-abc123',
      timestamp: {
        seconds: { toString: () => '1786038158' },
        nanos: 468999999,
      },
      isDelete: false,
      value: Buffer.from(JSON.stringify({ status: 'ACTIVE' })),
    };
    const iterator = makeHistoryIterator([fakeEntry]);
    ctx.stub.getHistoryForKey.mockResolvedValue(iterator);

    const result = JSON.parse(await contract.getIDHistory(ctx, 'PWD-2026-0001'));

    expect(result).toHaveLength(1);
    expect(result[0].txId).toBe('tx-abc123');
    expect(result[0].timestamp).toBe('2026-08-06T17:42:38.468Z');
    expect(result[0].isDelete).toBe(false);
    expect(result[0].record.status).toBe('ACTIVE');
    expect(iterator.close).toHaveBeenCalledTimes(1);
  });

  test('supports the legacy low/high protobuf integer shape', async () => {
    const ctx = makeMockCtx();
    const iterator = makeHistoryIterator([{
      txId: 'tx-low-high',
      timestamp: {
        seconds: { low: 1716000000, high: 0, unsigned: false },
        nanos: 0,
      },
      isDelete: false,
      value: Buffer.from(JSON.stringify({ status: 'ACTIVE' })),
    }]);
    ctx.stub.getHistoryForKey.mockResolvedValue(iterator);

    const result = JSON.parse(await contract.getIDHistory(ctx, 'PWD-2026-0001'));

    expect(result[0].timestamp).toBe('2024-05-18T02:40:00.000Z');
    expect(iterator.close).toHaveBeenCalledTimes(1);
  });

  test('returns null record for a delete history entry', async () => {
    const ctx = makeMockCtx();
    const iterator = makeHistoryIterator([{
      txId: 'tx-delete',
      timestamp: { seconds: '1786038158', nanos: 0 },
      isDelete: true,
      value: Buffer.alloc(0),
    }]);
    ctx.stub.getHistoryForKey.mockResolvedValue(iterator);

    const result = JSON.parse(await contract.getIDHistory(ctx, 'PWD-2026-0001'));

    expect(result[0].record).toBeNull();
    expect(result[0].isDelete).toBe(true);
    expect(iterator.close).toHaveBeenCalledTimes(1);
  });

  test('rejects malformed timestamps and still closes the iterator', async () => {
    const ctx = makeMockCtx();
    const iterator = makeHistoryIterator([{
      txId: 'tx-invalid-time',
      timestamp: { seconds: 'not-an-integer', nanos: 0 },
      isDelete: false,
      value: Buffer.from(JSON.stringify({ status: 'ACTIVE' })),
    }]);
    ctx.stub.getHistoryForKey.mockResolvedValue(iterator);

    await expect(
      contract.getIDHistory(ctx, 'PWD-2026-0001')
    ).rejects.toThrow('Invalid Fabric timestamp seconds');

    expect(iterator.close).toHaveBeenCalledTimes(1);
  });

  test('closes the iterator when history record parsing fails', async () => {
    const ctx = makeMockCtx();
    const iterator = makeHistoryIterator([{
      txId: 'tx-invalid-json',
      timestamp: { seconds: 1786038158n, nanos: 0 },
      isDelete: false,
      value: Buffer.from('{invalid-json'),
    }]);
    ctx.stub.getHistoryForKey.mockResolvedValue(iterator);

    await expect(
      contract.getIDHistory(ctx, 'PWD-2026-0001')
    ).rejects.toThrow();

    expect(iterator.close).toHaveBeenCalledTimes(1);
  });
});
