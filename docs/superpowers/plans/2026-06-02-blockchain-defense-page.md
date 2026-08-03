# Blockchain Integrity Page (Defense Demo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A super-admin-only page at `/superadmin/blockchain` that explains the blockchain layer and demonstrates tamper-evidence live, with graceful fallback when the Fabric network is off.

**Architecture:** Three thin SUPERADMIN-gated read endpoints added to the existing `routes/blockchain.js` (`/health`, `/anchors`, `/simulate-tamper`), plus the existing `/verify` endpoint made fallback-aware. A single React page consumes them via a new `blockchainService` and `@tanstack/react-query`. All hashing stays server-side using the already-exported `computeHash`; the tamper simulation mutates an in-memory clone and never writes to the DB or calls the chain.

**Tech Stack:** Node.js + Express + Mongoose + Jest/supertest (backend); React 19 + Vite + Tailwind v4 + react-query + lucide-react (frontend).

---

## Notes Before You Start

- **Git:** This project directory is **not** a git repository yet. Either run `git init` first, or skip the `git commit` steps (they are included for when version control is in place).
- **No service change needed:** `computeHash(applicant, idRecord)` is already exported from `backend/src/services/blockchain.js` and returns `{ hash, canonical }`. Use it directly — do **not** modify the service.
- **Fabric flag:** "Connected" is derived from `process.env.FABRIC_ENABLED === 'true'` (matches existing usage in `server.js`, `applicantController.js`, `verifyController.js`). No live socket probe — keep it simple and non-flaky.
- **Backend test pattern:** integration tests use `supertest` + `mongodb-memory-server` via `tests/dbHelpers` and `tests/testHelpers` (`createTestUser`, `getToken`). See `backend/tests/integration/verify.test.js` for the template.
- **Frontend:** there is no JS test runner (only ESLint). Frontend tasks verify via `npm run lint` + manual browser check.

## File Structure

**Backend**
- Modify: `backend/src/controllers/blockchainController.js` — add `getHealth`, `listAnchors`, `simulateTamper`; make `verifyRecord` fallback-aware.
- Modify: `backend/src/routes/blockchain.js` — register 3 new SUPERADMIN routes.
- Test: `backend/tests/integration/blockchainPage.test.js` — new integration test file for the new/changed endpoints.

**Frontend**
- Create: `frontend/src/services/blockchainService.js` — API wrapper.
- Create: `frontend/src/pages/superadmin/BlockchainPage.jsx` — the page.
- Modify: `frontend/src/App.jsx` — add the route.
- Modify: `frontend/src/components/layout/Sidebar.jsx` — add the nav item.

---

## Task 1: `GET /api/blockchain/health` endpoint

**Files:**
- Modify: `backend/src/controllers/blockchainController.js`
- Modify: `backend/src/routes/blockchain.js`
- Test: `backend/tests/integration/blockchainPage.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/integration/blockchainPage.test.js`:

