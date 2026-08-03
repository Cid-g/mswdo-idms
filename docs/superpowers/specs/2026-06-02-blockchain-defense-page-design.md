# Blockchain Integrity Page (Defense Demo) — Design Spec

**Date:** 2026-06-02
**Author:** Cedrick (Larsen B. Dignos thesis)
**Status:** Approved design — ready for implementation plan

## Problem

The blockchain (Hyperledger Fabric) layer is the hardest part of the MSWDO IDMS to
explain during oral defense. The panel benefits from *seeing* it work, not just
hearing a description. We need a single, super-admin-only page — reachable by URL —
that both **explains** the blockchain's role and **demonstrates** tamper-evidence
live, while staying safe if the Fabric network is not running on the presentation
device.

## Goals

- One dedicated page at `/superadmin/blockchain`, super-admin only.
- Tell the story top-to-bottom in a single linear scroll (presenter-led flow).
- Show a live, repeatable tamper-evidence demo that never corrupts real data.
- Never blank out or error in front of the panel — graceful fallback when Fabric is off.

## Non-Goals

- No new blockchain *capabilities* (no new chaincode, no new anchoring logic).
- No changes to existing anchoring/verify/revoke behavior.
- Not exposed to ADMIN, ENCODER, RELEASING_STAFF, or the public.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Page type | **Hybrid** — explainer + live demo on one page |
| Live data source | **Real anchored records** from `BlockchainAnchor`/MongoDB, with **safe fallback** to cached anchor data (read-only) when Fabric is off |
| Tamper demo | **Safe simulated tamper** — in-memory hash recompute, no DB writes, repeatable |
| Explainer content | All four: flow diagram, scope vs limitations, defensible Q&A, anchor details |
| Layout | **Linear narrative** (single scroll) |

## Page Layout (linear, top → bottom)

1. **Header** — title + connection badge: `● Fabric connected` (green) or
   `● Offline — showing cached data` (amber).
2. **① Flow diagram** — ID Record → Canonical fields → SHA-256 hash → Anchored
   on-chain (txId/block) → Verify. Static, always visible.
3. **② Live demo** — record selector (dropdown of anchored records) +
   two actions:
   - **Verify integrity** → ✅ match / ❌ mismatch
   - **Simulate tamper (safe)** → pick a field, show ❌ mismatch with the changed value
4. **③ Anchor details** — for the selected record: `canonicalHash`, `txId`,
   `blockNumber`, `anchoredAt`, last check status. Reads from `BlockchainAnchor`.
5. **④ Scope vs Limitations** — two columns (GINAGAWA / HINDI GINAGAWA), sourced
   from the documented defense scope.
6. **⑤ Defensible Q&A** — short expandable list ("Why not a DB hash column?",
   "Why Fabric, not a public chain?").

Sections 1, 4, 5 are static content. Sections 2, 3 are data-driven.

## Architecture

Reuses existing pieces; adds three thin backend endpoints and one frontend page.

### Backend (Express, `backend/src/`)

All new routes mounted under the existing `routes/blockchain.js`, protected with
`authenticate` + `requireRole('SUPERADMIN')` (stricter than the existing
anchor/verify routes, because this page is super-admin only).

New endpoints:

- **`GET /blockchain/anchors`** — list anchored records for the selector.
  Returns `[{ idNumber, applicantName, anchoredAt, lastCheckPassed }]`.
  Joins `BlockchainAnchor` → `IDRecord` → `Applicant`. MongoDB only, no chain call.

- **`GET /blockchain/health`** — drives the connection badge.
  Returns `{ fabricEnabled, connected }`. `fabricEnabled` reflects the
  `FABRIC_ENABLED` env flag; `connected` is a cheap reachability check
  (false when the flag is off).

- **`GET /blockchain/simulate-tamper/:idNumber?field=<fieldName>`** — safe tamper sim.
  Loads the applicant + idRecord, **clones in memory**, mutates one canonical field
  (default `birthDate`), recomputes the hash via `computeHash`, and compares to the
  stored `BlockchainAnchor.canonicalHash`. Returns
  `{ field, originalValue, tamperedValue, originalHash, tamperedHash, match: false }`.
  **No DB writes. No chain call.** Works even when Fabric is off.
  Allowed `field` values are restricted to the canonical-snapshot fields
  (e.g. `birthDate`, `firstName`, `lastName`); reject anything else.

