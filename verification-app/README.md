# MSWDO Verification App

This directory contains the independently hosted public-verification service.

Phase 2A.1 established the signed record-sync protocol. Phase 2A.2 added the exact minimized
record schema, deterministic materialization from verified signed bytes, stored-record
integrity re-verification, and an atomic compare-and-swap persistence service. Phase 2A.3a
adds the fail-closed HTTP boundary for `POST /internal/sync`. It still does not connect to a
real MongoDB deployment, start a production listener, or change the existing local backend/frontend.

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


## Internal sync HTTP boundary

The endpoint accepts the canonical signed envelope itself as the exact UTF-8 request body.
The signature and envelope bindings travel in exactly one instance of each header:

- `Content-Type: application/json` (optional `charset=utf-8`);
- `X-Key-Id`;
- `X-Timestamp`;
- `X-Signature`.

Compressed bodies, duplicate security headers, query strings, non-canonical envelopes,
invalid UTF-8, and bodies over the signed-envelope limit are rejected before persistence.
Successful acknowledgements expose only outcome, epoch, revision, and payload digest. All
responses use `no-store` and restrictive security headers. Unexpected persistence failures
return a generic `503` without reflecting database errors, credentials, signed bytes, or
record contents.

The handler is dependency-injected with a Mongo-compatible collection. The next isolated
slice will add the official MongoDB driver, index-before-listen startup, and graceful shutdown.

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

## MongoDB-backed service lifecycle

Phase 2A.3b adds the executable cloud receiver while keeping the local MSWDO application
untouched. The service uses the official MongoDB Node.js driver. Startup is deliberately
fail-closed:

1. parse all protocol, listener, MongoDB, and public-key configuration;
2. reject private or non-Ed25519 material in `VERIFY_PUBLIC_KEYS`;
3. connect to MongoDB and successfully ping the selected database;
4. create/confirm the required `verified_records` indexes;
5. only then open the HTTP listener.

If connection, ping, or index creation fails, no sync listener is exposed. `SIGINT` and
`SIGTERM` stop accepting requests, drain/force-close HTTP connections within the configured
grace period, and close MongoDB exactly once. Operational logs contain error class/code only;
they do not print `MONGODB_URI`, public-key contents, signed envelopes, or database error
messages.

### Cloud environment

Copy `.env.example` only as a reference. This app reads deployment environment variables
directly; it does not load `.env` files automatically.

- `MONGODB_URI` — required cloud MongoDB connection string; treat as a secret.
- `VERIFY_MONGODB_DATABASE` — defaults to `mswdo_verification`.
- `VERIFY_PUBLIC_KEYS` — required JSON object mapping key IDs to Ed25519 **public** PEM keys.
- `HOST` / `PORT` — defaults to `0.0.0.0:3002`; hosting platforms normally provide `PORT`.
- `VERIFY_MONGO_SERVER_SELECTION_TIMEOUT_MS` — startup database selection timeout.
- `VERIFY_SHUTDOWN_GRACE_MS` — bounded HTTP shutdown grace period.
- Existing protocol variables continue to control audience, sync path, and replay window.

The office Ed25519 private key must never be copied into this cloud application. Start the
receiver after setting real environment values:

```sh
npm ci
npm start
```

`GET /healthz` and `HEAD /healthz` provide a minimal no-store liveness response. The listener
exists only after the startup database/index gate has completed; this endpoint is not the
signed office-source freshness heartbeat planned for the public verification decision logic.
