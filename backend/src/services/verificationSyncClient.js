'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const {
  buildSignedHealthRequest,
  buildSignedRecordRequest,
  requireEd25519PrivateKey,
} = require('../lib/verificationSyncProtocol');

const DEFAULT_PROTOCOL_AUDIENCE = 'mswdo-verification-service';
const DEFAULT_HEALTH_PATH = '/internal/health';
const DEFAULT_SYNC_PATH = '/internal/sync';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SUCCESS_OUTCOMES = Object.freeze(['IDEMPOTENT', 'INSERTED', 'UPDATED']);

class VerificationSyncConfigError extends Error {
  constructor(message, code = 'INVALID_VERIFICATION_SYNC_CONFIG', { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'VerificationSyncConfigError';
    this.code = code;
  }
}

class VerificationSyncTransportError extends Error {
  constructor(message, code, {
    cause,
    remoteCode = null,
    retryable = true,
    status = null,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'VerificationSyncTransportError';
    this.code = code;
    this.remoteCode = remoteCode;
    this.retryable = retryable;
    this.status = status;
  }
}

function assertTrimmed(value, name, { max = 2048, pattern } = {}) {
  if (
    typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > max
    || /[\u0000-\u001f\u007f]/.test(value)
    || (pattern && !pattern.test(value))
  ) {
    throw new VerificationSyncConfigError(`${name} is invalid.`);
  }
  return value;
}

function parsePositiveSafeInteger(value, fallback, name, max) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new VerificationSyncConfigError(
      `${name} must be a positive safe integer no greater than ${max}.`
    );
  }
  return parsed;
}

function parseAbsolutePath(value, fallback, name) {
  const parsed = value === undefined || value === '' ? fallback : value;
  if (
    typeof parsed !== 'string'
    || !parsed.startsWith('/')
    || parsed.startsWith('//')
    || parsed.includes('\\')
    || parsed.includes('?')
    || parsed.includes('#')
    || parsed !== parsed.trim()
  ) {
    throw new VerificationSyncConfigError(
      `${name} must be an absolute HTTP path without a query string or fragment.`
    );
  }
  return parsed;
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1';
}

function parseSyncOrigin(value) {
  assertTrimmed(value, 'VERIFICATION_SYNC_ORIGIN');

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new VerificationSyncConfigError(
      'VERIFICATION_SYNC_ORIGIN must be an absolute HTTP(S) origin.'
    );
  }

  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new VerificationSyncConfigError(
      'VERIFICATION_SYNC_ORIGIN must contain only an HTTP(S) scheme, host, and optional port.'
    );
  }

  if (url.protocol !== 'https:' && !isLoopbackHostname(url.hostname)) {
    throw new VerificationSyncConfigError(
      'VERIFICATION_SYNC_ORIGIN must use HTTPS except for an explicit loopback host.'
    );
  }

  return url.origin;
}

function readPrivateKey(privateKeyPath, readFile) {
  assertTrimmed(privateKeyPath, 'VERIFICATION_SYNC_PRIVATE_KEY_PATH', { max: 4096 });
  if (!path.isAbsolute(privateKeyPath)) {
    throw new VerificationSyncConfigError(
      'VERIFICATION_SYNC_PRIVATE_KEY_PATH must be an absolute path.'
    );
  }

  let pem;
  try {
    pem = readFile(privateKeyPath, 'utf8');
  } catch (error) {
    throw new VerificationSyncConfigError(
      'Verification private key could not be read.',
      'VERIFICATION_PRIVATE_KEY_UNREADABLE',
      { cause: error }
    );
  }

  try {
    return requireEd25519PrivateKey(pem);
  } catch (error) {
    throw new VerificationSyncConfigError(
      'Verification private key must be a valid Ed25519 PKCS#8 key.',
      error.code || 'INVALID_VERIFICATION_PRIVATE_KEY'
    );
  }
}

