# BLOCKCHAIN SPECIFICATION — MSWDO ID Management System

**Platform:** Hyperledger Fabric 2.5  
**SDK:** `@hyperledger/fabric-gateway`  
**Chaincode Language:** JavaScript (Node.js)  
**Network:** 2 orgs, 1 orderer, 3 Certificate Authorities  

---

## Core Principle

> **Blockchain is NOT the database.** It only stores a SHA-256 hash of the ID record + minimal metadata.  
> Full personal data stays in MongoDB (off-chain).  
> Purpose: tamper detection, auditability, append-only history.

---

## What Goes On-Chain vs Off-Chain

| Data | On-Chain | Off-Chain (MongoDB) |
|------|----------|------------------------|
| SHA-256 hash of canonical record | ✅ | - |
| Record reference number | ✅ | ✅ |
| ID status (ACTIVE/REVOKED/EXPIRED) | ✅ | ✅ |
| Timestamp, TX ID | ✅ | - |
| Issuing office | ✅ | ✅ |
| Full name, address, contact | ❌ | ✅ |
| Photo, signature files | ❌ | ✅ (filesystem) |
| Document uploads | ❌ | ✅ (filesystem) |
| ID image | ❌ | ✅ (filesystem) |
| Disability/solo parent/senior details | ❌ | ✅ |

---

## Canonical Record Snapshot

Before hashing, a **canonical snapshot** is constructed deterministically.
Keys are in **alphabetical order** (V8/Node preserves insertion order for string keys).
**Never reorder or rename these fields after first deployment** — any change breaks existing integrity checks.

```js
// services/blockchain.js — normalizeSex helper
function normalizeSex(value) {
  if (!value) return '';
  const v = value.trim().toUpperCase();
  if (v === 'M' || v === 'MALE')   return 'Male';
  if (v === 'F' || v === 'FEMALE') return 'Female';
  return value;
}

// Canonical snapshot — alphabetical key order, deterministic formatting
function buildCanonicalSnapshot(applicant, idRecord) {
  const soloParentIdType = applicant.soloParent?.categoryCode ?? null;
  const snapshot = {
    birthDate:       new Date(applicant.birthdate).toISOString().split('T')[0],  // YYYY-MM-DD
    expiryDate:      idRecord.expiryDate                                          // null for Senior Citizen
                       ? new Date(idRecord.expiryDate).toISOString().split('T')[0]
                       : null,
    firstName:       applicant.firstName.trim().toUpperCase(),
    idType:          applicant.department,          // "PWD" | "SOLO_PARENT" | "SENIOR_CITIZEN"
    issuedDate:      new Date(idRecord.issuedDate).toISOString().split('T')[0],
    issuingOffice:   'MSWDO-GERONA-TARLAC',
    lastName:        applicant.lastName.trim().toUpperCase(),
    middleName:      applicant.middleName?.trim().toUpperCase() ?? '',
    recordRef:       idRecord.idNumber,
    sex:             normalizeSex(applicant.sex),   // always 'Male' or 'Female'
    soloParentIdType,                               // categoryCode (a1–a7, b–f) or null
  };
  return JSON.stringify(snapshot);
}
```

Then hash it:
```js
const crypto = require('crypto');
const canonical = buildCanonicalSnapshot(applicant, idRecord);
const hash = crypto.createHash('sha256').update(canonical).digest('hex');
```

> ⚠️ **IMPORTANT:** The canonical snapshot must be built identically every time.
> - Names are trimmed and uppercased
> - Dates are ISO `YYYY-MM-DD` format
> - `expiryDate` is `null` for Senior Citizens (no expiry)
> - `sex` is normalized to `'Male'` or `'Female'` regardless of stored form
> - Key order is fixed alphabetically — do not reorder after deployment

---

## Network Setup

### Docker Containers

| Container | Image | Ports | Role |
|-----------|-------|-------|------|
| `peer0.org1` | `fabric-peer:2.5` | 7051, 9444 | Stores ledger, endorses TXs |
| `peer0.org2` | `fabric-peer:2.5` | 9051, 9445 | Validates TXs, maintains copy |
| `orderer` | `fabric-orderer:2.5` | 7050, 7053, 9443 | Sequences TXs into blocks |
| `ca_org1` | `fabric-ca:1.5` | 7054 | Issues X.509 certs for Org1 |
| `ca_org2` | `fabric-ca:1.5` | 8054 | Issues X.509 certs for Org2 |
| `ca_orderer` | `fabric-ca:1.5` | 9054 | Issues X.509 certs for orderer |
| `chaincode` | `fabric-nodeenv:2.5` | dynamic | Runs id-contract.js |

