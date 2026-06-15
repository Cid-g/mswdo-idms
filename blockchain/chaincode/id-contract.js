'use strict';

const { Contract } = require('fabric-contract-api');

class IDContract extends Contract {

  async issueID(ctx, recordRef, idType, soloParentIdType, hash, issuingOffice) {
    const existing = await ctx.stub.getState(recordRef);
    if (existing && existing.length > 0) {
      throw new Error(`ID record ${recordRef} already exists on chain`);
    }

    const record = {
      recordRef,
      idType,
      soloParentIdType: soloParentIdType || null,
      hash,
      status: 'ACTIVE',
      issuingOffice,
      issuedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
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
    record.status = 'REVOKED';
    record.revokedAt = new Date().toISOString();
    record.revokedReason = reason;
    record.lastUpdatedAt = new Date().toISOString();

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
    record.status = 'EXPIRED';
    record.expiredAt = new Date().toISOString();
    record.lastUpdatedAt = new Date().toISOString();
    await ctx.stub.putState(recordRef, Buffer.from(JSON.stringify(record)));
    return JSON.stringify(record);
  }
}

module.exports = IDContract;
