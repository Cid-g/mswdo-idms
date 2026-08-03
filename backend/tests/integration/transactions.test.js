'use strict';

const mongoose = require('mongoose');
const db = require('../dbHelpers');
const Sequence = require('../../src/models/Sequence');

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.disconnect(); });
afterEach(async () => { await db.clear(); });

test('commits a multi-document transaction', async () => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await Sequence.create([{ name: 'tx-smoke-a', value: 1 }], { session });
      await Sequence.create([{ name: 'tx-smoke-b', value: 2 }], { session });
    });
  } finally {
    await session.endSession();
  }

  expect(await Sequence.countDocuments({ name: /^tx-smoke-/ })).toBe(2);
});
