'use strict';

const { Contract } = require('fabric-contract-api');

const MAX_DATE_MILLIS = 8640000000000000n;

function integerToBigInt(value, label) {
  if (typeof value === 'bigint') return value;

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Invalid ${label}`);
    }
    return BigInt(value);
  }

  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value)) {
      throw new Error(`Invalid ${label}`);
    }
    return BigInt(value);
  }

  if (value && typeof value.toString === 'function') {
    const decimal = value.toString();
    if (/^-?\d+$/.test(decimal)) {
      return BigInt(decimal);
    }
  }

  if (value && Number.isInteger(value.low)
      && (value.high === undefined || Number.isInteger(value.high))) {
    const low = BigInt(value.low >>> 0);
    const highValue = value.high ?? 0;
    const high = BigInt(highValue >>> 0);
    let result = (high << 32n) | low;

    if (!value.unsigned && (highValue & 0x80000000) !== 0) {
      result -= 1n << 64n;
    }

    return result;
  }

  throw new Error(`Invalid ${label}`);
}

function timestampToISOString(timestamp) {
  if (!timestamp) throw new Error('Invalid Fabric timestamp');

  const seconds = integerToBigInt(timestamp.seconds, 'Fabric timestamp seconds');
  const nanos = integerToBigInt(timestamp.nanos ?? 0, 'Fabric timestamp nanos');

  if (nanos < 0n || nanos >= 1000000000n) {
    throw new Error('Invalid Fabric timestamp nanos');
  }

  const millis = seconds * 1000n + nanos / 1000000n;
  if (millis < -MAX_DATE_MILLIS || millis > MAX_DATE_MILLIS) {
    throw new Error('Fabric timestamp is outside the supported date range');
  }

  return new Date(Number(millis)).toISOString();
}

function transactionTime(ctx) {
  return timestampToISOString(ctx.stub.getTxTimestamp());
}

class IDContract extends Contract {

  async issueID(ctx, recordRef, idType, soloParentIdType, hash, issuingOffice) {
    const existing = await ctx.stub.getState(recordRef);
    if (existing && existing.length > 0) {
      throw new Error(`ID record ${recordRef} already exists on chain`);
    }

    const now = transactionTime(ctx);
    const record = {
      recordRef,
      idType,
      soloParentIdType: soloParentIdType || null,
      hash,
      status: 'ACTIVE',
      issuingOffice,
      issuedAt: now,
      lastUpdatedAt: now,
    };

    await ctx.stub.putState(recordRef, Buffer.from(JSON.stringify(record)));
    ctx.stub.setEvent('IDIssued', Buffer.from(JSON.stringify({ recordRef, idType })));
    return JSON.stringify(record);
  }

  async verifyID(ctx, recordRef) {
    const data = await ctx.stub.getState(recordRef);
    if (!data || data.length === 0) {
      return JSON.stringify({ found: false, recordRef });
    }
    return JSON.stringify({ found: true, ...JSON.parse(data.toString()) });
  }

  async revokeID(ctx, recordRef, reason) {
    const data = await ctx.stub.getState(recordRef);
    if (!data || data.length === 0) {
      throw new Error(`ID record ${recordRef} not found on chain`);
    }

    const record = JSON.parse(data.toString());
    const now = transactionTime(ctx);
    record.status = 'REVOKED';
    record.revokedAt = now;
    record.revokedReason = reason;
    record.lastUpdatedAt = now;

    await ctx.stub.putState(recordRef, Buffer.from(JSON.stringify(record)));
    ctx.stub.setEvent('IDRevoked', Buffer.from(JSON.stringify({ recordRef, reason })));
    return JSON.stringify(record);
  }

  async getIDHistory(ctx, recordRef) {
    const iterator = await ctx.stub.getHistoryForKey(recordRef);
    try {
      const history = [];
      let result = await iterator.next();
      while (!result.done) {
        const { txId, timestamp, isDelete, value } = result.value;
        history.push({
          txId,
          timestamp: timestampToISOString(timestamp),
          isDelete,
          record: value && value.length > 0 ? JSON.parse(value.toString()) : null,
        });
        result = await iterator.next();
      }
      return JSON.stringify(history);
    } finally {
      await iterator.close();
    }
  }

  async expireID(ctx, recordRef) {
    const data = await ctx.stub.getState(recordRef);
    if (!data || data.length === 0) {
      throw new Error(`ID record ${recordRef} not found on chain`);
    }
    const record = JSON.parse(data.toString());
    if (record.status === 'REVOKED') {
      throw new Error('Cannot expire a revoked record');
    }
    const now = transactionTime(ctx);
    record.status = 'EXPIRED';
    record.expiredAt = now;
    record.lastUpdatedAt = now;
    await ctx.stub.putState(recordRef, Buffer.from(JSON.stringify(record)));
    return JSON.stringify(record);
  }
}

module.exports = IDContract;