```js
'use strict';

const supertest = require('supertest');
const mongoose  = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const app = require('../../src/app');
const db  = require('../dbHelpers');
const { createTestUser, getToken } = require('../testHelpers');
const Applicant        = require('../../src/models/Applicant');
const IDRecord         = require('../../src/models/IDRecord');
const BlockchainAnchor = require('../../src/models/BlockchainAnchor');
const { computeHash }  = require('../../src/services/blockchain');

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.disconnect(); });
afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of ['applicants', 'idrecords', 'users', 'blockchainanchors', 'auditlogs']) {
    if (collections[key]) await collections[key].deleteMany({});
  }
  delete process.env.FABRIC_ENABLED;
});

// Seeds a complete applicant + active ID + a matching on-chain anchor.
async function seedAnchoredRecord() {
  const encoder = await createTestUser({ username: 'enc_bc', role: 'ENCODER' });
  const applicant = await Applicant.create({
    firstName: 'Maria', lastName: 'Santos', middleName: 'Reyes',
    birthdate: new Date('1975-03-10'), sex: 'Female',
    barangay: 'Poblacion 1', department: 'PWD',
    encodedById: encoder._id, status: 'COMPLETE',
  });
  const idRecord = await IDRecord.create({
    applicantId: applicant._id, department: 'PWD',
    idNumber: 'PWD-2026-TEST-001', qrToken: uuidv4(), status: 'ACTIVE',
    issuedDate: new Date('2026-05-01'),
    expiryDate: new Date('2031-05-01'),
    idImagePath: 'uploads/ids/dummy-front.png',
  });
  const { hash } = computeHash(applicant, idRecord);
  const anchor = await BlockchainAnchor.create({
    idRecordId: idRecord._id, recordRef: idRecord.idNumber,
    canonicalHash: hash, txId: 'tx-test-abc', blockNumber: 284,
    anchoredAt: new Date('2026-05-02'), lastCheckPassed: true,
  });
  return { applicant, idRecord, anchor };
}

async function superadminToken() {
  await createTestUser({ username: 'super_bc', role: 'SUPERADMIN', department: undefined });
  return getToken(app, 'super_bc');
}

describe('GET /api/blockchain/health', () => {
  test('reflects FABRIC_ENABLED=false', async () => {
    delete process.env.FABRIC_ENABLED;
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/health')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.fabricEnabled).toBe(false);
    expect(res.body.connected).toBe(false);
  });

  test('reflects FABRIC_ENABLED=true', async () => {
    process.env.FABRIC_ENABLED = 'true';
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/health')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.fabricEnabled).toBe(true);
    expect(res.body.connected).toBe(true);
  });

  test('rejects non-superadmin with 403', async () => {
    await createTestUser({ username: 'enc_only', role: 'ENCODER' });
    const token = await getToken(app, 'enc_only');
    const res = await supertest(app)
      .get('/api/blockchain/health')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/integration/blockchainPage.test.js -t "GET /api/blockchain/health"`
Expected: FAIL — `/health` returns 404 (route not registered).

- [ ] **Step 3: Add the controller handler**

In `backend/src/controllers/blockchainController.js`, add this function above the `module.exports` line:

```js
// ── GET /blockchain/health ───────────────────────────────────────────────────
// Drives the connection badge on the super-admin blockchain page.
async function getHealth(req, res) {
  const fabricEnabled = process.env.FABRIC_ENABLED === 'true';
  return res.json({ fabricEnabled, connected: fabricEnabled });
}
```

Update the exports line:

```js
module.exports = { anchorRecord, verifyRecord, getAnchorStatus, getHealth };
```

- [ ] **Step 4: Register the route**

In `backend/src/routes/blockchain.js`, update the imports and add the route:

```js
const {
  anchorRecord,
  verifyRecord,
  getAnchorStatus,
  getHealth,
} = require('../controllers/blockchainController');

router.get('/health', authenticate, requireRole('SUPERADMIN'), getHealth);
```