### Network Startup Order
```bash
# 1. Start network
cd fabric-samples/test-network
./network.sh up createChannel -ca

# 2. Deploy chaincode
./network.sh deployCC -ccn id-contract -ccp ../../blockchain/chaincode -ccl javascript

# 3. Enroll admin user (generates .env for backend)
cd ../../backend
./scripts/enroll-admin.sh

# 4. Start backend
npm start

# 5. Start frontend
cd ../frontend
npm run dev
```

---

## Chaincode: `id-contract.js`

### Full Implementation

```javascript
'use strict';

const { Contract } = require('fabric-contract-api');
const crypto = require('crypto');

class IDContract extends Contract {

  // ─────────────────────────────────────────────
  // Issue a new ID (write — requires consensus)
  // ─────────────────────────────────────────────
  async issueID(ctx, recordRef, idType, soloParentIdType, hash, issuingOffice) {
    // Check for duplicate
    const existing = await ctx.stub.getState(recordRef);
    if (existing && existing.length > 0) {
      throw new Error(`ID record ${recordRef} already exists on chain`);
    }

    const record = {
      recordRef,
      idType,
      soloParentIdType: soloParentIdType || null,
      hash,
      status: 'ACTIVE',
      issuingOffice,
      issuedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };

    await ctx.stub.putState(recordRef, Buffer.from(JSON.stringify(record)));

    // Emit event
    ctx.stub.setEvent('IDIssued', Buffer.from(JSON.stringify({ recordRef, idType })));

    return JSON.stringify(record);
  }

  // ─────────────────────────────────────────────
  // Verify an ID (read — no consensus needed)
  // ─────────────────────────────────────────────
  async verifyID(ctx, recordRef) {
    const data = await ctx.stub.getState(recordRef);
    if (!data || data.length === 0) {
      return JSON.stringify({ found: false, recordRef });
    }
    const record = JSON.parse(data.toString());
    return JSON.stringify({ found: true, ...record });
  }

  // ─────────────────────────────────────────────
  // Revoke an ID (write)
  // ─────────────────────────────────────────────
  async revokeID(ctx, recordRef, reason) {
    const data = await ctx.stub.getState(recordRef);
    if (!data || data.length === 0) {
      throw new Error(`ID record ${recordRef} not found on chain`);
    }

    const record = JSON.parse(data.toString());
    record.status = 'REVOKED';
    record.revokedAt = new Date().toISOString();
    record.revokedReason = reason;
    record.lastUpdatedAt = new Date().toISOString();

    await ctx.stub.putState(recordRef, Buffer.from(JSON.stringify(record)));

    ctx.stub.setEvent('IDRevoked', Buffer.from(JSON.stringify({ recordRef, reason })));

    return JSON.stringify(record);
  }

  // ─────────────────────────────────────────────
  // Get full history of a record (read)
  // ─────────────────────────────────────────────
  async getIDHistory(ctx, recordRef) {
    const iterator = await ctx.stub.getHistoryForKey(recordRef);
    const history = [];

    let result = await iterator.next();
    while (!result.done) {
      const { txId, timestamp, isDelete, value } = result.value;
      history.push({
        txId,
        timestamp: new Date(timestamp.seconds.low * 1000).toISOString(),
        isDelete,
        record: value ? JSON.parse(value.toString()) : null,
      });
      result = await iterator.next();
    }
    await iterator.close();

    return JSON.stringify(history);
  }

  // ─────────────────────────────────────────────
  // Mark ID as expired (write — can be called by system job)
  // ─────────────────────────────────────────────
  async expireID(ctx, recordRef) {
    const data = await ctx.stub.getState(recordRef);
    if (!data || data.length === 0) {
      throw new Error(`ID record ${recordRef} not found on chain`);
    }

    const record = JSON.parse(data.toString());
    if (record.status === 'REVOKED') {
      throw new Error(`Cannot expire a revoked record`);
    }

    record.status = 'EXPIRED';
    record.expiredAt = new Date().toISOString();
    record.lastUpdatedAt = new Date().toISOString();

    await ctx.stub.putState(recordRef, Buffer.from(JSON.stringify(record)));
    return JSON.stringify(record);
  }
}

module.exports = IDContract;
```

---

## Backend: `fabric/connect.js`