function loadVerificationSyncConfig(env = process.env, {
  readFile = fs.readFileSync,
} = {}) {
  if (typeof readFile !== 'function') {
    throw new TypeError('readFile must be a function.');
  }

  const origin = parseSyncOrigin(env.VERIFICATION_SYNC_ORIGIN);
  const audience = assertTrimmed(
    env.VERIFY_PROTOCOL_AUDIENCE || DEFAULT_PROTOCOL_AUDIENCE,
    'VERIFY_PROTOCOL_AUDIENCE',
    { max: 256 }
  );
  const syncPath = parseAbsolutePath(
    env.VERIFY_SYNC_PATH,
    DEFAULT_SYNC_PATH,
    'VERIFY_SYNC_PATH'
  );
  const healthPath = parseAbsolutePath(
    env.VERIFY_HEALTH_PATH,
    DEFAULT_HEALTH_PATH,
    'VERIFY_HEALTH_PATH'
  );
  if (healthPath === syncPath) {
    throw new VerificationSyncConfigError(
      'VERIFY_HEALTH_PATH must differ from VERIFY_SYNC_PATH.'
    );
  }
  const keyId = assertTrimmed(
    env.VERIFICATION_SYNC_KEY_ID,
    'VERIFICATION_SYNC_KEY_ID',
    { max: 64, pattern: KEY_ID_PATTERN }
  );
  const timeoutMs = parsePositiveSafeInteger(
    env.VERIFICATION_SYNC_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    'VERIFICATION_SYNC_TIMEOUT_MS',
    120_000
  );
  const privateKey = readPrivateKey(
    env.VERIFICATION_SYNC_PRIVATE_KEY_PATH,
    readFile
  );
  const syncUrl = new URL(syncPath, `${origin}/`).toString();
  const healthUrl = new URL(healthPath, `${origin}/`).toString();

  return Object.freeze({
    audience,
    healthPath,
    healthUrl,
    keyId,
    origin,
    privateKey,
    syncPath,
    syncUrl,
    timeoutMs,
  });
}

async function readBoundedResponse(response, maxBytes = MAX_RESPONSE_BYTES) {
  // Reject a declared oversized response before interpreting its media type.
  // The bound applies to every remote response, including malformed errors.
  const declared = response.headers?.get?.('content-length');
  if (declared !== null && declared !== undefined) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declared)) {
      throw new VerificationSyncTransportError(
        'Verification service returned an invalid Content-Length.',
        'VERIFY_SYNC_INVALID_RESPONSE',
        { retryable: true, status: response.status }
      );
    }
    const parsed = Number(declared);
    if (!Number.isSafeInteger(parsed) || parsed > maxBytes) {
      throw new VerificationSyncTransportError(
        'Verification service response exceeded the accepted size.',
        'VERIFY_SYNC_RESPONSE_TOO_LARGE',
        { retryable: true, status: response.status }
      );
    }
  }

  const contentType = response.headers?.get?.('content-type');
  if (
    typeof contentType !== 'string'
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)
  ) {
    throw new VerificationSyncTransportError(
      'Verification service returned an unsupported media type.',
      'VERIFY_SYNC_INVALID_RESPONSE',
      { retryable: true, status: response.status }
    );
  }

  let bytes;
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > maxBytes) {
          await reader.cancel();
          throw new VerificationSyncTransportError(
            'Verification service response exceeded the accepted size.',
            'VERIFY_SYNC_RESPONSE_TOO_LARGE',
            { retryable: true, status: response.status }
          );
        }
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks, total);
    } finally {
      reader.releaseLock();
    }
  } else if (typeof response.arrayBuffer === 'function') {
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new VerificationSyncTransportError(
        'Verification service response exceeded the accepted size.',
        'VERIFY_SYNC_RESPONSE_TOO_LARGE',
        { retryable: true, status: response.status }
      );
    }
  } else {
    throw new VerificationSyncTransportError(
      'Verification service returned an unreadable response.',
      'VERIFY_SYNC_INVALID_RESPONSE',
      { retryable: true, status: response.status }
    );
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new VerificationSyncTransportError(
      'Verification service response was not valid UTF-8.',
      'VERIFY_SYNC_INVALID_RESPONSE',
      { retryable: true, status: response.status }
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new VerificationSyncTransportError(
      'Verification service returned invalid JSON.',
      'VERIFY_SYNC_INVALID_RESPONSE',
      { retryable: true, status: response.status }
    );
  }
}

function remoteErrorCode(body) {
  const code = body?.error?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)
    ? code
    : null;
}

