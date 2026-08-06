'use strict';

const path = require('node:path');
const {
  generateKeyPairSync,
  sign,
} = require('node:crypto');

const {
  buildHealthEnvelope,
  buildRecordEnvelope,
  buildSignedHealthRequest,
  buildSignedRecordRequest,
  digestPayload,
  requireEd25519PrivateKey,
} = require('../../src/lib/verificationSyncProtocol');
const {
  VerificationSyncTransportError,
  createVerificationSyncClient,
  loadVerificationSyncConfig,
  parseSyncOrigin,
} = require('../../src/services/verificationSyncClient');
const {
  verifyHealthSyncRequest,
  verifyRecordSyncRequest,
} = require('../../../verification-app/src/crypto/signatureVerifier');

const TIMESTAMP = 1_785_978_000_123;
const TOKEN_HASH = 'a'.repeat(64);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

function payload(overrides = {}) {
  return {
    anchoredAt: null,
    anchoredHash: null,
    blockNumber: null,
    expiryDate: '2031-08-05',
    idNumber: 'PWD-2026-0000200',
    idType: 'PWD',
    issuedDate: '2026-08-05',
    maskedName: 'S****, M****',
    releasedAt: null,
    status: 'ACTIVE',
    txId: null,
    ...overrides,
  };
}

function operation(overrides = {}) {
  const recordPayload = overrides.payload ?? payload();
  return {
    operationId: 'verify:issue:507f1f77bcf86cd799439011',
    idRecordId: '507f1f77bcf86cd799439011',
    tokenHash: TOKEN_HASH,
    payload: recordPayload,
    payloadDigest: digestPayload(recordPayload),
    epoch: 1,
    revision: 7,
    ...overrides,
  };
}

function config(overrides = {}) {
  return {
    audience: 'mswdo-verification-service',
    healthPath: '/internal/health',
    healthUrl: 'https://verify.example.test/internal/health',
    keyId: 'office-key-2026-01',
    origin: 'https://verify.example.test',
    privateKey,
    syncPath: '/internal/sync',
    syncUrl: 'https://verify.example.test/internal/sync',
    timeoutMs: 1_000,
    ...overrides,
  };
}

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

