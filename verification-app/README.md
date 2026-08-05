# MSWDO Verification App

This directory contains the independently hosted public-verification service.

Phase 2A.1 established the signed record-sync protocol. Phase 2A.2 adds the exact minimized
record schema, deterministic materialization from verified signed bytes, stored-record
integrity re-verification, and an atomic compare-and-swap persistence service. It still does
not start an HTTP server, connect to MongoDB, or change the existing local backend/frontend.

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

The cloud persists the exact signed string and signature. Queryable record fields are derived
from the payload inside those verified bytes; a separately supplied parsed payload is never
authoritative.

## Minimized record payload

The exact payload fields are:

- status and ID type;
- ID number and locally masked name;
- issue, expiry, and release dates;
- optional complete issuance-anchor receipt: canonical hash, transaction ID, block number,
  and anchor timestamp.

Unexpected fields are rejected. Full names, birthdates, addresses, contact details, photos,
signatures, disability details, free-text revocation reasons, and raw QR tokens therefore
cannot enter this protocol payload accidentally.

Dates are persisted as canonical signed strings (`YYYY-MM-DD` or UTC ISO timestamps), avoiding
implicit timezone conversion while remaining directly derivable from the signed envelope.

## Persistence and ordering

`applyVerifiedRecord()` accepts a Mongo-compatible collection and uses a single-record
compare-and-swap boundary:

1. higher epoch supersedes an older epoch;
2. within one epoch, only a higher revision replaces state;
3. equal epoch/revision is idempotent only for the same payload digest;
4. a revoked token is terminal and cannot become active or expired again;
5. duplicate-key insert races and concurrent update races are retried without blind overwrite.

Every public read will later call `assertStoredRecordIntegrity()`, which re-verifies the old
Ed25519 signature without applying the short incoming-request replay window, re-parses the
canonical envelope, and compares all materialized fields with signed truth.

## Security invariants

- Only Ed25519 public keys belong in the cloud key ring.
- `X-Key-Id` and `X-Timestamp` must exactly match the signed envelope.
- Method, path, and audience are signed to prevent cross-endpoint replay.
- Incoming requests outside the configured clock-skew window are rejected.
- Historical stored signatures remain verifiable after that request window expires.
- Non-canonical JSON, duplicate-key JSON, unknown fields, digest mismatch, malformed base64,
  unknown keys, non-Ed25519 keys, stale ordering, and equal-revision conflicts are rejected.
- Raw QR tokens and production private keys are not part of this application state.

Run all protocol and persistence tests with:

```sh
npm test
```
