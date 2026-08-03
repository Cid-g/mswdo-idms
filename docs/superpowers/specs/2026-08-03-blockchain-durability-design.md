# Phase 1: Durable Blockchain Operations — Design

**Date:** 2026-08-03
**Status:** Approved design — revised after adversarial review; implementation not started
**Prerequisite for:** [Hybrid Online Verification](2026-08-03-hybrid-online-verification-design.md)

---

## 1. Why This Exists

While reviewing the hybrid-verification design, three defects were found in the current
local system. They are not introduced by the cloud work — the cloud work merely makes their
consequences visible outside the office.

Defects A and B are fire-and-forget operations whose only failure handling is a
`console.error`. Defect C is different: expiry has no production integration at all. Their
shared architectural problem is the absence of a durable, reconcilable lifecycle-operation
mechanism.

---

## 2. The Three Defects

### 2.1 Defect A — Revocations silently lost

[idRecordController.js:342-347](../../../backend/src/controllers/idRecordController.js#L342-L347):

```js
record.status = 'REVOKED';
await record.save();                       // ← MongoDB committed

if (process.env.FABRIC_ENABLED === 'true') {
  const { revokeIDOnChain } = require('../services/blockchain');
  revokeIDOnChain(record.idNumber, reason.trim())
    .catch((err) => console.error('[Blockchain] On-chain revoke failed:', err.message));
}                                          // ← not awaited, never retried
```

**Failure scenario.** Staff revokes a fraudulently obtained PWD ID. WSL2 is down (laptop
rebooted, Docker not started — a routine occurrence per
[PROGRESS.md](../../PROGRESS.md) Fabric setup notes).

| Store | Resulting state |
|---|---|
| MongoDB | `REVOKED` ✅ |
| Fabric ledger | `ACTIVE` ❌ — permanently |
| Failure record | none — one console line, lost on restart |

The ledger is now wrong, silently and permanently. Nothing automatically corrects it. A
later live integrity check reports `ACTIVE` for a revoked ID.

The current public verifier still reports `REVOKED` because it derives validity from MongoDB,
not Fabric. The defect is therefore silent ledger divergence, not a current false public
`ACTIVE` result. Phase 2 would make this divergence externally consequential unless the sync
path is durable too.

### 2.2 Defect B — Anchors silently lost

Same pattern at [applicantController.js:69](../../../backend/src/controllers/applicantController.js#L69)
and [idRecordController.js:176](../../../backend/src/controllers/idRecordController.js#L176):

```js
.catch((err) => console.error('[Blockchain] Auto-anchor failed:', err.message));
```

**Failure scenario.** An ID is generated and physically printed while Fabric is unavailable.
The card carries a QR code, but no `BlockchainAnchor` row and no ledger entry exist. The
current public verifier may still report the MongoDB record as valid while marking its
blockchain anchor as pending. Staff can see this state and manually retry, but there is no
automatic recovery.

Printing an unanchored `PARTIAL` applicant is an intentional business rule: anchoring begins
only after profile completion, while quick-encode printing is allowed earlier. This phase
must not silently redefine that workflow. Its durability guarantee applies to records for
which an anchor operation is required; an unanchored `PARTIAL` card remains explicitly
local-only from Fabric's perspective.

### 2.3 Defect C — `expireID()` is never called

[`expireID()`](../../../blockchain/chaincode/id-contract.js#L72-L86) is implemented in the
chaincode. A grep across `backend/src` confirms **zero call sites**.

Consequence: every previously anchored, non-revoked ID remains `ACTIVE` on the ledger after
expiry. This is currently masked by the read-time expiry computation at
[verifyController.js:72-75](../../../backend/src/controllers/verifyController.js#L72-L75), whose
own comment acknowledges the cron job as future work. Under a live integrity check the two
sources disagree — the page says `EXPIRED`, the ledger says `ACTIVE`.

---

## 3. Design: A Durable Operation Queue

One mechanism resolves all three. Fire-and-forget is replaced by an **outbox**: the intent
to perform a chain operation is persisted first, then executed asynchronously with retry.

The same queue is later reused to drive cloud verification sync, so this phase is
foundational rather than throwaway.

### 3.1 Model

```js
// backend/src/models/ChainOutbox.js
{
  operationId: { type: String, required: true, unique: true }, // stable retry identity
  operation:   { type: String, enum: ['ANCHOR','REVOKE','EXPIRE'], required: true },
  idRecordId:  { type: Schema.Types.ObjectId, ref: 'IDRecord', required: true, index: true },
  recordRef:   { type: String, required: true },   // idRecord.idNumber — chain key
  sequence:    { type: Number, required: true },   // immutable, per recordRef
  payload:     Object, // immutable command data; ANCHOR includes the hash computed at enqueue time

  state:       {
    type: String,
    enum: ['PENDING','PROCESSING','SENT','BLOCKED','FAILED'],
    default: 'PENDING',
    index: true,
  },
  attempts:    { type: Number, default: 0 },
  nextAttempt: { type: Date, default: Date.now, index: true },
  lastError:   String,
  lockOwner:   String,
  lockedUntil: Date,

  txId:        String,   // filled on success
  blockNumber: Number,
  completedAt: Date,
}
```

Required indexes:

- `{ state: 1, nextAttempt: 1 }` for due-row polling.
- Unique `{ recordRef: 1, sequence: 1 }` for deterministic ordering.
- Unique `operationId` so an HTTP retry cannot create a second logical command.

For `ANCHOR`, `payload` stores the immutable `canonicalHash` and the exact minimal chaincode
arguments calculated when the business event commits. The worker must not recompute the hash
from a later, editable applicant record; otherwise it would anchor a different snapshot from
the one that triggered the operation.

### 3.2 Atomic write invariant

The business mutation, lifecycle revision/sequence allocation, and outbox insert commit in
one MongoDB transaction. "Same request flow" is not sufficient: a process can die after the
business `save()` and before `ChainOutbox.create()`.

This requires the local MongoDB deployment and test harness to run as a replica set. Each
producer uses `session.withTransaction()` and an idempotent `operationId`. A reconciliation
job remains mandatory as defense in depth: it scans business state against anchors and
nonterminal outbox rows, then recreates any missing intent after a backup restore or an
operator mistake.

If replica-set deployment cannot be provided, implementation must stop and return to design
review; silently falling back to two independent writes would reproduce the original defect.

### 3.3 Ordering guarantee

Operations on the same `recordRef` **must** apply in order. An `EXPIRE` overtaking a `REVOKE`
would produce a wrong final state, and the chaincode explicitly rejects expiring a revoked
record ([id-contract.js:78-80](../../../blockchain/chaincode/id-contract.js#L78-L80)).

Rule: the worker never processes an operation while any lower sequence for the same
`recordRef` is not `SENT`. This includes `PENDING`, `PROCESSING`, `BLOCKED`, and `FAILED` — a
failed ANCHOR must not allow a later REVOKE to overtake it. Dependents become `BLOCKED` and
resume in order when the predecessor is repaired. Serial per record, parallel across records.

`ANCHOR` is the prerequisite for chain lifecycle mutations. A `PARTIAL` ID with neither an
anchor nor a pending anchor does not enqueue a standalone `REVOKE` or `EXPIRE` that Fabric
cannot apply. Its local and Phase 2 cloud status still change normally, and the admin UI must
state that the card never entered the ledger. Supporting on-chain tombstones for such cards
would require a separate chaincode/product decision.

### 3.4 Worker

Runs on an interval (30s) in the local backend:

1. Atomically claim one due row (`PENDING`, `nextAttempt <= now`) by changing it to
   `PROCESSING` and assigning `lockOwner` + `lockedUntil`. A stale lease returns to `PENDING`.
2. Before claiming, require every lower sequence for the same record to be `SENT`; otherwise
   mark/leave the row `BLOCKED`.
3. If `FABRIC_ENABLED !== 'true'` or the gateway is disconnected, leave the operation due
   without consuming a business retry attempt.
4. Execute the matching `services/blockchain.js` function.
5. Success → `SENT`, record `txId` + `blockNumber`, and clear the lease.
6. Failure → increment `attempts`, set `nextAttempt` by exponential backoff
   (30s, 1m, 5m, 15m, 1h, capped at 1h), keep `PENDING`.
7. `REVOKE` never becomes permanently abandoned: it retries indefinitely and raises an
   alert after 20 attempts. `ANCHOR` and `EXPIRE` may become `FAILED` after 20 attempts and
   must block their dependents until an administrator retries or reconciles them.

The Fabric connection manager reconnects with serialized backoff. A backend that starts
before Fabric must recover without a process restart; "gateway not initialized" is an
infrastructure state, not a permanent business failure.

### 3.5 Idempotency and ambiguous commits

Retries must converge without trusting human error strings as proof:

- Before retrying an ambiguous `ANCHOR`, query the ledger. Existing state counts as success
  only when `recordRef`, canonical hash, type, and expected metadata match the immutable
  payload. "Already exists" alone is not success.
- Before retrying `REVOKE` or `EXPIRE`, query current ledger state. `REVOKED` satisfies either
  terminal intent because revocation takes precedence. `EXPIRED` satisfies only `EXPIRE`.
- A commit response counts as success only when Fabric reports `status.successful === true`.
- Structured gateway details may classify an error, but error-message text never directly
  marks an operation `SENT`.

The prototype has one administrative writer and can use read-before-retry reconciliation.
For a multi-organization production network, add `operationId` handling to chaincode so a
repeated command is a true no-op that preserves the original lifecycle timestamp and history.

---

## 4. Call-Site Changes

Each site swaps a fire-and-forget promise for a transactional queue write. The enqueue and
business transition obey the atomic invariant in §3.2.

| Site | Now | After |
|---|---|---|
| [applicantController.js:66-70](../../../backend/src/controllers/applicantController.js#L66-L70) | `anchorIDOnChain().catch(log)` | `enqueueChainOp('ANCHOR', idRecord)` |
| [idRecordController.js:173-178](../../../backend/src/controllers/idRecordController.js#L173-L178) | `anchorIDOnChain().catch(log)` | `enqueueChainOp('ANCHOR', idRecord)` |
| [idRecordController.js:342-347](../../../backend/src/controllers/idRecordController.js#L342-L347) | `revokeIDOnChain().catch(log)` | `enqueueChainOp('REVOKE', record, { reason })` |
| [blockchainController.js:29](../../../backend/src/controllers/blockchainController.js#L29) | direct `anchorIDOnChain()` | enqueue/claim through the same operation path and wait for synchronous feedback |

Producers enqueue regardless of `FABRIC_ENABLED`; that flag controls execution, not whether
intent is preserved. The worker reconciles `BlockchainAnchor` with live ledger state rather
than trusting anchor-row existence alone. The manual admin action uses the same operation and
reconciliation path but waits for synchronous feedback; it must not submit beside a pending
worker operation.

### 4.1 Revoke response — decided 2026-08-03

Revocation proceeds immediately in MongoDB and returns success. The response includes a
pending-sync indicator so the UI can warn without blocking:

```jsonc
{ "...": "...", "chainSync": { "state": "PENDING", "operation": "REVOKE" } }
```

Blocking revocation on Fabric availability was rejected: revocation is an urgent security
action and must never be gated on infrastructure health. Silent success was also rejected —
it reproduces today's invisibility.

Frontend: a non-blocking notice on the revoke confirmation — *"ID revoked. Blockchain sync
pending."*

---

## 5. Admin Visibility

A stuck operation that nobody can see is the defect this design exists to remove. SuperAdmin
gets a **Blockchain Sync Status** panel:

- Count of `PENDING`, `PROCESSING`, and `BLOCKED` (and how long the oldest has waited)
- List of `FAILED` and alerted long-running revocations with `recordRef`, operation,
  `lastError`, attempt count, and predecessor state
- Manual **Retry** action resetting a row to `PENDING` with `attempts: 0`
- Reconciliation action/report for stale receipts, missing intents, and ledger-epoch mismatch

Without this, the queue merely relocates the invisibility.

---

## 6. Expiry Job — decided 2026-08-03

A daily scheduled job (`setInterval`, 24h, run once on boot) with a database-backed scheduler
lease so multiple backend processes cannot run it concurrently:

1. Atomically select an `IDRecord` whose status is still `ACTIVE` and `expiryDate < now`.
2. In the same MongoDB transaction, conditionally change it to `EXPIRED`, allocate the next
   lifecycle sequence, and enqueue `EXPIRE` when the record is anchored or has a prerequisite
   ANCHOR.
3. If a concurrent revocation wins, the expiry update matches nothing; `REVOKED` always takes
   precedence and cannot be overwritten by a stale job document.

Lazy expire-on-scan was rejected: an ID nobody scans would stay `ACTIVE` on-chain forever,
leaving the ledger permanently divergent from reality.

Senior Citizen IDs have `expiryDate: null` ([IDRecord.js](../../../backend/src/models/IDRecord.js))
and are correctly excluded by the `expiryDate < now` predicate.

The read-time expiry check in `verifyController` **stays** as a safety net — it covers the
window between actual expiry and the next job run.

---

## 7. Implementation Phases

**Phase 1A — MongoDB transaction foundation + model**
Enable a single-node replica set locally and `MongoMemoryReplSet` in integration tests;
create the `ChainOutbox` model, sequence allocator, immutable payload builder, and transactional
`enqueueChainOp()` helper.
→ *Verify:* crash/rollback tests prove neither business state nor outbox intent can commit
alone; duplicate `operationId` does not create a second command.

**Phase 1B — Leased worker + Fabric reliability**
Atomic claims, stale-lease recovery, predecessor blocking, backoff, state reconciliation,
commit-status validation, and reconnecting Fabric gateway. Replace chaincode `new Date()` with
the Fabric transaction timestamp so endorsers use the same value.
→ *Verify:* concurrent-worker, stale-lease, failed-predecessor, invalid-commit, ambiguous
commit, connection-at-startup, and wrong-hash existing-record tests.

**Phase 1C — Wire call sites**
Replace the three fire-and-forget sites; move the anchor-exists guard into the worker.
→ *Verify:* integration tests for both ANCHOR producers and REVOKE with Fabric disabled assert
that durable `PENDING` rows exist; enabling Fabric and running the worker produces `SENT` with
a verified receipt. Include a `PARTIAL`-then-revoked record and assert that it remains
explicitly unanchored rather than submitting an impossible Fabric mutation.

**Phase 1D — Expiry job**
Daily job per §6.
→ *Verify:* seed an anchored ID with a past `expiryDate`, run the job, assert local `EXPIRED`
and a queued `EXPIRE`; simulate enqueue rollback and expiry/revoke races.

**Phase 1E — Reconciliation + admin panel**
Sync status UI, manual retry, restore detection, and reconciliation report.
→ *Verify:* force `FAILED`/`BLOCKED` rows and an alerted revocation, confirm they render and
resume in sequence. Reset Fabric or restore MongoDB in a fixture, then prove reconciliation
detects the ledger epoch mismatch instead of trusting stale receipts.

---

## 8. Backup, restore, and ledger epoch

Ordinary retries cannot repair every restore direction:

- MongoDB restored behind Fabric can resurrect local `ACTIVE` while the ledger is `REVOKED`.
- Fabric restored/reset behind MongoDB leaves `SENT` rows and `BlockchainAnchor` receipts
  pointing to transactions that no longer exist.
- Replaying every `SENT` row blindly can duplicate lifecycle history or accept a wrong-hash
  collision.

Store a ledger/channel epoch with each receipt and detect epoch changes at startup and during
reconciliation. Workers pause on mismatch. Recovery is an explicit operation: compare live
ledger state with immutable local intents, replay ANCHOR in sequence, converge terminal state,
and replace receipts only after successful commits. Define coordinated MongoDB/Fabric RPO and
RTO and test both restore directions before production.

---

## 9. Out of Scope

- No change to `buildCanonicalSnapshot()` or the hash construction — altering it invalidates
  every existing anchor.
- No change to canonical hash fields or public proof semantics. Using Fabric's transaction
  timestamp is a deterministic correctness fix; command-level `operationId` support and any
  change to on-chain revocation reasons require a separately approved chaincode revision.
- No cloud components — that is the [hybrid verification design](2026-08-03-hybrid-online-verification-design.md).
- Existing demo/sample records are not backfilled. Per the user (2026-08-03), current data is
  sample data to be wiped before real deployment.
