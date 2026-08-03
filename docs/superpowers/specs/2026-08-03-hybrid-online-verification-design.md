# Phase 2: Hybrid Deployment — Local System + Online QR Verification

**Date:** 2026-08-03 (supersedes the 2026-08-02 draft)
**Status:** Approved design — revised after adversarial review; implementation not started
**Depends on:** [Phase 1 — Durable Blockchain Operations](2026-08-03-blockchain-durability-design.md)

---

## 1. Requirement

The MSWDO IDMS runs **locally**. Applicant records — names, addresses, birthdates, photos,
signatures — never leave the office. But every issued ID carries a QR code, and the people
scanning it are outside: pharmacies, groceries, transport operators.

Stated by the user (2026-08-03):

> *"yung mga data halimbawa applicant at iba pa ay nasisave sa local lang tapos may paraan na
> nasysync sa cloud para maverify ng external"*

So the constraint is not "nothing may exist online." It is **"no full applicant record or
exact source record may exist online."** A minimal verification replica is explicitly
wanted.

The replica is not anonymous and must not be described as "PII-free" or "zero PII." It is a
**data-minimized, pseudonymous verification record that still processes personal and
sensitive personal information**. Section 4 identifies those fields and why they remain
regulated even after masking or hashing.

### 1.1 Decisions that fix the architecture

| Decision | Date | Consequence |
|---|---|---|
| Verifiers are **establishments** (pharmacy, grocery, transport) | 2026-08-03 | No app install. Phone camera + plain URL only. Rules out signed-QR schemes needing a verifier app, and rules out LAN-only. |
| Revocation must be **immediately visible** externally | 2026-08-03 | Rules out purely offline self-verifying QR. Under a network partition, stale `ACTIVE` must fail safe as `UNKNOWN` rather than remain `VALID`; exact immediacy cannot be guaranteed while the office is offline. |
| **24/7** availability | 2026-08-02 | Rules out a tunnel to the office PC. Requires an independently hosted replica; it does not guarantee a positive result when source freshness is unknown. |
| **No inbound** connection to the office | 2026-08-03 | Rules out the live-check tunnel. Push-only, outbound. |
| Full applicant records stay local | 2026-08-03 | Replica carries only the fields required for verification, but those fields remain pseudonymous personal/sensitive personal information. |

These constraints select an outbound-synchronized cloud replica. They do not eliminate the
consistency/availability trade-off during an office or network outage: the service stays
reachable, but it must return `UNKNOWN` once an `ACTIVE` record exceeds the approved
freshness threshold.

---

## 2. Architecture

```
┌── MSWDO OFFICE (local, private) ────────┐        ┌── FLY.IO (public, 24/7) ─────────┐
│                                          │        │                                  │
│  MongoDB — full applicant records        │        │  verify-service (Node/Express)   │
│    names, addresses, birthdates,         │        │    └─ MongoDB Atlas              │
│    sex, disability, photos, signatures   │        │       minimized, pseudonymous    │
│    ── NEVER LEAVES ──                    │        │                                  │
│                                          │        │                                  │
│  Fabric peer (WSL2)                      │        │  GET /check?token=…   (public)   │
│  ChainOutbox    ─┐                       │        │  POST /internal/sync  (signed)   │
│  VerifyOutbox   ─┴── signed push ───────▶│───────▶│                                  │
│                                          │        │                                  │
│         ◀── NO INBOUND CONNECTION ───────┼────────┤                                  │
└──────────────────────────────────────────┘        └──────────────────────────────────┘
                                                                    ▲
                                                       QR scan ─────┘
                                              https://verify.<domain>/check?token=…
```

The office needs no public IP, no port forwarding, no firewall exception. It can sit behind
NAT. Every connection is outbound.

---

## 3. Fabric Trust and Proof Scope

