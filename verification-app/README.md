# MSWDO Verification App

This directory contains the independently hosted public-verification service.

Phase 2A.1 established the signed record-sync protocol. Phase 2A.2 added the exact minimized
record schema, deterministic materialization from verified signed bytes, stored-record
integrity re-verification, and an atomic compare-and-swap persistence service. Phase 2A.3a
added the fail-closed HTTP boundary for `POST /internal/sync`, and Phase 2A.3b added the
MongoDB-backed executable lifecycle. Phase 2A.4a adds a separately domain-separated, signed
source-health heartbeat, and Phase 2A.4b adds the public `GET /check?token=...` decision
boundary, and Phase 2A.5 adds bounded in-process per-IP, per-token, and service-wide
rate limits. The existing local backend/frontend remain unchanged.

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

Every public read calls `assertStoredRecordIntegrity()`, which re-verifies the old
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

The handler is dependency-injected with a Mongo-compatible collection; MongoDB startup,
index-before-listen, and graceful shutdown are provided by the service lifecycle below.

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
- Existing protocol variables control audience, record-sync path, signed-health path, and replay window.
- `VERIFY_CHECK_PATH` — public verification endpoint, default `/check`.
- `VERIFY_MAX_SYNC_AGE_MS` — maximum age of a drained-queue heartbeat before ACTIVE becomes UNKNOWN; default 300000 ms.
- `VERIFY_RATE_LIMIT_WINDOW_MS` — fixed public-check window; default 60000 ms.
- `VERIFY_RATE_LIMIT_IP_MAX` — maximum `/check` requests per socket IP per window; default 30.
- `VERIFY_RATE_LIMIT_TOKEN_MAX` — maximum checks of one hashed token per window; default 10.
- `VERIFY_RATE_LIMIT_GLOBAL_MAX` — per-process public-check ceiling per window; default 600.
- `VERIFY_RATE_LIMIT_MAX_KEYS` — memory bound for live IP/token counters; default 10000.

The office Ed25519 private key must never be copied into this cloud application. Start the
receiver after setting real environment values:

```sh
npm ci
npm start
```

`GET /healthz` and `HEAD /healthz` provide a minimal no-store liveness response. The listener
exists only after the startup database/index gate has completed; this endpoint is separate from the
signed office-source freshness heartbeat used by the public verification decision logic.

## Signed source-health heartbeat

`POST /internal/health` accepts a separate canonical Ed25519-signed envelope with domain
`MSWDO-IDMS/VERIFY-HEALTH/V1`. Its only payload field is `sourceLastHealthyAt`, and that value
must exactly equal the signed request timestamp. The office will send this heartbeat only after
its verification outbox is drained; the cloud cannot infer that condition independently.

The service stores one singleton document in the `source_health` collection. It preserves the
exact signed bytes and signature, re-verifies stored state before every ordering decision, and
applies heartbeats atomically:

1. a higher signed epoch supersedes an older restore generation;
2. within an epoch, only a later signed heartbeat replaces state;
3. exact replay is idempotent;
4. stale epoch/timestamp and conflicting equal heartbeat state return `409`;
5. database-only mutation of materialized health fields fails closed.

## Public verification endpoint

`GET /check?token=<uuid>` hashes the normalized UUID locally and performs an indexed lookup;
the raw token is never stored or reflected in responses. Before returning credential details,
the service re-verifies the exact stored Ed25519 record evidence and, when present, the signed
source-health singleton. Database-only mutation therefore fails closed instead of producing a
valid-looking response.

Results are evaluated in this order:

1. signed `REVOKED`, signed `EXPIRED`, or read-time expiry returns `NOT_VALID`;
2. signed `ACTIVE` with a fresh same-epoch heartbeat returns `VALID`;
3. signed `ACTIVE` with missing, stale, or different-epoch health returns `UNKNOWN` with
   `valid: null`.

The response exposes only the minimized signed projection, scoped issuance receipt, sync and
health timestamps, and verification time. It never exposes raw tokens, canonical hashes, full
identity data, or revocation reasons. Public responses use `no-store, private`, no-referrer,
noindex/nofollow, and restrictive content headers.

## Public abuse controls

`GET /check` is protected before MongoDB lookup by three fixed-window layers:

1. a per-process service ceiling;
2. a per-socket-IP ceiling, including malformed check queries;
3. a per-token ceiling keyed only by the SHA-256 token hash.

Limited responses return a token-redacted `429` with `Retry-After`, no-store, and noindex
headers. Counter maps are memory-bounded and fail closed for new keys while all slots are live.
The service deliberately does not trust `X-Forwarded-For` or similar client-supplied headers;
it uses the TCP socket address. In production, the trusted hosting edge/WAF must additionally
enforce distributed client-IP and service-wide limits, because in-process counters are not
shared across replicas and a reverse proxy may be the socket peer seen by Node.js.
