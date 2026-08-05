# MSWDO Verification App

This directory contains the independently hosted public-verification service. Phase 2A.1
establishes only the signed record-sync protocol; it does not start an HTTP server, connect
to MongoDB, or change the existing local backend/frontend.

## Record-sync envelope (protocol v1)

The office signs the exact canonical UTF-8 JSON string returned by
`buildRecordEnvelope()`. The envelope contains:

- fixed domain `MSWDO-IDMS/VERIFY-SYNC/V1`;
- protocol version `1`;
- key ID, epoch, and per-token revision;
- request timestamp, `POST`, exact path, and audience;
- SHA-256 token hash;
- the minimized verification payload itself;
- SHA-256 digest of that canonical payload.

The cloud must persist the exact signed string and signature. Queryable record fields are
later derived from the payload inside those verified bytes; a separately supplied parsed
payload is never authoritative.

## Security invariants

- Only Ed25519 public keys belong in the cloud key ring.
- `X-Key-Id` and `X-Timestamp` must exactly match the signed envelope.
- Method, path, and audience are signed to prevent cross-endpoint replay.
- Requests outside the configured clock-skew window are rejected.
- Non-canonical JSON, duplicate-key JSON, unknown fields, digest mismatch, malformed base64,
  unknown keys, and non-Ed25519 keys are rejected.
- Raw QR tokens and production private keys are not part of this application state.

Run the protocol tests with:

```sh
npm test
```