[`checkIntegrity()`](../../../backend/src/services/blockchain.js#L97-L108) can compare the
current local record with an issuance hash read from Fabric. The cloud service cannot perform
that comparison: the canonical applicant snapshot stays local and the office accepts no
inbound connection.

The replicated `canonicalHash`, `txId`, and `blockNumber` are therefore **issuance receipt
metadata**, not a self-verifying public proof. The current canonical hash does not bind the QR
token or lifecycle status. A receipt can show that an issuance hash was submitted, but it does
not prove that the scanned token maps to that issuance or that the ID is currently active.

### 3.1 Prototype trust boundary

The Fabric test network has two logical organizations, but both organizations, peers, keys,
orderer, storage, and scripts run on one laptop under one operator. That is one administrative
and failure trust domain. The prototype demonstrates the anchoring mechanism and
tamper-evidence within that domain; it does not provide independent consensus against the
party operating the laptop.

Production claims require persistent peers operated by genuinely independent entities — for
example MSWDO, municipal IT, and a third authorized agency — with explicit endorsement
policies, coordinated backup governance, and a read/proof mechanism authorized for the public
verification use case.

### 3.2 Cloud compromise boundary

Ed25519 authenticates a request received by an uncompromised sync endpoint. It does not make
the cloud response trustworthy after the database or runtime is compromised.

- A database writer could insert or roll back a mutable `ACTIVE` row unless the exact signed
  envelope is stored and verified again on read.
- Persisting and rechecking that envelope protects against database-only tampering. It does
  not protect against a compromised runtime that returns arbitrary JSON or serves modified
  verifier code.
- Runtime-compromise resistance requires a separately trusted verifier or independently
  witnessed state. Otherwise the cloud runtime must be declared a trust root.

The design therefore stores the signed envelope and signature (§4 and §6), re-verifies them
on every read, and makes only the database-tampering claim. It does not claim that full cloud
runtime compromise cannot mint a displayed `VALID` result.

### 3.3 Public presentation

The UI uses wording that matches the evidence:

```
Issuance anchor recorded
Block #42 · tx a1b2c3…
Recorded 01 March 2026

This receipt records issuance; current validity comes from the signed office status replica.
```

Do not label this badge “blockchain verified” or imply that it independently proves current
status. A future design may bind token + state version into a verifiable object; changing the
canonical hash is outside this phase.

---

## 4. Cloud Data Model — Minimized, Not Anonymous

```js
// verification-app/models/VerifiedRecord.js
{
  tokenHash:     { type: String, unique: true, index: true },  // SHA-256(qrToken) — see §4.2
  status:        String,   // ACTIVE | REVOKED | EXPIRED
  idType:        String,   // PWD | SOLO_PARENT | SENIOR_CITIZEN
  idNumber:      String,   // government-issued information; necessity documented in the PIA
  maskedName:    String,   // masked LOCALLY before transmission — "D****, L****"
  issuedDate:    Date,
  expiryDate:    Date,     // null for Senior Citizen
  releasedAt:    Date,

  anchoredHash:  String,   // BlockchainAnchor.canonicalHash
  txId:          String,
  blockNumber:   Number,
  anchoredAt:    Date,

  epoch:         Number,   // changes after an authoritative restore/resynchronization
  revision:      Number,   // monotonic within the epoch
  syncedAt:      Date,

  signedPayload: String,   // exact canonical bytes applied to this row
  payloadDigest: String,
  signature:     String,
  keyId:         String,
}
```

The cloud derives every queryable field from `signedPayload` after signature verification;
it never accepts the parsed fields and signed bytes as independent sources. On every public
read it re-verifies the signature, parses the canonical payload, recomputes `payloadDigest`,
and rejects/quarantines a row whose materialized fields do not match.

**Never replicated:** full name, birthdate, address, sex, civil status, contact number,
religion, disability subtype, emergency contacts, children, photo, handwritten signature, or
free-text revocation reason.

Masking happens **locally** using the existing
[`maskName()`](../../../backend/src/controllers/verifyController.js#L10-L13). The unmasked name
is never serialized for transmission.

### 4.1 Privacy classification

Minimization is real, but the remaining fields are still regulated and linkable:

- `idType` can reveal disability, age class, or family circumstances.
- `idNumber` is government-issued information peculiar to an individual.
- `maskedName` retains initials, word count, and word lengths.
- Exact issuance/release/expiry dates can be joined with local distribution records.
- `anchoredHash` is deterministic over structured applicant fields and may confirm a
  candidate snapshot when an attacker already has a roster.
- `tokenHash` resists token recovery from a database dump, but it is a stable pseudonymous
  identifier once someone has copied the QR token.

This processing remains subject to RA 10173. Before production, the municipal DPO must
document the necessity, lawful basis, retention, access, disclosure, and processor controls
for each replicated field (§10).

### 4.2 Token hashing — protects a database-only dump

`qrToken` is `uuidv4()` ([idRecordController.js:125](../../../backend/src/controllers/idRecordController.js#L125)) —
122 bits, unguessable. Enumeration is not a realistic threat.

The real exposure is a **full database dump**: storing raw values would hand over every live
token at once.
Storing `SHA-256(qrToken)` as the lookup key means a dumped database contains no usable
tokens. Lookup still works — the service hashes the incoming token and matches.

This does not anonymize the record and does not protect a token copied from a card, browser
history, or access log. Token-safe transport, logging, and cache controls remain required.

### 4.3 `canonicalSnapshot` — resolved, not stored

The 2026-08-02 draft left open whether to replicate `canonicalSnapshot` so the cloud could
re-derive the hash. **Resolved: no.** The snapshot contains `firstName`, `lastName`,
`birthDate`, `sex` ([blockchain.js:20-38](../../../backend/src/services/blockchain.js#L20-L38)) —
exactly the data the user requires to stay local.

The cloud stores `anchoredHash` + receipt as issuance metadata. It does not re-derive or call
that metadata proof of current validity. Keeping the full canonical snapshot local materially
reduces exposure even though the resulting cloud record is still pseudonymous personal data.

---

## 5. Sync Protocol

### 5.1 Outbox — reuses Phase 1

Phase 1 builds a durable operation queue for chain ops. Verification sync uses the same
pattern, and the two are enqueued together at each trigger point.

```js
// backend/src/models/VerifyOutbox.js
{
  operationId: { type: String, required: true, unique: true },
  idRecordId:  { type: Schema.Types.ObjectId, ref: 'IDRecord', required: true },
  tokenHash:   { type: String, index: true },    // raw token is not stored in the outbox
  payload:     Object,                           // immutable VerifiedRecord fields
  payloadDigest: String,
  epoch:       Number,
  revision:    Number,
  state:       { type: String, enum: ['PENDING','PROCESSING','SENT','FAILED'], default: 'PENDING', index: true },
  attempts:    { type: Number, default: 0 },
  nextAttempt: { type: Date, default: Date.now, index: true },
  lastError:   String,
  lockOwner:   String,
  lockedUntil: Date,
}
```

**Why a queue and not a direct POST.** If a revocation is pushed fire-and-forget while the
municipal internet is down, the cancelled ID reads VALID publicly — forever. This is the same
class of defect as Phase 1's Defect A, and the same reason it is unacceptable here.

The business transition, epoch/revision allocation, ChainOutbox intent when applicable, and
VerifyOutbox intent commit in the same MongoDB transaction defined by Phase 1. The verification
worker uses the same leased-claim semantics. Revocation rows retry indefinitely with alerts;
they do not become permanently abandoned after an attempt cap.

### 5.2 Trigger points

| Event | Location |
|---|---|
| ID issued (applicant approval path) | [applicantController.js:66-70](../../../backend/src/controllers/applicantController.js#L66-L70) |
| ID issued / regenerated | [idRecordController.js:173-178](../../../backend/src/controllers/idRecordController.js#L173-L178) |
| ID revoked | [idRecordController.js:342-347](../../../backend/src/controllers/idRecordController.js#L342-L347) |
| Released to citizen | `releasedAt` write in idRecordController |
| Expired | Phase 1 daily expiry job |
| Anchor completed | Phase 1 worker, on `SENT` — carries `txId` + `blockNumber` |

The last row matters: the anchor receipt only exists **after** the chain op succeeds, so the
verification sync for anchor fields is enqueued by the Phase 1 worker, not the controller.

### 5.3 Ordering

`revision` is allocated atomically with the local state transition. The cloud applies a
single atomic compare-and-set over `(epoch, revision)`:

1. A higher epoch supersedes every revision from an older restored generation.
2. Within one epoch, only a higher revision may replace stored state.
3. An equal revision is idempotent only when `payloadDigest` is identical; otherwise it is a
   conflict requiring investigation.
4. `REVOKED` is terminal for a token. No later `ACTIVE` payload may reactivate it; replacement
   issuance uses a new token.

A `409` is not blindly marked `SENT`. The worker first confirms that the cloud holds the same
digest or a genuinely newer authoritative local state. A huge injected cloud revision or an
unexpected epoch becomes an alert and reconciliation event.

After a MongoDB restore, normal incremental sync pauses. An authorized recovery increments
the signed epoch and performs a full current-state/tombstone resynchronization before workers
resume. Restoring the cloud similarly requires a full local rebuild; retained `SENT` rows
alone are not a backup strategy.

### 5.4 Sync freshness — addresses Defect #7

There is an unavoidable window between a local change and its arrival in the cloud (~30s
normally, longer when offline). A timestamp that asks the cashier to judge staleness is not a
sufficient safety control.

The office sends a signed health heartbeat every minute **only after all verification-state
operations are drained**. The cloud stores `sourceLastHealthyAt`. `VERIFY_MAX_SYNC_AGE_MS`
defaults to five minutes for the thesis deployment and is an explicit production SLO setting.

Public result rules, in order:

1. Stored `REVOKED`, stored `EXPIRED`, or read-time expiry → `NOT_VALID`, even if health is
   stale. These states do not fail open.
2. Stored `ACTIVE` and `now - sourceLastHealthyAt <= VERIFY_MAX_SYNC_AGE_MS` → `VALID`.
3. Stored `ACTIVE` with missing/stale health → `UNKNOWN`, with "Current status cannot be
   confirmed. Contact MSWDO." Never render a green valid state.

`syncedAt` remains useful diagnostic metadata, but `sourceLastHealthyAt` drives the safety
decision. The service remains reachable 24/7; during an office or network outage it may be
unable to return a positive result. That is the accepted fail-safe trade-off.

---

## 6. Sync Authentication — Asymmetric Signatures

Decided 2026-08-03.

The office holds an **Ed25519 private key**; the cloud holds only the **public key**. Every
sync payload is signed locally and verified in the cloud.

```
POST /internal/sync
X-Key-Id: <office signing key id>
X-Signature: <base64 Ed25519 signature over the versioned envelope>
X-Timestamp: <unix ms>    ← rejected outside ±5 min, bounds replay exposure
```

**Why not a shared HMAC secret.** With HMAC, the verifying party holds the same secret used
to sign. A cloud breach hands the attacker the ability to mint valid-looking records — the
one thing the database-tampering threat model must prevent. With asymmetric signing, a
database-only breach yields no signing capability because the private key remains local.

The signed bytes are versioned canonical JSON with domain separation and include: protocol
version, key ID, epoch, revision, timestamp, HTTP method, path/audience, token hash, and payload
digest. The cloud stores those exact bytes and signature and verifies them again before every
public read. An exact replay inside the five-minute window is state-harmless only because the
atomic epoch/revision/digest rules in §5.3 reject a conflicting application; the timestamp by
itself does not prevent replay.

The repository currently tracks `backend/.env`, so it cannot truthfully hold a signing key
that is "never in git." Untracking environment files and adding ignore rules is a deployment
gate before key generation. Production key management also requires key IDs, protected local
storage, overlap during rotation, an offline recovery key, revocation, and a wipe/full-resync
procedure after compromise (§10).

---

## 7. Public Endpoint

### `GET /check?token=<uuid>`

```jsonc
{
  "result": "VALID", // VALID | NOT_VALID | UNKNOWN
  "valid": true,
  "status": "ACTIVE",
  "idType": "PWD",
  "idTypeLabel": "Person with Disability (PWD)",
  "idNumber": "PWD-2026-00123",
  "maskedName": "D*****, L*****",
  "issuedDate": "2026-03-01",
  "expiryDate": "2031-03-01",
  "issuanceAnchor": {
    "anchored": true,
    "txId": "a1b2c3…",
    "blockNumber": 42,
    "anchoredAt": "2026-03-01T…"
  },
  "syncedAt": "2026-08-03T14:14:00Z",
  "sourceLastHealthyAt": "2026-08-03T14:30:00Z",
  "verifiedAt": "2026-08-03T14:31:00Z"
}
```

Shape mirrors [verifyController.js:77-90](../../../backend/src/controllers/verifyController.js#L77-L90)
so the existing page needs minimal change.

For `UNKNOWN`, `valid` is `null`; it must never be coerced to `false` and displayed as a
normal invalid credential. The response and page explain that freshness, not the holder's
eligibility, could not be confirmed.

**Read-time expiry.** The cloud applies the same rule as
[verifyController.js:72-75](../../../backend/src/controllers/verifyController.js#L72-L75): `ACTIVE`
past `expiryDate` renders as `EXPIRED`. This works with zero connectivity and needs no sync
event.

**Public-response controls.** The endpoint is unauthenticated and validates UUID format before
lookup. It sends `Cache-Control: no-store, private`, `Pragma: no-cache`, a restrictive
`Referrer-Policy`, and `X-Robots-Tag: noindex, nofollow`. Request logs redact query tokens and
the verification page loads no third-party analytics/assets that could receive the URL.

Rate limiting combines per-IP, per-token, and service-wide/edge limits. The initial
30 requests/min/IP value is only one layer; distributed abuse and carrier-grade NAT make it
insufficient by itself.

---

## 8. Frontend

[VerificationPage.jsx](../../../frontend/src/pages/VerificationPage.jsx) currently calls
`axios.get('/api/verify/${token}')` relative to its own origin. The presentational component
is extracted and the endpoint driven by `VITE_VERIFY_ENDPOINT`, giving two deployments:

- **Local** (staff, in-office) — unchanged behaviour.
- **Cloud** — served by verify-service, calling its own `/check`.

Additions: the scoped issuance-receipt block (§3.3), `sourceLastHealthyAt`, and a first-class
`UNKNOWN` state. `UNKNOWN` uses neutral/amber treatment and never reuses the green VALID or
red NOT VALID presentation.

The route already sits outside `ProtectedRoute` ([App.jsx:57](../../../frontend/src/App.jsx#L57)) —
no auth work needed.

---

## 9. Configuration

| Variable | Where | Value |
|---|---|---|
| `VERIFICATION_BASE_URL` | local | `https://verify.<domain>/check` |
| `VERIFY_SYNC_URL` | local | `https://verify.<domain>/internal/sync` |
| `VERIFY_SIGNING_KEY` | local **only** | Protected Ed25519 private key — never transmitted; environment file must first be untracked |
| `VERIFY_SIGNING_KEY_ID` | local | Active signing-key identifier |
| `VERIFY_PUBLIC_KEYS` | cloud | Key-ID-indexed Ed25519 public-key ring for controlled rotation |
| `VERIFY_MAX_SYNC_AGE_MS` | cloud | Thesis default `300000` (5 minutes); production SLO decision |
| `VERIFY_EPOCH` | local | Signed restore/resynchronization generation |
| `MONGODB_URI` | cloud | Atlas production/backup-capable tier for real deployment; free tier only for development |

### 9.1 Printed-QR note

The QR URL is baked into printed cards. Per the user (2026-08-03), all current records are
sample data to be wiped before real deployment, so no migration is needed — but
`VERIFICATION_BASE_URL` must be set before the first **real** ID is printed.

Production ID generation fails closed if this value is missing, uses localhost, or is not an
approved HTTPS origin. A silent localhost fallback is permitted only in an explicit
development environment.

Existing `qrToken`s remain valid regardless; only the printed URL is fixed at print time.

### 9.2 Hosting — Fly.io

Fly.io is the selected deployment target, not an availability guarantee. Current Fly.io plans
do not provide a general free tier for new organizations, and default auto-stop settings may
scale to zero. Production requires paid warm capacity (`min_machines_running >= 1` or
auto-stop disabled); high availability requires at least two appropriately distributed
Machines with health checks.

MongoDB Atlas M0 is suitable only for development/proof-of-concept use. It has no Atlas
backup service or production SLA and may pause after inactivity. Real deployment requires a
backup-capable production tier, tested restore, and a deliberate network-egress/allowlist
design.

---

## 10. Production Requirements — Documented Gaps, Not Thesis Scope

The prototype may demonstrate the architecture without pretending these controls already
exist. A real municipal deployment is not approved until the responsible office completes:

### 10.1 Privacy and governance

- DPO-led Privacy Impact Assessment covering the pseudonymous cloud replica, Fabric metadata,
  public lookup, logs, backups, and subprocessors.
- Field-by-field lawful-basis, necessity, proportionality, disclosure, and retention analysis
  under RA 10173, plus a public privacy notice.
- Written processor/subprocessor and data-location review for Fly.io, MongoDB Atlas, DNS, and
  any monitoring provider.
- Data-subject access/correction/qualified-erasure workflow, breach-response runbook, and an
  explicit decision on immutable on-chain fields. `revokedReason` must not enter Phase 2; its
  existing Fabric use requires separate user approval before chaincode changes.

### 10.2 Availability, backup, and recovery

- Paid warm Fly.io capacity, multi-Machine HA where the availability target requires it,
  health checks, monitoring, abuse controls, and budget alerts.
- Backup-capable Atlas tier plus encrypted local/Fabric/cloud backups with named owners.
- Approved RPO/RTO, coordinated restore runbooks, quarterly restore drills, full
  local-to-cloud resynchronization, tombstone retention, and ledger/cloud epoch handling.
- Load and failure testing based on expected card count, scan bursts, memory, cold/warm
  latency, database/index size, and denial-of-wallet scenarios — not municipal population
  alone.

### 10.3 Cryptographic and domain operations

- Signing-key generation in protected local storage after `.env` is untracked; key IDs,
  rotation overlap, offline recovery, revocation, access audit, and compromise wipe/resync.
- An LGU-controlled long-lived HTTPS domain with MFA, renewal ownership/budget, DNS change
  audit, recovery contacts, and documented response to domain/DNS compromise. Printed cards
  make this domain a long-term trust dependency.
- Token-redacted logs, credential-safe startup logging, `no-store` responses, dependency
  patching, vulnerability monitoring, and tested incident communications.

These are go-live controls, not optional polish. They are intentionally documented instead of
being falsely claimed as completed thesis features.

---

## 11. Implementation Phases

**Phase 2A — Cloud service**
Scaffold `verification-app/` (currently empty), `VerifiedRecord` model, signed health state,
`GET /check`, and `POST /internal/sync` with canonical-envelope verification, atomic
epoch/revision/digest guard, read-time expiry, UNKNOWN evaluation, and layered rate limits.
→ *Verify:* signature/key-ID rejection, read-time signature re-verification, in-window and
stale replay, equal-revision digest conflict, injected huge revision, restore epoch, expiry,
VALID-to-UNKNOWN freshness transition, terminal NOT_VALID behavior, and token-hash lookup.

**Phase 2B — Local sync outbox**
`VerifyOutbox`, transactional `enqueueVerificationSync()`, wire the §5.2 triggers, signing,
leased/backoff worker, drained-queue heartbeat, indefinite revocation retry, and full-resync
command.
→ *Verify:* integration test — revoke with the cloud unreachable, assert `PENDING`; restore
reachability, assert `SENT` and the cloud reflects REVOKED. **This proves the revocation-loss
scenario is closed.**

**Phase 2C — Frontend split**
Extract the shared component, add scoped issuance receipt, health display, and UNKNOWN state;
build the cloud bundle with token-safe headers/logging.
→ *Verify:* render VALID / NOT_VALID / UNKNOWN / NOT_FOUND from fixtures and assert stale
ACTIVE never receives green valid presentation.

**Phase 2D — Deployment**
After the applicable §10 gates are satisfied: buy/configure the LGU-controlled domain, deploy
paid Fly.io capacity + backup-capable Atlas, generate the first keypair, set env vars, and
update `VERIFICATION_BASE_URL`.
→ *Verify:* scan a real printed QR from a phone on mobile data; power the office PC off for
longer than `VERIFY_MAX_SYNC_AGE_MS` and assert the service remains reachable but returns
UNKNOWN rather than stale VALID; power it on, drain sync, and assert VALID returns. This is
the availability/fail-safe acceptance test for the design.

**Phase 2E — Admin visibility**
Extend the Phase 1 sync panel to cover verification sync failures.
→ *Verify:* force a failed non-revocation row and a long-running revocation alert; confirm
both surface and recovery clears them without dropping the terminal intent.

---

## 12. Known Limitations

Stated for the defense rather than hidden:

1. **Sync lag and partitions.** ~30s normally; longer when the office is offline. Stale ACTIVE
   becomes UNKNOWN. The service remains reachable, but positive verification is deliberately
   unavailable beyond the freshness SLO.
2. **Cloud trust.** Persisted signatures protect against database-only mutation/rollback when
   the service re-verifies them. A compromised cloud runtime can still fabricate its output;
   the runtime remains a trust root unless an independent verifier/witness is added.
3. **Fabric receipt scope.** No live ledger query exists by design. The replicated receipt is
   issuance metadata, not independently verified current-status proof and not proof of QR
   binding.
4. **Recovery requires procedure.** The local database is authoritative, but ordinary outbox
   replay cannot safely recover every backup/restore direction. Epoch-based full resync and
   tested restore runbooks are required.
5. **Pseudonymous personal data remains online.** Hashing/masking reduces exposure but does
   not remove RA 10173 obligations.
6. **Domain not yet purchased.** Blocks Phase 2D only.

---

## 13. Out of Scope

- No cloud→local writes. The cloud is strictly a read replica.
- No change to `buildCanonicalSnapshot()` or the chaincode — altering the hash construction
  invalidates every existing anchor.
- No verifier mobile app. Establishments use the phone camera and a plain URL (§1.1).