Reused endpoints:

- **`GET /blockchain/verify/:idNumber`** (existing, made fallback-aware) — integrity
  check. When Fabric is reachable it does the live `checkIntegrity` (current
  behavior). When Fabric is off, instead of throwing it recomputes the current
  record's hash via `computeHash` and compares against the stored
  `BlockchainAnchor.canonicalHash`, returning the same result shape plus
  `source: 'live' | 'cached'`. All hashing stays server-side; the frontend never
  computes SHA-256.

Service change:

- **None.** `computeHash(applicant, idRecord)` is already exported and returns
  `{ hash, canonical }`. The tamper-sim controller clones the applicant
  (`.toObject()`), mutates one field, and calls `computeHash` on the clone — no
  modification to `services/blockchain.js` is required.

### Frontend (React + Vite + Tailwind v4, `frontend/src/`)

- **New page:** `pages/superadmin/BlockchainPage.jsx`.
- **Route:** add `<Route path="blockchain" element={<BlockchainPage />} />` to the
  `/superadmin/*` block in `App.jsx`.
- **Nav:** add a sidebar item under the SUPERADMIN **System** section in
  `Sidebar.jsx` (`getNavSections`), label e.g. "Blockchain", a lucide icon
  (e.g. `ShieldCheck`), path `/superadmin/blockchain`.
- Uses the existing `services/api` client and follows existing page styling.

### Data flow

```
Page load
  └─ GET /blockchain/health        → set badge (connected?)
  └─ GET /blockchain/anchors       → populate record selector

Select record
  └─ GET /blockchain/status/:idRecordId (existing) → anchor details (hash/txId/block)

Verify integrity
  └─ GET /blockchain/verify/:idNumber  (server decides: live chain, or
       cached recompute-vs-stored-hash when Fabric off → source: 'live'|'cached')

Simulate tamper
  └─ GET /blockchain/simulate-tamper/:idNumber?field=birthDate
       (in-memory, no DB write, no chain) → always works
```

## Fallback Behavior (Fabric off)

- Badge shows `● Offline — showing cached data` (amber).
- Record selector + anchor details still work (MongoDB only).
- **Verify** returns a server-side cached result (recompute vs stored hash),
  labelled `source: 'cached'` so the UI can mark it clearly.
- **Simulate tamper** is unaffected — it never needed the chain.
- No section errors or disappears.

## Error Handling

- `simulate-tamper` with an invalid/unknown `field` → `400` with a clear message.
- Unknown `idNumber` on any endpoint → `404` (matches existing controller style).
- Frontend: per-section loading + error states; a failed live verify falls back to
  the cached path rather than surfacing a raw error.

## Testing / Success Criteria

- **Backend unit:** `simulate-tamper` returns `match: false` and a different
  `tamperedHash` than `originalHash` for a mutated field; rejects invalid fields with
  `400`; `/anchors` returns the expected shape; `/health` reflects `FABRIC_ENABLED`.
- **Manual (defense rehearsal):**
  1. With Fabric ON: select a record → Verify shows ✅; Simulate tamper shows ❌.
  2. With `FABRIC_ENABLED=false`: page loads fully, badge shows offline, selector +
     details + tamper sim still work, Verify shows cached result.
  3. Non-super-admin roles cannot reach `/superadmin/blockchain` or the new endpoints.

## Out of Scope / Future Work

- Photo/address are not part of the canonical hash (documented limitation) — not
  addressed here.
- Explicit sorted serialization of the canonical snapshot (current alphabetical
  key-order reliance) — noted risk, not changed by this work.

## Affected Files

- `backend/src/routes/blockchain.js` — 3 new routes (SUPERADMIN-gated)
- `backend/src/controllers/blockchainController.js` — 3 new handlers
- `frontend/src/services/blockchainService.js` — new API wrapper
- `frontend/src/pages/superadmin/BlockchainPage.jsx` — new page
- `frontend/src/App.jsx` — 1 new route
- `frontend/src/components/layout/Sidebar.jsx` — 1 new nav item
