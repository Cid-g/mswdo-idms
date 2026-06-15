'use strict';

const db = require('../dbHelpers');
const { nextCaseNumber, caseNumberToSPIC } = require('../../src/services/sequences');

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.disconnect(); });
afterEach(async () => { await db.clear(); });

describe('nextCaseNumber (Solo Parent)', () => {
  test('YYMM-NNNNNN with a CONTINUOUS 6-digit counter across months and years', async () => {
    // Matches the spec example: the number keeps running; only YYMM changes with the date.
    expect(await nextCaseNumber(new Date(2023, 0, 15))).toBe('2301-000001');
    expect(await nextCaseNumber(new Date(2023, 1, 15))).toBe('2302-000002'); // NOT reset to 000001
    expect(await nextCaseNumber(new Date(2023, 11, 15))).toBe('2312-000003');
    expect(await nextCaseNumber(new Date(2024, 0, 15))).toBe('2401-000004'); // NOT reset across year
    expect(await nextCaseNumber(new Date(2024, 0, 16))).toBe('2401-000005');
  });

  test('caseNumberToSPIC prefixes the LGU PSGC code', () => {
    expect(caseNumberToSPIC('2401-000004')).toBe('036906000-2401-000004');
  });
});