describe('verification sync protocol compatibility', () => {
  test('builds the exact Phase 2A canonical record envelope', () => {
    const recordPayload = payload();
    const digest = digestPayload(recordPayload);

    expect(digest).toBe('5e9f0a165212652b106839ac629d87f7fc5b0385c326d96f375ee46b5b0162d4');
    expect(buildRecordEnvelope({
      audience: 'mswdo-verification-service',
      epoch: 1,
      keyId: 'office-key-2026-01',
      path: '/internal/sync',
      payload: recordPayload,
      payloadDigest: digest,
      revision: 7,
      timestamp: TIMESTAMP,
      tokenHash: TOKEN_HASH,
    })).toBe(
      '{"audience":"mswdo-verification-service","domain":"MSWDO-IDMS/VERIFY-SYNC/V1",'
      + '"epoch":1,"keyId":"office-key-2026-01","method":"POST","path":"/internal/sync",'
      + '"payload":{"anchoredAt":null,"anchoredHash":null,"blockNumber":null,'
      + '"expiryDate":"2031-08-05","idNumber":"PWD-2026-0000200","idType":"PWD",'
      + '"issuedDate":"2026-08-05","maskedName":"S****, M****","releasedAt":null,'
      + '"status":"ACTIVE","txId":null},"payloadDigest":'
      + '"5e9f0a165212652b106839ac629d87f7fc5b0385c326d96f375ee46b5b0162d4",'
      + '"protocolVersion":1,"revision":7,"timestamp":1785978000123,'
      + '"tokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
    );
  });

  test('produces bytes and headers accepted by the Phase 2A verifier', () => {
    const request = buildSignedRecordRequest({
      audience: 'mswdo-verification-service',
      keyId: 'office-key-2026-01',
      operation: operation(),
      path: '/internal/sync',
      privateKey,
      timestamp: TIMESTAMP,
    });

    const verified = verifyRecordSyncRequest({
      audience: 'mswdo-verification-service',
      headerKeyId: request.headers['X-Key-Id'],
      headerTimestamp: request.headers['X-Timestamp'],
      maxClockSkewMs: 300_000,
      method: 'POST',
      now: TIMESTAMP,
      path: '/internal/sync',
      publicKeys: { 'office-key-2026-01': publicKey },
      signatureBase64: request.headers['X-Signature'],
      signedPayload: request.body,
    });

    expect(verified.envelope.epoch).toBe(1);
    expect(verified.envelope.revision).toBe(7);
    expect(verified.envelope.tokenHash).toBe(TOKEN_HASH);
    expect(request.headers['Content-Type']).toBe('application/json; charset=utf-8');
  });

  test('builds the exact Phase 2A canonical health envelope', () => {
    expect(buildHealthEnvelope({
      audience: 'mswdo-verification-service',
      epoch: 1,
      keyId: 'office-key-2026-01',
      path: '/internal/health',
      payload: { sourceLastHealthyAt: TIMESTAMP },
      timestamp: TIMESTAMP,
    })).toBe(
      '{"audience":"mswdo-verification-service","domain":"MSWDO-IDMS/VERIFY-HEALTH/V1",'
      + '"epoch":1,"keyId":"office-key-2026-01","method":"POST","path":"/internal/health",'
      + '"payload":{"sourceLastHealthyAt":1785978000123},"payloadDigest":'
      + '"69ccd2547c33cb272862902a685ddab27154624d457bb6852bd99ef91be5ac92",'
      + '"protocolVersion":1,"timestamp":1785978000123}'
    );
  });

  test('produces health bytes and headers accepted by the Phase 2A verifier', () => {
    const request = buildSignedHealthRequest({
      audience: 'mswdo-verification-service',
      epoch: 1,
      keyId: 'office-key-2026-01',
      path: '/internal/health',
      privateKey,
      timestamp: TIMESTAMP,
    });

    const verified = verifyHealthSyncRequest({
      audience: 'mswdo-verification-service',
      headerKeyId: request.headers['X-Key-Id'],
      headerTimestamp: request.headers['X-Timestamp'],
      maxClockSkewMs: 300_000,
      method: 'POST',
      now: TIMESTAMP,
      path: '/internal/health',
      publicKeys: { 'office-key-2026-01': publicKey },
      signatureBase64: request.headers['X-Signature'],
      signedPayload: request.body,
    });

    expect(verified.envelope).toMatchObject({
      epoch: 1,
      payload: { sourceLastHealthyAt: TIMESTAMP },
      timestamp: TIMESTAMP,
    });
  });

  test('signs only minimized outbox fields and never operation metadata or raw QR data', () => {
    const rawToken = '49feec7e-90f5-420a-be3e-secret';
    const request = buildSignedRecordRequest({
      audience: 'mswdo-verification-service',
      keyId: 'office-key-2026-01',
      operation: {
        ...operation(),
        qrToken: rawToken,
        rawToken,
        lastError: 'private local error',
      },
      path: '/internal/sync',
      privateKey,
      timestamp: TIMESTAMP,
    });

    expect(request.body).not.toContain(rawToken);
    expect(request.body).not.toContain('operationId');
    expect(request.body).not.toContain('idRecordId');
    expect(request.body).not.toContain('lastError');
  });

  test('rejects a payload digest mismatch before signing', () => {
    expect(() => buildSignedRecordRequest({
      audience: 'mswdo-verification-service',
      keyId: 'office-key-2026-01',
      operation: operation({ payloadDigest: 'f'.repeat(64) }),
      path: '/internal/sync',
      privateKey,
      timestamp: TIMESTAMP,
    })).toThrow(expect.objectContaining({ code: 'PAYLOAD_DIGEST_MISMATCH' }));
  });

  test('accepts only an Ed25519 private key for signing', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(requireEd25519PrivateKey(privatePem).asymmetricKeyType).toBe('ed25519');
    expect(() => requireEd25519PrivateKey(publicPem))
      .toThrow(expect.objectContaining({ code: 'INVALID_VERIFICATION_PRIVATE_KEY' }));
    expect(() => requireEd25519PrivateKey(rsa.privateKey))
      .toThrow(expect.objectContaining({ code: 'INVALID_VERIFICATION_PRIVATE_KEY' }));
  });

  test('the signature is over the exact canonical bytes', () => {
    const request = buildSignedRecordRequest({
      audience: 'mswdo-verification-service',
      keyId: 'office-key-2026-01',
      operation: operation(),
      path: '/internal/sync',
      privateKey,
      timestamp: TIMESTAMP,
    });
    const altered = `${request.body} `;

    expect(sign(null, Buffer.from(request.body), privateKey).toString('base64'))
      .toBe(request.signature);
    expect(sign(null, Buffer.from(altered), privateKey).toString('base64'))
      .not.toBe(request.signature);
  });
});

