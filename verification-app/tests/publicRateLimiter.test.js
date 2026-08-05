'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FixedWindowKeyedCounter,
  createPublicRateLimiter,
  normalizeClientIp,
} = require('../src/services/publicRateLimiter');

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

test('normalizes socket IPs without trusting forwarded headers', () => {
  assert.equal(normalizeClientIp('127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeClientIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeClientIp('2001:DB8::1'), '2001:db8::1');
  assert.equal(normalizeClientIp('not-an-ip'), 'unknown');
  assert.equal(normalizeClientIp(undefined), 'unknown');
});

test('enforces ingress limits per IP and resets at the fixed-window boundary', () => {
  const limiter = createPublicRateLimiter({
    globalMax: 100,
    ipMax: 2,
    maxKeys: 10,
    tokenMax: 100,
    windowMs: 1_000,
  });

  assert.equal(limiter.consumeIngress({ clientIp: '192.0.2.1', nowMs: 10_000 }).allowed, true);
  assert.equal(limiter.consumeIngress({ clientIp: '192.0.2.1', nowMs: 10_001 }).allowed, true);
  const denied = limiter.consumeIngress({ clientIp: '192.0.2.1', nowMs: 10_002 });
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 998);

  assert.equal(limiter.consumeIngress({ clientIp: '192.0.2.2', nowMs: 10_002 }).allowed, true);
  assert.equal(limiter.consumeIngress({ clientIp: '192.0.2.1', nowMs: 11_000 }).allowed, true);
});

test('enforces a service-wide per-instance limit across different IPs', () => {
  const limiter = createPublicRateLimiter({
    globalMax: 2,
    ipMax: 100,
    maxKeys: 10,
    tokenMax: 100,
    windowMs: 5_000,
  });

  assert.equal(limiter.consumeIngress({ clientIp: '192.0.2.1', nowMs: 20_000 }).allowed, true);
  assert.equal(limiter.consumeIngress({ clientIp: '192.0.2.2', nowMs: 20_001 }).allowed, true);
  const denied = limiter.consumeIngress({ clientIp: '192.0.2.3', nowMs: 20_002 });
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 4_998);
});

test('enforces per-token limits on SHA-256 digests independently', () => {
  const limiter = createPublicRateLimiter({
    globalMax: 100,
    ipMax: 100,
    maxKeys: 10,
    tokenMax: 1,
    windowMs: 10_000,
  });

  assert.equal(limiter.consumeToken({ tokenHash: TOKEN_A, nowMs: 30_000 }).allowed, true);
  assert.equal(limiter.consumeToken({ tokenHash: TOKEN_A, nowMs: 30_001 }).allowed, false);
  assert.equal(limiter.consumeToken({ tokenHash: TOKEN_B, nowMs: 30_001 }).allowed, true);
  assert.throws(
    () => limiter.consumeToken({ tokenHash: 'raw-token', nowMs: 30_001 }),
    /SHA-256/,
  );
});

test('bounds keyed limiter memory and fails closed for new live keys at capacity', () => {
  const counter = new FixedWindowKeyedCounter({ limit: 5, maxKeys: 2, windowMs: 10_000 });
  const a = counter.inspect('a', 40_000);
  counter.commit('a', a);
  const b = counter.inspect('b', 40_000);
  counter.commit('b', b);

  const capacity = counter.inspect('c', 40_001);
  assert.equal(capacity.allowed, false);
  assert.equal(capacity.capacityLimited, true);

  const expired = counter.inspect('c', 50_000);
  assert.equal(expired.allowed, true);
  counter.commit('c', expired);
  assert.equal(counter.entries.size, 1);
});

test('validates limiter construction and timestamp inputs', () => {
  assert.throws(() => createPublicRateLimiter({ ipMax: 0 }), /positive safe integer/);
  const limiter = createPublicRateLimiter();
  assert.throws(
    () => limiter.consumeIngress({ clientIp: '127.0.0.1', nowMs: 0 }),
    /positive safe integer/,
  );
});
