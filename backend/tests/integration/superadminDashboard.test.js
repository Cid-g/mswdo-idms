'use strict';

const supertest = require('supertest');
const app = require('../../src/app');
const db = require('../dbHelpers');
const AuditLog = require('../../src/models/AuditLog');
const { createTestUser, getToken } = require('../testHelpers');

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.disconnect(); });
afterEach(async () => { await db.clear(); });

describe('GET /api/dashboard/superadmin', () => {
  test('returns totalCounts, userCounts, idTrend, and system-wide recentActivity', async () => {
    await createTestUser({ username: 'super1', role: 'SUPERADMIN', department: null });
    const token = await getToken(app, 'super1');

    // audit logs from different departments — superadmin sees all
    await AuditLog.create([
      { action: 'LOGIN', description: 'PWD admin logged in', department: 'PWD' },
      { action: 'ID_GENERATED', description: 'Solo Parent ID generated', department: 'SOLO_PARENT' },
    ]);

    const res = await supertest(app)
      .get('/api/dashboard/superadmin')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalCounts).toBeTruthy();
    expect(res.body.userCounts).toBeTruthy();
    expect(Array.isArray(res.body.idTrend)).toBe(true);
    expect(res.body.idTrend).toHaveLength(12);
    expect(Array.isArray(res.body.recentActivity)).toBe(true);
    expect(res.body.recentActivity.length).toBe(2);
    // both departments' events are visible system-wide (order-independent)
    const descs = res.body.recentActivity.map((a) => a.description);
    expect(descs).toContain('Solo Parent ID generated');
    expect(descs).toContain('PWD admin logged in');
  });
});
