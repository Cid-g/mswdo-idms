'use strict';

const { generateKeyPairSync, sign } = require('node:crypto');
const { buildRecordEnvelope } = require('../src/crypto/canonicalEnvelope');
const { verifyStoredRecordSignature } = require('../src/crypto/signatureVerifier');

const AUDIENCE = 'mswdo-verification-service';
const PATH = '/internal/sync';
const KEY_ID = 'office-key-2026-01';
const TOKEN_HASH = 'c'.repeat(64);
const TIMESTAMP = 1785940200123;
const ANCHORED_HASH = 'a'.repeat(64);
const TX_ID = 'b'.repeat(64);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

function validRecordPayload(overrides = {}) {
  return {
    anchoredAt: '2026-03-01T02:03:04.000Z',
    anchoredHash: ANCHORED_HASH,
    blockNumber: 42,
    expiryDate: '2031-03-01',
    idNumber: 'PWD-2026-00123',
    idType: 'PWD',
    issuedDate: '2026-03-01',
    maskedName: 'D****, L****',
    releasedAt: '2026-03-02T01:00:00.000Z',
    status: 'ACTIVE',
    txId: TX_ID,
    ...overrides,
  };
}

function signedRecord({
  epoch = 1,
  keyId = KEY_ID,
  payload = validRecordPayload(),
  revision = 1,
  timestamp = TIMESTAMP,
  tokenHash = TOKEN_HASH,
  signingKey = privateKey,
} = {}) {
  const signedPayload = buildRecordEnvelope({
    audience: AUDIENCE,
    epoch,
    keyId,
    path: PATH,
    payload,
    revision,
    timestamp,
    tokenHash,
  });
  const signatureBase64 = sign(null, Buffer.from(signedPayload, 'utf8'), signingKey).toString('base64');
  const verifiedRequest = verifyStoredRecordSignature({
    audience: AUDIENCE,
    path: PATH,
    publicKeys: { [keyId]: publicKey },
    signatureBase64,
    signedPayload,
  });

  return {
    signatureBase64,
    signedPayload,
    verifiedRequest,
  };
}

module.exports = {
  ANCHORED_HASH,
  AUDIENCE,
  KEY_ID,
  PATH,
  TIMESTAMP,
  TOKEN_HASH,
  TX_ID,
  privateKey,
  publicKey,
  signedRecord,
  validRecordPayload,
};