(Add the `router.get('/health', ...)` line just below the existing `router.get('/status/...')` line.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- tests/integration/blockchainPage.test.js -t "GET /api/blockchain/health"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/blockchainController.js backend/src/routes/blockchain.js backend/tests/integration/blockchainPage.test.js
git commit -m "feat(blockchain): add SUPERADMIN /health endpoint for defense page"
```

---

## Task 2: `GET /api/blockchain/anchors` endpoint (record selector)

**Files:**
- Modify: `backend/src/controllers/blockchainController.js`
- Modify: `backend/src/routes/blockchain.js`
- Test: `backend/tests/integration/blockchainPage.test.js`

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `backend/tests/integration/blockchainPage.test.js`:

```js
describe('GET /api/blockchain/anchors', () => {
  test('returns anchored records with applicant name', async () => {
    await seedAnchoredRecord();
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/anchors')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].idNumber).toBe('PWD-2026-TEST-001');
    expect(res.body[0].applicantName).toBe('Santos, Maria');
    expect(res.body[0].idRecordId).toBeTruthy();
    expect(res.body[0].lastCheckPassed).toBe(true);
  });

  test('returns empty array when nothing is anchored', async () => {
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/anchors')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/integration/blockchainPage.test.js -t "GET /api/blockchain/anchors"`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Add the controller handler**

In `backend/src/controllers/blockchainController.js`, add above `module.exports`:

```js
// ── GET /blockchain/anchors ──────────────────────────────────────────────────
// List of anchored records for the page's record selector. MongoDB only.
async function listAnchors(req, res, next) {
  try {
    const anchors = await BlockchainAnchor.find().sort({ anchoredAt: -1 }).lean();
    const result = await Promise.all(anchors.map(async (a) => {
      const idRecord  = await IDRecord.findById(a.idRecordId).lean();
      const applicant = idRecord ? await Applicant.findById(idRecord.applicantId).lean() : null;
      return {
        idNumber:        a.recordRef,
        idRecordId:      a.idRecordId,
        applicantName:   applicant ? `${applicant.lastName}, ${applicant.firstName}` : '(unknown)',
        anchoredAt:      a.anchoredAt,
        lastCheckPassed: a.lastCheckPassed ?? null,
      };
    }));
    return res.json(result);
  } catch (err) {
    next(err);
  }
}
```

Update the exports line:

```js
module.exports = { anchorRecord, verifyRecord, getAnchorStatus, getHealth, listAnchors };
```

- [ ] **Step 4: Register the route**

In `backend/src/routes/blockchain.js`, add `listAnchors` to the destructured imports and add below the `/health` route:

```js
router.get('/anchors', authenticate, requireRole('SUPERADMIN'), listAnchors);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- tests/integration/blockchainPage.test.js -t "GET /api/blockchain/anchors"`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/blockchainController.js backend/src/routes/blockchain.js backend/tests/integration/blockchainPage.test.js
git commit -m "feat(blockchain): add SUPERADMIN /anchors list endpoint"
```

---

## Task 3: `GET /api/blockchain/simulate-tamper/:idNumber` (safe tamper demo)

**Files:**
- Modify: `backend/src/controllers/blockchainController.js`
- Modify: `backend/src/routes/blockchain.js`
- Test: `backend/tests/integration/blockchainPage.test.js`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/integration/blockchainPage.test.js`:

```js
describe('GET /api/blockchain/simulate-tamper/:idNumber', () => {
  test('returns a mismatch and does NOT modify the DB', async () => {
    const { applicant } = await seedAnchoredRecord();
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/simulate-tamper/PWD-2026-TEST-001?field=birthDate')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.field).toBe('birthDate');
    expect(res.body.match).toBe(false);
    expect(res.body.tamperedHash).not.toBe(res.body.originalHash);
    expect(res.body.originalValue).toBe('1975-03-10');
    expect(res.body.tamperedValue).not.toBe('1975-03-10');

    // The real applicant record is untouched
    const fresh = await Applicant.findById(applicant._id);
    expect(new Date(fresh.birthdate).toISOString().split('T')[0]).toBe('1975-03-10');
  });

  test('rejects an unknown field with 400', async () => {
    await seedAnchoredRecord();
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/simulate-tamper/PWD-2026-TEST-001?field=photo')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  test('returns 404 when the record is not anchored', async () => {
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/simulate-tamper/PWD-DOES-NOT-EXIST?field=birthDate')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/integration/blockchainPage.test.js -t "simulate-tamper"`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Add the controller handler**

In `backend/src/controllers/blockchainController.js`, add `computeHash` to the service import at the top:

```js
const {
  anchorIDOnChain,
  verifyIDOnChain,
  checkIntegrity,
  computeHash,
} = require('../services/blockchain');
```

Then add above `module.exports`:

```js
// ── GET /blockchain/simulate-tamper/:idNumber?field=<f> ──────────────────────
// Safe, in-memory tamper demo. Clones the applicant, mutates ONE canonical
// field, recomputes the hash, and compares to the stored on-chain hash.
// Never writes to MongoDB. Never calls the chain. Works even when Fabric is off.
const TAMPERABLE_FIELDS = {
  birthDate: (a) => {
    const d = new Date(a.birthdate);
    d.setDate(d.getDate() + 1);
    a.birthdate = d;
    return d.toISOString().split('T')[0];
  },
  firstName: (a) => { a.firstName = `${a.firstName}X`; return a.firstName; },
  lastName:  (a) => { a.lastName  = `${a.lastName}X`;  return a.lastName;  },
};

async function simulateTamper(req, res, next) {
  try {
    const { idNumber } = req.params;
    const field = req.query.field || 'birthDate';

    if (!TAMPERABLE_FIELDS[field]) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: `field must be one of: ${Object.keys(TAMPERABLE_FIELDS).join(', ')}` },
      });
    }

    const idRecord = await IDRecord.findOne({ idNumber });
    if (!idRecord) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ID record not found.' } });
    }
    const anchor = await BlockchainAnchor.findOne({ idRecordId: idRecord._id });
    if (!anchor) {
      return res.status(404).json({ error: { code: 'NOT_ANCHORED', message: 'This record is not anchored on-chain.' } });
    }
    const applicant = await Applicant.findById(idRecord.applicantId);
    if (!applicant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Applicant not found.' } });
    }

    const originalValue = field === 'birthDate'
      ? new Date(applicant.birthdate).toISOString().split('T')[0]
      : applicant[field];

    const clone = applicant.toObject();          // in-memory copy — never saved
    const tamperedValue = TAMPERABLE_FIELDS[field](clone);
    const { hash: tamperedHash } = computeHash(clone, idRecord);

    return res.json({
      idNumber,
      field,
      originalValue,
      tamperedValue,
      originalHash: anchor.canonicalHash,
      tamperedHash,
      match: tamperedHash === anchor.canonicalHash, // always false
    });
  } catch (err) {
    next(err);
  }
}
```

Update the exports line:

```js
module.exports = { anchorRecord, verifyRecord, getAnchorStatus, getHealth, listAnchors, simulateTamper };
```

- [ ] **Step 4: Register the route**

In `backend/src/routes/blockchain.js`, add `simulateTamper` to the destructured imports and add below the `/anchors` route:

```js
router.get('/simulate-tamper/:idNumber', authenticate, requireRole('SUPERADMIN'), simulateTamper);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- tests/integration/blockchainPage.test.js -t "simulate-tamper"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/blockchainController.js backend/src/routes/blockchain.js backend/tests/integration/blockchainPage.test.js
git commit -m "feat(blockchain): add safe in-memory simulate-tamper endpoint"
```

---

## Task 4: Make `GET /api/blockchain/verify/:idNumber` fallback-aware

**Files:**
- Modify: `backend/src/controllers/blockchainController.js` (`verifyRecord`)
- Test: `backend/tests/integration/blockchainPage.test.js`

**Context:** Currently `verifyRecord` always calls `checkIntegrity`, which calls the live chain. When `FABRIC_ENABLED !== 'true'` this throws. We add an offline branch that recomputes the current hash and compares it to the stored `canonicalHash`, returning `source: 'cached'`. The live branch returns `source: 'live'`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/integration/blockchainPage.test.js`:

```js
describe('GET /api/blockchain/verify/:idNumber — offline fallback', () => {
  test('returns source:cached and hashMatch:true when Fabric is off and record is untampered', async () => {
    delete process.env.FABRIC_ENABLED;
    await seedAnchoredRecord();
    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/verify/PWD-2026-TEST-001')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.anchored).toBe(true);
    expect(res.body.source).toBe('cached');
    expect(res.body.hashMatch).toBe(true);
  });

  test('returns source:cached and hashMatch:false when the DB record was edited after anchoring', async () => {
    delete process.env.FABRIC_ENABLED;
    const { applicant } = await seedAnchoredRecord();
    // Edit the record AFTER anchoring → stored hash no longer matches
    applicant.firstName = 'Mariah';
    await applicant.save();

    const token = await superadminToken();
    const res = await supertest(app)
      .get('/api/blockchain/verify/PWD-2026-TEST-001')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.source).toBe('cached');
    expect(res.body.hashMatch).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/integration/blockchainPage.test.js -t "offline fallback"`
Expected: FAIL — currently `verifyRecord` calls the chain and there is no `source` field (the call throws or returns without `source`).

- [ ] **Step 3: Update `verifyRecord`**

In `backend/src/controllers/blockchainController.js`, replace the block in `verifyRecord` that starts at `const result = await checkIntegrity(applicant, idRecord);` through its `return res.json({ ... });` with:

```js
    // Offline / Fabric-disabled fallback: recompute hash vs the stored anchor.
    if (process.env.FABRIC_ENABLED !== 'true') {
      const { hash } = computeHash(applicant, idRecord);
      const hashMatch = hash === anchor.canonicalHash;
      return res.json({
        idNumber,
        anchored:   true,
        hashMatch,
        source:     'cached',
        anchoredAt: anchor.anchoredAt,
        reason:     hashMatch ? null : 'HASH_MISMATCH',
      });
    }

    const result = await checkIntegrity(applicant, idRecord);

    await BlockchainAnchor.findByIdAndUpdate(anchor._id, {
      lastCheckedAt:   new Date(),
      lastCheckPassed: result.verified,
    });

    return res.json({
      idNumber,
      anchored:      true,
      hashMatch:     result.verified,
      source:        'live',
      onChainStatus: result.onChainStatus ?? null,
      anchoredAt:    anchor.anchoredAt,
      reason:        result.reason ?? null,
    });
```

(`computeHash` is already imported from Task 3. If Task 3 was skipped, add it to the service import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- tests/integration/blockchainPage.test.js`
Expected: PASS (all blockchainPage tests).

- [ ] **Step 5: Run the full backend unit+integration suite to check for regressions**

Run: `cd backend && npm test -- tests/integration/verify.test.js tests/integration/blockchainPage.test.js`
Expected: PASS (existing verify tests still green — they don't assert on `source`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/blockchainController.js backend/tests/integration/blockchainPage.test.js
git commit -m "feat(blockchain): make verify endpoint fallback-aware (live|cached source)"
```

---

## Task 5: Frontend `blockchainService`

**Files:**
- Create: `frontend/src/services/blockchainService.js`

- [ ] **Step 1: Create the service**

Create `frontend/src/services/blockchainService.js`:

```js
import api from './api';

export const blockchainService = {
  getHealth:      ()           => api.get('/blockchain/health').then((r) => r.data),
  getAnchors:     ()           => api.get('/blockchain/anchors').then((r) => r.data),
  getStatus:      (idRecordId) => api.get(`/blockchain/status/${idRecordId}`).then((r) => r.data),
  verify:         (idNumber)   => api.get(`/blockchain/verify/${idNumber}`).then((r) => r.data),
  simulateTamper: (idNumber, field) =>
    api.get(`/blockchain/simulate-tamper/${idNumber}`, { params: { field } }).then((r) => r.data),
};
```

- [ ] **Step 2: Verify it lints**

Run: `cd frontend && npm run lint`
Expected: no new errors for `blockchainService.js`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/blockchainService.js
git commit -m "feat(frontend): add blockchainService API wrapper"
```

---

## Task 6: Frontend `BlockchainPage`

**Files:**
- Create: `frontend/src/pages/superadmin/BlockchainPage.jsx`

- [ ] **Step 1: Create the page**

Create `frontend/src/pages/superadmin/BlockchainPage.jsx`:

```jsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, CircleCheck, CircleX, ArrowRight, Wifi, WifiOff } from 'lucide-react';
import { blockchainService } from '../../services/blockchainService';

const FLOW = [
  { icon: '📄', label: 'ID Record' },
  { icon: '🧮', label: 'Canonical fields' },
  { icon: '#️⃣', label: 'SHA-256 hash' },
  { icon: '⛓️', label: 'Anchored on-chain' },
  { icon: '✓',  label: 'Verify' },
];

const SCOPE_DOES = [
  'Tamper-evidence — SHA-256 of identity fields anchored on-chain',
  'Immutable audit trail — issue / revoke / expire events',
  'Decentralized trust for a multi-office / multi-LGU future',
];
const SCOPE_DOESNT = [
  'No personal data on-chain (RA 10173 — only a hash + status)',
  'Does not replace MongoDB (MongoDB stays system of record)',
  'Photo and address are NOT part of the hash',
];

const QA = [
  {
    q: 'Why not just a DB hash column?',
    a: 'A DB admin can edit BOTH the record AND its hash column. The on-chain hash lives outside the app database, is append-only, and is replicated across organizations — it cannot be silently rewritten.',
  },
  {
    q: 'Why Hyperledger Fabric, not a public chain?',
    a: 'Permissioned network: no crypto/gas, known validators (government offices), and private data stays off public networks.',
  },
];

const TAMPER_FIELDS = ['birthDate', 'firstName', 'lastName'];

function Section({ label, children }) {
  return (
    <section className="mb-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 mb-3">{label}</p>
      {children}
    </section>
  );
}

function HashChip({ value }) {
  if (!value) return <span className="text-slate-500">—</span>;
  const short = `${value.slice(0, 8)}…${value.slice(-6)}`;
  return <span className="font-mono text-[12px] text-slate-200" title={value}>{short}</span>;
}

export default function BlockchainPage() {
  const { data: health } = useQuery({ queryKey: ['bc-health'], queryFn: blockchainService.getHealth });
  const { data: anchors = [] } = useQuery({ queryKey: ['bc-anchors'], queryFn: blockchainService.getAnchors });

  const [selected, setSelected]         = useState('');     // idNumber
  const [verifyResult, setVerifyResult] = useState(null);
  const [tamperResult, setTamperResult] = useState(null);
  const [busy, setBusy]                 = useState(false);

  const connected = health?.connected ?? false;
  const selectedAnchor = anchors.find((a) => a.idNumber === selected);

  const { data: status } = useQuery({
    queryKey: ['bc-status', selectedAnchor?.idRecordId],
    queryFn:  () => blockchainService.getStatus(selectedAnchor.idRecordId),
    enabled:  Boolean(selectedAnchor),
  });

  function onSelect(idNumber) {
    setSelected(idNumber);
    setVerifyResult(null);
    setTamperResult(null);
  }

  async function handleVerify() {
    if (!selected) return;
    setBusy(true); setTamperResult(null);
    try { setVerifyResult(await blockchainService.verify(selected)); }
    finally { setBusy(false); }
  }

  async function handleTamper(field) {
    if (!selected) return;
    setBusy(true); setVerifyResult(null);
    try { setTamperResult(await blockchainService.simulateTamper(selected, field)); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-4xl mx-auto text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldCheck className="w-6 h-6 text-sky-400" /> Blockchain Integrity
        </h1>
        <span
          className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1 rounded-full"
          style={connected
            ? { background: 'rgba(16,185,129,0.15)', color: '#6ee7b7' }
            : { background: 'rgba(245,158,11,0.15)', color: '#fcd34d' }}
        >
          {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {connected ? 'Fabric connected' : 'Offline — showing cached data'}
        </span>
      </div>
      <p className="text-sm text-slate-400 mb-8">
        How Hyperledger Fabric keeps MSWDO ID records tamper-evident.
      </p>

      {/* ① Flow diagram */}
      <Section label="① Paano gumagana">
        <div className="flex items-center gap-2 flex-wrap rounded-xl bg-slate-800/50 p-4">
          {FLOW.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1 w-24 text-center">
                <span className="text-2xl">{s.icon}</span>
                <span className="text-[11px] text-slate-300">{s.label}</span>
              </div>
              {i < FLOW.length - 1 && <ArrowRight className="w-4 h-4 text-sky-500 flex-shrink-0" />}
            </div>
          ))}
        </div>
      </Section>

      {/* ② Live demo */}
      <Section label="② Live demo">
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
          <label className="block text-[12px] text-slate-400 mb-1">Piliin ang record:</label>
          <select
            value={selected}
            onChange={(e) => onSelect(e.target.value)}
            className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100"
          >
            <option value="">— select an anchored record —</option>
            {anchors.map((a) => (
              <option key={a.idNumber} value={a.idNumber}>
                {a.idNumber} — {a.applicantName}
              </option>
            ))}
          </select>

          {anchors.length === 0 && (
            <p className="mt-3 text-[12px] text-amber-300">
              Walang naka-anchor na record pa. Mag-anchor muna ng isang ID, o patakbuhin ang demo seed.
            </p>
          )}

          {selected && (
            <>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleVerify}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
                >
                  Verify integrity
                </button>
                {TAMPER_FIELDS.map((f) => (
                  <button
                    key={f}
                    onClick={() => handleTamper(f)}
                    disabled={busy}
                    className="px-3 py-2 rounded-lg text-sm font-medium bg-rose-800 hover:bg-rose-700 disabled:opacity-50"
                  >
                    Tamper {f}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Walang sinisira sa totoong DB — in-memory lang ang tamper simulation.
              </p>

              {verifyResult && (
                <div
                  className="mt-4 rounded-lg p-4 border"
                  style={verifyResult.hashMatch
                    ? { background: 'rgba(5,46,26,0.6)', borderColor: '#15803d' }
                    : { background: 'rgba(59,10,10,0.6)', borderColor: '#b91c1c' }}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    {verifyResult.hashMatch
                      ? <><CircleCheck className="w-5 h-5 text-emerald-400" /> <span className="text-emerald-300">Hash match — VERIFIED</span></>
                      : <><CircleX className="w-5 h-5 text-rose-400" /> <span className="text-rose-300">Integrity FAILED</span></>}
                    <span className="ml-auto text-[11px] uppercase tracking-wide text-slate-400">
                      source: {verifyResult.source}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-slate-300">
                    {verifyResult.hashMatch
                      ? 'Tugma ang DB record sa naka-anchor na hash — hindi nabago.'
                      : `Hindi tugma (${verifyResult.reason}). May pagbabago sa record matapos ma-anchor.`}
                  </p>
                </div>
              )}

              {tamperResult && (
                <div className="mt-4 rounded-lg p-4 border" style={{ background: 'rgba(59,10,10,0.6)', borderColor: '#b91c1c' }}>
                  <div className="flex items-center gap-2 font-semibold text-rose-300">
                    <CircleX className="w-5 h-5 text-rose-400" /> Tampered (simulated) — mismatch
                  </div>
                  <p className="mt-1 text-[12px] text-slate-300">
                    Binago ang <b>{tamperResult.field}</b>: <code>{String(tamperResult.originalValue)}</code> → <code>{String(tamperResult.tamperedValue)}</code>.
                    Bagong hash ≠ on-chain hash → integrity check FAILS.
                  </p>
                  <div className="mt-2 font-mono text-[11px] text-slate-400">
                    on-chain: <HashChip value={tamperResult.originalHash} /><br />
                    tampered: <HashChip value={tamperResult.tamperedHash} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Section>

      {/* ③ Anchor details */}
      {selected && (
        <Section label="③ On-chain proof (anchor details)">
          <div className="rounded-xl bg-slate-900 border border-slate-700 p-4 font-mono text-[12px] text-slate-300 space-y-1">
            <div>canonicalHash : <HashChip value={status?.canonicalHash} /></div>
            <div>txId          : {status?.txId ?? '—'} · block #{status?.blockNumber ?? '—'}</div>
            <div>anchoredAt    : {status?.anchoredAt ? new Date(status.anchoredAt).toLocaleString('en-PH') : '—'}</div>
            <div>last check    : {status?.lastCheckPassed == null ? '—' : status.lastCheckPassed ? '✅ passed' : '❌ failed'}</div>
          </div>
        </Section>
      )}

      {/* ④ Scope vs Limitations */}
      <Section label="④ Scope vs Limitations">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl p-4" style={{ background: 'rgba(5,46,26,0.5)' }}>
            <p className="font-semibold text-emerald-300 mb-2">GINAGAWA</p>
            <ul className="list-disc ml-5 space-y-1 text-[13px] text-emerald-100/90">
              {SCOPE_DOES.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
          <div className="rounded-xl p-4" style={{ background: 'rgba(59,10,10,0.5)' }}>
            <p className="font-semibold text-rose-300 mb-2">HINDI GINAGAWA</p>
            <ul className="list-disc ml-5 space-y-1 text-[13px] text-rose-100/90">
              {SCOPE_DOESNT.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
        </div>
      </Section>

      {/* ⑤ Defensible Q&A */}
      <Section label="⑤ Defensible Q&A">
        <div className="space-y-2">
          {QA.map(({ q, a }) => (
            <details key={q} className="rounded-lg bg-slate-800/60 border border-slate-700 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-100">{q}</summary>
              <p className="mt-2 text-[13px] text-slate-300">{a}</p>
            </details>
          ))}
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Verify it lints**

Run: `cd frontend && npm run lint`
Expected: no new errors for `BlockchainPage.jsx`. (If `CircleCheck`/`CircleX` are not exported by the installed `lucide-react`, substitute `CheckCircle2` / `XCircle` and re-run.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/superadmin/BlockchainPage.jsx
git commit -m "feat(frontend): add super-admin blockchain integrity demo page"
```

---

## Task 7: Wire the route and nav item

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/layout/Sidebar.jsx`

- [ ] **Step 1: Add the import and route in `App.jsx`**

Add the import alongside the other SuperAdmin page imports (near line 12-14):

```jsx
import BlockchainPage       from './pages/superadmin/BlockchainPage';
```

Add the route inside the `/superadmin/*` nested `<Routes>` block, after the `audit-logs` route:

```jsx
                  <Route path="blockchain" element={<BlockchainPage />} />
```

- [ ] **Step 2: Add the nav item in `Sidebar.jsx`**

Add `ShieldCheck` to the lucide-react import (top of file):

```jsx
import {
  LayoutDashboard, Users, FileText, ClipboardList,
  LogOut, Settings, Printer, FileBarChart, ShieldCheck,
} from 'lucide-react';
```

In `getNavSections`, in the `SUPERADMIN` branch, add a Blockchain item to the **System** section:

```jsx
    { label: 'System', items: [
      { icon: Users,         label: 'Manage Admins', path: '/superadmin/users' },
      { icon: ClipboardList, label: 'Activity History', path: '/superadmin/audit-logs' },
      { icon: ShieldCheck,   label: 'Blockchain', path: '/superadmin/blockchain' },
    ]},
```

(If `ShieldCheck` is not exported by the installed `lucide-react`, use `Link` instead and import that.)

- [ ] **Step 3: Verify it lints and builds**

Run: `cd frontend && npm run lint && npm run build`
Expected: lint passes; build succeeds.

- [ ] **Step 4: Manual verification (defense rehearsal)**

Start backend (`cd backend && FABRIC_ENABLED=false npm run dev`) and frontend (`cd frontend && npm run dev`). Then:
1. Log in as super admin → sidebar shows **Blockchain** under System → click it → page loads at `/superadmin/blockchain`.
2. Badge shows **Offline — showing cached data** (because `FABRIC_ENABLED=false`).
3. If there are anchored records (run the demo seed if needed), select one → anchor details populate; **Verify integrity** shows ✅ with `source: cached`; **Tamper birthDate** shows ❌ mismatch with two different hashes.
4. Log in as a non-super-admin → `/superadmin/blockchain` is not reachable (redirected) and the API returns 403.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/layout/Sidebar.jsx
git commit -m "feat(frontend): route + sidebar nav for blockchain page"
```

---

## Definition of Done

- All `backend/tests/integration/blockchainPage.test.js` tests pass; existing `verify.test.js` still passes.
- `/superadmin/blockchain` reachable only by super admins (UI redirect + API 403 for others).
- Page renders all five sections; Verify and Tamper work with `FABRIC_ENABLED=false` (cached path) and the tamper simulation never mutates the DB.
- `npm run lint` and `npm run build` succeed on the frontend.