```javascript
const { connect, hash } = require('@hyperledger/fabric-gateway');
const grpc = require('@grpc/grpc-js');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CHANNEL_NAME = 'mychannel';
const CHAINCODE_NAME = 'id-contract';

let gateway = null;
let client = null;

async function connectToFabric() {
  const tlsCert = fs.readFileSync(process.env.FABRIC_TLS_CERT_PATH);
  const credentials = grpc.credentials.createSsl(tlsCert);

  client = new grpc.Client(
    `${process.env.FABRIC_PEER_HOST}:${process.env.FABRIC_PEER_PORT}`,
    credentials,
    { 'grpc.ssl_target_name_override': process.env.FABRIC_PEER_NAME }
  );

  const privateKey = crypto.createPrivateKey(
    fs.readFileSync(process.env.FABRIC_PRIVATE_KEY_PATH)
  );
  const certificate = fs.readFileSync(process.env.FABRIC_CERT_PATH).toString();
  const mspId = process.env.FABRIC_MSP_ID;

  gateway = connect({
    client,
    identity: { mspId, credentials: Buffer.from(certificate) },
    signer: {
      sign: (digest) => crypto.sign(undefined, digest, privateKey)
    },
    hash: hash.sha256,
  });

  return gateway;
}

function getContract() {
  if (!gateway) throw new Error('Fabric gateway not initialized');
  const network = gateway.getNetwork(CHANNEL_NAME);
  return network.getContract(CHAINCODE_NAME);
}

async function disconnectFromFabric() {
  if (gateway) { gateway.close(); gateway = null; }
  if (client) { client.close(); client = null; }
}

module.exports = { connectToFabric, getContract, disconnectFromFabric };
```

---

## Backend: `services/blockchain.js`

See actual implementation at `backend/src/services/blockchain.js`.

Key exported functions:

| Function | Type | Description |
|---|---|---|
| `computeHash(applicant, idRecord)` | sync | Returns `{ hash, canonical }` |
| `anchorIDOnChain(applicant, idRecord)` | async | Submit `issueID` TX, save BlockchainAnchor |
| `verifyIDOnChain(idNumber)` | async | Call `verifyID` chaincode (read-only) |
| `revokeIDOnChain(idNumber, reason)` | async | Submit `revokeID` TX |
| `checkIntegrity(applicant, idRecord)` | async | Recompute hash and compare with ledger |

`checkIntegrity` returns:
```js
{ verified: true,  onChainStatus: 'ACTIVE' }                    // hash matches
{ verified: false, reason: 'HASH_MISMATCH', ... }               // tampered
{ verified: false, reason: 'NOT_ON_CHAIN' }                     // not yet anchored
```

---

## When Anchoring is Triggered

| Event | Blockchain Action |
|-------|------------------|
| Applicant record becomes COMPLETE | `issueID` — anchor hash |
| Admin revokes an ID | `revokeID` — update status |
| (Future) ID expires | `expireID` — update status |
| Staff/Admin clicks "Verify Integrity" | `verifyID` — read + compare hash |

**Note:** PARTIAL records (quick-encode for same-day ID) are NOT anchored on-chain until the record is COMPLETE. The ID is issued and released, but blockchain anchoring is deferred until full data is encoded.

---

## Environment Variables for Backend (`.env`)

```env
# Fabric
FABRIC_PEER_HOST=localhost
FABRIC_PEER_PORT=7051
FABRIC_PEER_NAME=peer0.org1.example.com
FABRIC_MSP_ID=Org1MSP
FABRIC_TLS_CERT_PATH=../fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
FABRIC_CERT_PATH=../fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/signcerts/User1@org1.example.com-cert.pem
FABRIC_PRIVATE_KEY_PATH=../fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/keystore/priv_sk
```

---

## Public Verification Page

Deployed separately (cloud — Vercel/Railway).

```
GET https://verify.mswdo-gerona.gov.ph/check?token=<uuid-v4>

Flow:
1. Token lookup → find IDRecord by qrToken
2. Fetch applicant from MongoDB
3. Compute current canonical hash
4. Compare with on-chain hash (call verifyID chaincode)
5. Return: status, name (masked), idType, expiry, integrityResult
```

The public verification backend needs READ access to MongoDB and READ access to Fabric network (evaluateTransaction only — no writes).

---

## Chaincode Testing

Test chaincode locally with Fabric's mock stub:

```javascript
// blockchain/chaincode/id-contract.test.js
const { ChaincodeMockStub } = require('@theledger/fabric-mock-stub');
const IDContract = require('./id-contract');

// Test issueID, verifyID, revokeID, getIDHistory
```

---

*See MASTER_PLAN.md for overview | See API_SPEC.md for backend endpoints*