describe('verification sync configuration', () => {
  test('loads an HTTPS origin and private key outside the repository', () => {
    const privatePath = path.resolve('secrets/office-private.pem');
    const loaded = loadVerificationSyncConfig({
      VERIFICATION_SYNC_ORIGIN: 'https://verify.mswdo-gerona.gov.ph',
      VERIFICATION_SYNC_KEY_ID: 'office-key-2026-01',
      VERIFICATION_SYNC_PRIVATE_KEY_PATH: privatePath,
    }, {
      readFile: jest.fn(() => privatePem),
    });

    expect(loaded).toMatchObject({
      audience: 'mswdo-verification-service',
      keyId: 'office-key-2026-01',
      origin: 'https://verify.mswdo-gerona.gov.ph',
      syncPath: '/internal/sync',
      syncUrl: 'https://verify.mswdo-gerona.gov.ph/internal/sync',
      timeoutMs: 10_000,
    });
    expect(loaded.privateKey.asymmetricKeyType).toBe('ed25519');
    expect(Object.isFrozen(loaded)).toBe(true);
  });

  test('allows HTTP only for an explicit loopback development origin', () => {
    expect(parseSyncOrigin('http://127.0.0.1:3002')).toBe('http://127.0.0.1:3002');
    expect(parseSyncOrigin('http://localhost:3002')).toBe('http://localhost:3002');
    expect(() => parseSyncOrigin('http://verify.example.test'))
      .toThrow(/must use HTTPS/);
  });

  test('rejects credentials, query strings, paths, fragments, and unsafe key IDs', () => {
    for (const origin of [
      'https://user:pass@verify.example.test',
      'https://verify.example.test/internal/sync',
      'https://verify.example.test?debug=1',
      'https://verify.example.test#fragment',
    ]) {
      expect(() => parseSyncOrigin(origin)).toThrow();
    }

    expect(() => loadVerificationSyncConfig({
      VERIFICATION_SYNC_ORIGIN: 'https://verify.example.test',
      VERIFICATION_SYNC_KEY_ID: 'bad key id',
      VERIFICATION_SYNC_PRIVATE_KEY_PATH: path.resolve('private.pem'),
    }, { readFile: () => privatePem })).toThrow(/KEY_ID/);
  });

  test('requires distinct record and source-health paths', () => {
    expect(() => loadVerificationSyncConfig({
      VERIFICATION_SYNC_ORIGIN: 'https://verify.example.test',
      VERIFICATION_SYNC_KEY_ID: 'office-key-1',
      VERIFICATION_SYNC_PRIVATE_KEY_PATH: path.resolve('private.pem'),
      VERIFY_HEALTH_PATH: '/same',
      VERIFY_SYNC_PATH: '/same',
    }, { readFile: () => privatePem })).toThrow(/must differ/);
  });

  test('fails closed when the private key is missing, public, or non-Ed25519', () => {
    const base = {
      VERIFICATION_SYNC_ORIGIN: 'https://verify.example.test',
      VERIFICATION_SYNC_KEY_ID: 'office-key-1',
      VERIFICATION_SYNC_PRIVATE_KEY_PATH: path.resolve('private.pem'),
    };
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });

    expect(() => loadVerificationSyncConfig(base, {
      readFile: () => { throw new Error('ENOENT /secret/path'); },
    })).toThrow(expect.objectContaining({ code: 'VERIFICATION_PRIVATE_KEY_UNREADABLE' }));
    expect(() => loadVerificationSyncConfig(base, { readFile: () => publicPem }))
      .toThrow(expect.objectContaining({ code: 'INVALID_VERIFICATION_PRIVATE_KEY' }));
    expect(() => loadVerificationSyncConfig(base, {
      readFile: () => rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    })).toThrow(expect.objectContaining({ code: 'INVALID_VERIFICATION_PRIVATE_KEY' }));
  });
});

