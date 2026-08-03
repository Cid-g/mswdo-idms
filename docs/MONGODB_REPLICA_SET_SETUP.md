# MongoDB Replica Set — Setup Guide

**Required by:** [Phase 1 — Durable Blockchain Operations](superpowers/specs/2026-08-03-blockchain-durability-design.md) §3.2
**Applies to:** every machine that runs the backend — development **and** the presentation device

---

## 1. Why this is needed

When staff revokes an ID, two writes must happen together:

1. `IDRecord.status = 'REVOKED'` in MongoDB
2. A row in the outbox saying "send this to Fabric and to the cloud verifier"

If the process dies between them — power cut, crash, closed terminal — the result is a record
marked `REVOKED` locally with **no queued intent**. Nothing will ever push it to the ledger or
the cloud, so the cancelled ID keeps reading VALID to anyone scanning it. That is the exact
defect Phase 1 exists to eliminate, so reintroducing it through a non-atomic write would
defeat the whole design.

A **MongoDB transaction** makes both writes succeed or both fail. There is no half-completed
state to recover from.

MongoDB only supports multi-document transactions on a **replica set**. A standalone server
rejects them.

> **A single-node replica set is enough.** This does not require multiple servers or extra
> hardware. It is one `mongod` — the same one already installed — with replication enabled.
> The name is misleading: think of it as "transaction support switched on."

---

## 2. Current state of this project's machines

Detected on the development laptop, 2026-08-03:

| | |
|---|---|
| Install | MongoDB Community Server 8.2 (Windows `.msi`) |
| Runs as | Windows service named `MongoDB` (Automatic start) |
| Config | `C:\Program Files\MongoDB\Server\8.2\bin\mongod.cfg` |
| Data path | `C:\Program Files\MongoDB\Server\8.2\data` |
| Port | 27017, bound to 127.0.0.1 |
| Replication | **Not enabled** — `#replication:` is commented out |

Adjust paths below if the presentation device uses a different MongoDB version.

---

## 3. Setup steps (Windows service install)

Takes about five minutes. **Existing data is preserved** — this changes configuration, not
storage.

### Step 1 — Back up the data directory first

Non-negotiable. If anything goes wrong, this is the way back.

```powershell
Stop-Service MongoDB
Copy-Item -Recurse "C:\Program Files\MongoDB\Server\8.2\data" "$env:USERPROFILE\mongo-backup-$(Get-Date -Format yyyyMMdd)"
```

### Step 2 — Enable replication in the config

Edit `C:\Program Files\MongoDB\Server\8.2\bin\mongod.cfg` **as Administrator** (it is under
`Program Files`). Find this line:

```yaml
#replication:
```

Replace it with:

```yaml
replication:
  replSetName: rs0
```

Indentation matters — YAML. Two spaces before `replSetName`, and no tab characters.

### Step 3 — Restart the service

```powershell
Start-Service MongoDB
Get-Service MongoDB     # Status should be Running
```

If it fails to start, the config file is almost certainly malformed. Check
`C:\Program Files\MongoDB\Server\8.2\log\mongod.log` — the last lines name the problem.

### Step 4 — Initialise the replica set (once per machine)

```powershell
mongosh --eval "rs.initiate()"
```

Expected: `{ ok: 1 }`.

If it says `already initialized`, the machine is already set up — nothing more to do.

If `mongosh` is not recognised, it installs separately from the server. Either install
MongoDB Shell, or use the full path to `mongosh.exe`.

### Step 5 — Verify transactions actually work

The real test. Not "did the service start" but "can it do the thing we need."

```powershell
mongosh --quiet --eval "const s = db.getMongo().startSession(); s.startTransaction(); s.getDatabase('test').t.insertOne({ok:1}); s.commitTransaction(); print('TRANSACTIONS WORKING');"
```

Printing `TRANSACTIONS WORKING` means the setup is complete. Any error means it is not —
do not proceed to run the backend until this passes.

Clean up the test document:

```powershell
mongosh --quiet --eval "db.getSiblingDB('test').t.deleteMany({ok:1})"
```

---

## 4. Connection string

The existing `MONGODB_URI` in `backend/.env` keeps working:

```
MONGODB_URI=mongodb://localhost:27017/mswdo_idms
```

The driver discovers the replica set automatically. Adding `?replicaSet=rs0` is optional and
only worth doing if connection issues appear.

---

## 5. Presentation device checklist

**This is the step most likely to be forgotten, and it fails loudly at the worst moment.**

If the backend runs on a different machine during the defense, that machine needs the same
setup. Without it, Phase 1 transactions throw and **the backend will not start.**

Before the defense, on the presentation device:

- [ ] MongoDB installed
- [ ] `replication: replSetName: rs0` present in `mongod.cfg`
- [ ] Service restarted and Running
- [ ] `rs.initiate()` run once
- [ ] **Step 5 verification passed** — `TRANSACTIONS WORKING`
- [ ] Backend starts without errors
- [ ] One end-to-end revoke tested

Do this days in advance, not on the morning of.

---

## 6. Troubleshooting

**Service will not start after the config edit.**
YAML formatting. Check `mongod.log` for the parse error. Common causes: a tab character
instead of spaces, or wrong indentation depth. Restore the backup from Step 1 if needed.

**`rs.initiate()` returns "already initialized".**
Already done. Harmless.

**Backend errors with "Transaction numbers are only allowed on a replica set member".**
The config change did not take effect. Confirm the service actually restarted, and that you
edited the config file the service uses — check with:

```powershell
(Get-CimInstance Win32_Service -Filter "Name='MongoDB'").PathName
```

**`mongosh` not recognised.**
The shell ships separately from the server since MongoDB 6. Install MongoDB Shell, or call
`mongosh.exe` by full path.

---

## 7. Rollback

To undo: comment `replication:` back out in `mongod.cfg` and restart the service. Data is
unaffected.

Note that Phase 1 will not function afterwards — the design deliberately refuses to fall back
to two independent writes, because doing so silently would recreate the defect it exists to
fix.
