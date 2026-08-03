'use strict';

const { Contract } = require('fabric-contract-api');

function transactionTime(ctx) {
  const timestamp = ctx.stub.getTxTimestamp();
  const seconds = BigInt(timestamp.seconds.toString());
  const millis = seconds * 1000n + BigInt(Math.floor(timestamp.nanos / 1_000_000));
  return new Date(Number(millis)).toISOString();
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
    const history = [];
    let result = await iterator.next();
    while (!result.done) {
      const { txId, timestamp, isDelete, value } = result.value;
      history.push({
        txId,
        timestamp: new Date(timestamp.seconds.low * 1000).toISOString(),
        isDelete,
        record: value ? JSON.parse(value.toString()) : null,
      });
      result = await iterator.next();
    }
    await iterator.close();
    return JSON.stringify(history);
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