function assertSuccessAcknowledgement(body, operation, status) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new VerificationSyncTransportError(
      'Verification service acknowledgement is malformed.',
      'VERIFY_SYNC_ACK_MISMATCH',
      { retryable: true, status }
    );
  }

  const expectedFields = ['applied', 'epoch', 'outcome', 'payloadDigest', 'revision'];
  const fields = Object.keys(body).sort();
  if (
    fields.length !== expectedFields.length
    || fields.some((field, index) => field !== expectedFields[index])
    || typeof body.applied !== 'boolean'
    || !SUCCESS_OUTCOMES.includes(body.outcome)
    || body.epoch !== operation.epoch
    || body.revision !== operation.revision
    || body.payloadDigest !== operation.payloadDigest
  ) {
    throw new VerificationSyncTransportError(
      'Verification service acknowledgement does not match the signed operation.',
      'VERIFY_SYNC_ACK_MISMATCH',
      { retryable: true, status }
    );
  }

  const expectedApplied = body.outcome !== 'IDEMPOTENT';
  const expectedStatus = body.outcome === 'INSERTED' ? 201 : 200;
  if (body.applied !== expectedApplied || status !== expectedStatus) {
    throw new VerificationSyncTransportError(
      'Verification service acknowledgement outcome is inconsistent.',
      'VERIFY_SYNC_ACK_MISMATCH',
      { retryable: true, status }
    );
  }

  return Object.freeze({ ...body });
}

function assertHealthAcknowledgement(body, heartbeat, status) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new VerificationSyncTransportError(
      'Verification health acknowledgement is malformed.',
      'VERIFY_HEALTH_ACK_MISMATCH',
      { retryable: true, status }
    );
  }

  const expectedFields = ['applied', 'epoch', 'outcome', 'sourceLastHealthyAt'];
  const fields = Object.keys(body).sort();
  const expectedInstant = new Date(heartbeat.sourceLastHealthyAt).toISOString();
  if (
    fields.length !== expectedFields.length
    || fields.some((field, index) => field !== expectedFields[index])
    || typeof body.applied !== 'boolean'
    || !SUCCESS_OUTCOMES.includes(body.outcome)
    || body.epoch !== heartbeat.epoch
    || body.sourceLastHealthyAt !== expectedInstant
  ) {
    throw new VerificationSyncTransportError(
      'Verification health acknowledgement does not match the signed heartbeat.',
      'VERIFY_HEALTH_ACK_MISMATCH',
      { retryable: true, status }
    );
  }

  const expectedApplied = body.outcome !== 'IDEMPOTENT';
  const expectedStatus = body.outcome === 'INSERTED' ? 201 : 200;
  if (body.applied !== expectedApplied || status !== expectedStatus) {
    throw new VerificationSyncTransportError(
      'Verification health acknowledgement outcome is inconsistent.',
      'VERIFY_HEALTH_ACK_MISMATCH',
      { retryable: true, status }
    );
  }

  return Object.freeze({ ...body });
}

function plainHeartbeat(heartbeat) {
  if (!heartbeat || typeof heartbeat !== 'object') {
    throw new TypeError('Verification heartbeat is required.');
  }
  if (!Number.isSafeInteger(heartbeat.epoch) || heartbeat.epoch < 1) {
    throw new TypeError('Verification heartbeat epoch must be a positive safe integer.');
  }
  if (
    !Number.isSafeInteger(heartbeat.sourceLastHealthyAt)
    || heartbeat.sourceLastHealthyAt < 1
    || Number.isNaN(new Date(heartbeat.sourceLastHealthyAt).getTime())
  ) {
    throw new TypeError(
      'Verification heartbeat sourceLastHealthyAt must be a valid positive Unix timestamp.'
    );
  }
  return {
    epoch: heartbeat.epoch,
    sourceLastHealthyAt: heartbeat.sourceLastHealthyAt,
  };
}

function plainOperation(operation) {
  if (!operation || typeof operation !== 'object') {
    throw new TypeError('Verification sync operation is required.');
  }
  return {
    epoch: operation.epoch,
    payload: operation.payload,
    payloadDigest: operation.payloadDigest,
    revision: operation.revision,
    tokenHash: operation.tokenHash,
  };
}

function validateClientConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('Verification sync config is required.');
  }

  const origin = parseSyncOrigin(config.origin);
  const syncPath = parseAbsolutePath(config.syncPath, DEFAULT_SYNC_PATH, 'syncPath');
  const healthPath = parseAbsolutePath(config.healthPath, DEFAULT_HEALTH_PATH, 'healthPath');
  if (healthPath === syncPath) {
    throw new VerificationSyncConfigError('healthPath must differ from syncPath.');
  }
  const keyId = assertTrimmed(config.keyId, 'keyId', {
    max: 64,
    pattern: KEY_ID_PATTERN,
  });
  assertTrimmed(config.audience, 'audience', { max: 256 });
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 120_000) {
    throw new VerificationSyncConfigError('timeoutMs is invalid.');
  }
  requireEd25519PrivateKey(config.privateKey);

  const expectedSyncUrl = new URL(syncPath, `${origin}/`).toString();
  if (config.syncUrl !== expectedSyncUrl) {
    throw new VerificationSyncConfigError(
      'syncUrl must exactly match origin plus syncPath.'
    );
  }
  const expectedHealthUrl = new URL(healthPath, `${origin}/`).toString();
  if (config.healthUrl !== expectedHealthUrl) {
    throw new VerificationSyncConfigError(
      'healthUrl must exactly match origin plus healthPath.'
    );
  }

  return { keyId };
}