describe('verification sync HTTP client', () => {
  test.each([
    [201, 'INSERTED', true],
    [200, 'UPDATED', true],
    [200, 'IDEMPOTENT', false],
  ])('accepts a matching source-health %s acknowledgement', async (status, outcome, applied) => {
    const fetchImpl = jest.fn(async () => response(status, {
      applied,
      epoch: 1,
      outcome,
      sourceLastHealthyAt: new Date(TIMESTAMP).toISOString(),
    }));
    const client = createVerificationSyncClient({
      config: config(),
      fetchImpl,
      now: () => TIMESTAMP + 99,
    });

    await expect(client.sendHealth({ epoch: 1, sourceLastHealthyAt: TIMESTAMP }))
      .resolves.toEqual({
        applied,
        epoch: 1,
        outcome,
        sourceLastHealthyAt: new Date(TIMESTAMP).toISOString(),
      });

    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://verify.example.test/internal/health');
    expect(request.headers['X-Timestamp']).toBe(String(TIMESTAMP));
    expect(JSON.parse(request.body).payload).toEqual({ sourceLastHealthyAt: TIMESTAMP });
  });

  test('rejects a heartbeat timestamp outside the JavaScript Date range', async () => {
    const client = createVerificationSyncClient({
      config: config(),
      fetchImpl: jest.fn(),
    });

    await expect(client.sendHealth({
      epoch: 1,
      sourceLastHealthyAt: Number.MAX_SAFE_INTEGER,
    })).rejects.toThrow('valid positive Unix timestamp');
  });

  test('rejects a source-health acknowledgement that changes the signed instant', async () => {
    const client = createVerificationSyncClient({
      config: config(),
      fetchImpl: async () => response(200, {
        applied: true,
        epoch: 1,
        outcome: 'UPDATED',
        sourceLastHealthyAt: new Date(TIMESTAMP + 1).toISOString(),
      }),
    });

    await expect(client.sendHealth({ epoch: 1, sourceLastHealthyAt: TIMESTAMP }))
      .rejects.toMatchObject({ code: 'VERIFY_HEALTH_ACK_MISMATCH', retryable: true });
  });

  test.each([
    [201, 'INSERTED', true],
    [200, 'UPDATED', true],
    [200, 'IDEMPOTENT', false],
  ])('accepts a matching %s acknowledgement', async (status, outcome, applied) => {
    const command = operation();
    const fetchImpl = jest.fn(async () => response(status, {
      applied,
      epoch: command.epoch,
      outcome,
      payloadDigest: command.payloadDigest,
      revision: command.revision,
    }));
    const client = createVerificationSyncClient({
      config: config(),
      fetchImpl,
      now: () => TIMESTAMP,
    });

    await expect(client.sendRecord(command)).resolves.toEqual({
      applied,
      epoch: 1,
      outcome,
      payloadDigest: command.payloadDigest,
      revision: 7,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://verify.example.test/internal/sync');
    expect(request).toMatchObject({
      cache: 'no-store',
      method: 'POST',
      redirect: 'error',
    });
    expect(request.headers['X-Timestamp']).toBe(String(TIMESTAMP));
    expect(request.body).not.toContain(command.operationId);
  });

  test('rejects a success acknowledgement that does not match the signed operation', async () => {
    const command = operation();
    const client = createVerificationSyncClient({
      config: config(),
      fetchImpl: async () => response(200, {
        applied: false,
        epoch: command.epoch,
        outcome: 'IDEMPOTENT',
        payloadDigest: 'f'.repeat(64),
        revision: command.revision,
      }),
      now: () => TIMESTAMP,
    });

    await expect(client.sendRecord(command))
      .rejects.toMatchObject({ code: 'VERIFY_SYNC_ACK_MISMATCH', retryable: true });
  });

  test('surfaces a 409 code without trusting or leaking its remote message', async () => {
    const client = createVerificationSyncClient({
      config: config(),
      fetchImpl: async () => response(409, {
        error: {
          code: 'EQUAL_REVISION_DIGEST_CONFLICT',
          message: 'mongodb://secret-user:secret-password@cluster',
        },
      }),
      now: () => TIMESTAMP,
    });

    let error;
    try {
      await client.sendRecord(operation());
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(VerificationSyncTransportError);
    expect(error).toMatchObject({
      code: 'VERIFY_SYNC_REJECTED',
      remoteCode: 'EQUAL_REVISION_DIGEST_CONFLICT',
      retryable: false,
      status: 409,
    });
    expect(error.message).not.toContain('secret-password');
  });

  test('maps connection failure and timeout to stable retryable errors', async () => {
    const unavailable = createVerificationSyncClient({
      config: config(),
      fetchImpl: async () => { throw new Error('connect ECONNREFUSED private-host'); },
      now: () => TIMESTAMP,
    });
    await expect(unavailable.sendRecord(operation()))
      .rejects.toMatchObject({ code: 'VERIFY_SYNC_UNAVAILABLE', retryable: true });

    const timedOut = createVerificationSyncClient({
      config: config({ timeoutMs: 5 }),
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
      now: () => TIMESTAMP,
    });
    await expect(timedOut.sendRecord(operation()))
      .rejects.toMatchObject({ code: 'VERIFY_SYNC_TIMEOUT', retryable: true });
  });

  test('rejects oversized or non-JSON responses before trusting them', async () => {
    const oversized = createVerificationSyncClient({
      config: config(),
      fetchImpl: async () => new Response('x', {
        status: 503,
        headers: { 'Content-Length': String(16 * 1024 + 1) },
      }),
      now: () => TIMESTAMP,
    });
    await expect(oversized.sendRecord(operation()))
      .rejects.toMatchObject({ code: 'VERIFY_SYNC_RESPONSE_TOO_LARGE' });

    const invalid = createVerificationSyncClient({
      config: config(),
      fetchImpl: async () => new Response('not-json', { status: 503 }),
      now: () => TIMESTAMP,
    });
    await expect(invalid.sendRecord(operation()))
      .rejects.toMatchObject({ code: 'VERIFY_SYNC_INVALID_RESPONSE' });
  });
});
