'use strict';

const { isIP } = require('node:net');

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_IP_MAX = 30;
const DEFAULT_RATE_LIMIT_TOKEN_MAX = 10;
const DEFAULT_RATE_LIMIT_GLOBAL_MAX = 600;
const DEFAULT_RATE_LIMIT_MAX_KEYS = 10_000;

function assertPositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function normalizeClientIp(value) {
  if (typeof value !== 'string' || value.length === 0) return 'unknown';

  let candidate = value.trim();
  if (candidate.startsWith('::ffff:') && isIP(candidate.slice(7)) === 4) {
    candidate = candidate.slice(7);
  }

  const zoneIndex = candidate.indexOf('%');
  if (zoneIndex > 0 && candidate.includes(':')) candidate = candidate.slice(0, zoneIndex);

  return isIP(candidate) ? candidate.toLowerCase() : 'unknown';
}

function getRequestClientIp(req) {
  return normalizeClientIp(req?.socket?.remoteAddress);
}

class FixedWindowKeyedCounter {
  constructor({ limit, maxKeys, windowMs }) {
    this.limit = assertPositiveSafeInteger(limit, 'limit');
    this.maxKeys = assertPositiveSafeInteger(maxKeys, 'maxKeys');
    this.windowMs = assertPositiveSafeInteger(windowMs, 'windowMs');
    this.entries = new Map();
  }

  pruneExpired(nowMs) {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= nowMs) this.entries.delete(key);
    }
  }

  inspect(key, nowMs) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('rate-limit key must be a non-empty string.');
    }
    assertPositiveSafeInteger(nowMs, 'nowMs');

    const current = this.entries.get(key);
    if (current && current.resetAt > nowMs) {
      return Object.freeze({
        allowed: current.count < this.limit,
        count: current.count,
        resetAt: current.resetAt,
      });
    }

    if (current) this.entries.delete(key);
    if (!this.entries.has(key) && this.entries.size >= this.maxKeys) {
      this.pruneExpired(nowMs);
    }

    if (!this.entries.has(key) && this.entries.size >= this.maxKeys) {
      let earliestResetAt = nowMs + this.windowMs;
      for (const entry of this.entries.values()) {
        if (entry.resetAt < earliestResetAt) earliestResetAt = entry.resetAt;
      }
      return Object.freeze({
        allowed: false,
        capacityLimited: true,
        count: this.limit,
        resetAt: earliestResetAt,
      });
    }

    return Object.freeze({
      allowed: true,
      count: 0,
      resetAt: nowMs + this.windowMs,
    });
  }

  commit(key, inspection) {
    if (!inspection?.allowed) {
      throw new TypeError('Only an allowed rate-limit inspection can be committed.');
    }

    const current = this.entries.get(key);
    if (current && current.resetAt === inspection.resetAt) {
      current.count += 1;
      return;
    }

    this.entries.set(key, {
      count: 1,
      resetAt: inspection.resetAt,
    });
  }
}

function deniedResult(inspections, nowMs) {
  const denied = inspections.filter((inspection) => !inspection.allowed);
  if (denied.length === 0) return null;

  const retryAt = Math.max(...denied.map((inspection) => inspection.resetAt));
  return Object.freeze({
    allowed: false,
    retryAfterMs: Math.max(1, retryAt - nowMs),
  });
}

function allowedResult(inspections, nowMs) {
  const resetAt = Math.min(...inspections.map((inspection) => inspection.resetAt));
  return Object.freeze({
    allowed: true,
    retryAfterMs: Math.max(1, resetAt - nowMs),
  });
}

function createPublicRateLimiter({
  globalMax = DEFAULT_RATE_LIMIT_GLOBAL_MAX,
  ipMax = DEFAULT_RATE_LIMIT_IP_MAX,
  maxKeys = DEFAULT_RATE_LIMIT_MAX_KEYS,
  tokenMax = DEFAULT_RATE_LIMIT_TOKEN_MAX,
  windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
} = {}) {
  for (const [name, value] of Object.entries({ globalMax, ipMax, maxKeys, tokenMax, windowMs })) {
    assertPositiveSafeInteger(value, name);
  }

  const globalCounter = new FixedWindowKeyedCounter({ limit: globalMax, maxKeys: 1, windowMs });
  const ipCounter = new FixedWindowKeyedCounter({ limit: ipMax, maxKeys, windowMs });
  const tokenCounter = new FixedWindowKeyedCounter({ limit: tokenMax, maxKeys, windowMs });

  return Object.freeze({
    consumeIngress({ clientIp, nowMs }) {
      const normalizedIp = normalizeClientIp(clientIp);
      const globalInspection = globalCounter.inspect('public-check', nowMs);
      const ipInspection = ipCounter.inspect(normalizedIp, nowMs);
      const inspections = [globalInspection, ipInspection];
      const denied = deniedResult(inspections, nowMs);
      if (denied) return denied;

      globalCounter.commit('public-check', globalInspection);
      ipCounter.commit(normalizedIp, ipInspection);
      return allowedResult(inspections, nowMs);
    },

    consumeToken({ nowMs, tokenHash }) {
      if (typeof tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(tokenHash)) {
        throw new TypeError('tokenHash must be a lowercase SHA-256 hex digest.');
      }

      const inspection = tokenCounter.inspect(tokenHash, nowMs);
      const denied = deniedResult([inspection], nowMs);
      if (denied) return denied;

      tokenCounter.commit(tokenHash, inspection);
      return allowedResult([inspection], nowMs);
    },
  });
}

module.exports = {
  DEFAULT_RATE_LIMIT_GLOBAL_MAX,
  DEFAULT_RATE_LIMIT_IP_MAX,
  DEFAULT_RATE_LIMIT_MAX_KEYS,
  DEFAULT_RATE_LIMIT_TOKEN_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  FixedWindowKeyedCounter,
  createPublicRateLimiter,
  getRequestClientIp,
  normalizeClientIp,
};