function createVerificationSyncClient({
  config,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  validateClientConfig(config);
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required.');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  if (typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function') {
    throw new TypeError('Timer functions are required.');
  }

  async function sendHealth(heartbeat) {
    const command = plainHeartbeat(heartbeat);
    const request = buildSignedHealthRequest({
      audience: config.audience,
      epoch: command.epoch,
      keyId: config.keyId,
      path: config.healthPath,
      privateKey: config.privateKey,
      timestamp: command.sourceLastHealthyAt,
    });

    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => controller.abort(), config.timeoutMs);
    if (typeof timeout?.unref === 'function') timeout.unref();

    let response;
    try {
      response = await fetchImpl(config.healthUrl, {
        body: request.body,
        cache: 'no-store',
        headers: request.headers,
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new VerificationSyncTransportError(
          'Verification health request timed out.',
          'VERIFY_HEALTH_TIMEOUT',
          { cause: error, retryable: true }
        );
      }
      throw new VerificationSyncTransportError(
        'Verification health service is unavailable.',
        'VERIFY_HEALTH_UNAVAILABLE',
        { cause: error, retryable: true }
      );
    } finally {
      clearTimeoutImpl(timeout);
    }

    const body = await readBoundedResponse(response);
    if (response.status !== 200 && response.status !== 201) {
      const status = Number.isSafeInteger(response.status) ? response.status : null;
      const code = remoteErrorCode(body);
      throw new VerificationSyncTransportError(
        `Verification health request was rejected${status ? ` with HTTP ${status}` : ''}.`,
        'VERIFY_HEALTH_REJECTED',
        {
          remoteCode: code,
          retryable: status === null || status === 408 || status === 425
            || status === 429 || status >= 500,
          status,
        }
      );
    }

    return assertHealthAcknowledgement(body, command, response.status);
  }

  async function sendRecord(operation) {
    const command = plainOperation(operation);
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 1) {
      throw new TypeError('now() must return a positive safe integer timestamp.');
    }

    const request = buildSignedRecordRequest({
      audience: config.audience,
      keyId: config.keyId,
      operation: command,
      path: config.syncPath,
      privateKey: config.privateKey,
      timestamp,
    });

    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => controller.abort(), config.timeoutMs);
    if (typeof timeout?.unref === 'function') timeout.unref();

    let response;
    try {
      response = await fetchImpl(config.syncUrl, {
        body: request.body,
        cache: 'no-store',
        headers: request.headers,
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new VerificationSyncTransportError(
          'Verification sync request timed out.',
          'VERIFY_SYNC_TIMEOUT',
          { cause: error, retryable: true }
        );
      }
      throw new VerificationSyncTransportError(
        'Verification service is unavailable.',
        'VERIFY_SYNC_UNAVAILABLE',
        { cause: error, retryable: true }
      );
    } finally {
      clearTimeoutImpl(timeout);
    }

    const body = await readBoundedResponse(response);
    if (response.status !== 200 && response.status !== 201) {
      const status = Number.isSafeInteger(response.status) ? response.status : null;
      const code = remoteErrorCode(body);
      throw new VerificationSyncTransportError(
        `Verification sync request was rejected${status ? ` with HTTP ${status}` : ''}.`,
        'VERIFY_SYNC_REJECTED',
        {
          remoteCode: code,
          retryable: status === null || status === 408 || status === 425
            || status === 429 || status >= 500,
          status,
        }
      );
    }

    return assertSuccessAcknowledgement(body, command, response.status);
  }

  return Object.freeze({ sendHealth, sendRecord });
}

module.exports = {
  DEFAULT_HEALTH_PATH,
  DEFAULT_PROTOCOL_AUDIENCE,
  DEFAULT_SYNC_PATH,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  VerificationSyncConfigError,
  VerificationSyncTransportError,
  assertHealthAcknowledgement,
  assertSuccessAcknowledgement,
  createVerificationSyncClient,
  loadVerificationSyncConfig,
  parseSyncOrigin,
  readBoundedResponse,
};
