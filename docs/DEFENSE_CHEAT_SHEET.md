# 🎓 THESIS DEFENSE CHEAT SHEET — MSWDO IDMS

**Title:** Secure Municipal ID Issuance and QR-Based Verification System Using Hyperledger Fabric Blockchain
**Author:** Larsen B. Dignos · NEUST MSIT (System Development)
**Client:** MSWDO — Gerona, Tarlac

> Anticipated panel questions + model answers, grounded in the actual code.
> Mix of English/Filipino — sagutin sa wikang komportable ka. Be honest about scope; declare limitations BEFORE the panel finds them.

---

## 1. THE 30-SECOND PITCH

A web-based system that lets MSWDO issue IDs for **3 departments** (PWD, Solo Parent, Senior Citizen), replacing manual Photoshop ID-making. It generates IDs from configurable templates, produces a **QR code for public verification**, and **anchors a tamper-proof hash of each ID on a Hyperledger Fabric blockchain** so any later tampering of the record can be detected. Personal data stays in MongoDB; only a hash + minimal metadata goes on-chain.

---

## 2. ⛓️ BLOCKCHAIN — THE HEAVY SECTION (expect the most questions here)

### Q: "Ano ba talaga ang halaga ng blockchain dito? Bakit kailangan?"
**Answer — 3 concrete values:**
1. **Tamper-evidence independent of the app.** At ID completion, the system computes a SHA-256 hash of the ID's canonical identity fields and stores it on-chain. Anytime later, `checkIntegrity()` recomputes the hash from the current MongoDB record and compares it to the on-chain hash. If someone edited the database record, the hashes won't match → **tampering detected.**
2. **Immutable, append-only history.** Every issue/revoke event is recorded on-chain with a timestamp and transaction ID (`getIDHistory`). No one can silently rewrite the trail.
3. **Decentralized trust for inter-office/LGU scale.** Records are replicated across organizations (Org1 + Org2) — no single administrator can unilaterally alter history.

### Q: "Bakit hindi na lang hash column sa database? Mas simple." ⭐ (THE killer follow-up)
**Answer:** "If the hash lives in the same database as the record, a database administrator (or an attacker with DB access) can edit **both** the record **and** its hash column at the same time — and no one would ever know. The on-chain hash is stored **outside** the application's database, is **append-only**, and is **replicated across multiple organizations**. To forge it, you'd have to compromise the consensus of all peers simultaneously, which is the whole security premise of a blockchain. That independence is the value a DB column cannot provide."

### Q: "Bakit Hyperledger Fabric, hindi Bitcoin o Ethereum?"
**Answer:**
- **Permissioned, not public** — validators are known government offices, not anonymous miners.
- **No cryptocurrency / no gas fees** — sustainable for an LGU budget.
- **Privacy** — government data never touches a public network.
- **Performance & finality** — transactions commit deterministically, no probabilistic confirmation.

### Q: "Anong data ang nasa blockchain? Hindi ba paglabag sa Data Privacy Act (RA 10173)?" ⭐
**Answer:** "**No personal data is stored on-chain — that is by design, precisely to comply with RA 10173.** On-chain we store only: a SHA-256 hash (one-way, irreversible), the ID number/reference, ID type, status (ACTIVE/REVOKED/EXPIRED), issuing office, and timestamps. All personal data — full name, address, photo, signature, disability/solo-parent/senior details — stays **off-chain** in MongoDB. A hash cannot be reversed back into personal data."

### Q: "Eh kung papalitan ko ang LARAWAN o ADDRESS sa ID, made-detect ba ng blockchain mo?" ⭐⭐ (sharpest attack — be ready)
**Answer (declare the limitation, then frame it):**
"Honest answer: **no, not in the current scope.** The canonical hash covers the **core identity fields** — last name, first name, middle name, birthdate, sex, ID number, ID type, issuing office, and issued/expiry dates. It does **not** include the photo or address. So tampering with the photo would not be caught by the integrity check today.

This is a **documented limitation and clear future work**: the design can be extended to also hash the photo file (e.g., include the SHA-256 of the image in the canonical snapshot). I focused the thesis scope on the identity fields because those are the primary basis of who the ID belongs to, and they're what a fraudulent reissue would most likely alter. The architecture already supports adding more fields to the hash — it's an additive change."

> 💡 Saying this yourself first is far stronger than being caught. It shows you understand your system's boundaries.

### Q: "Paano kung bumagsak ang Fabric network o walang internet sa demo?" ⭐ (your strongest point)
**Answer:** "The system has a `FABRIC_ENABLED` flag. When the blockchain is unavailable, **the entire core system still works** — encoding, ID generation, printing, releasing, QR verification — and the blockchain status simply shows 'Pending Anchor', which is a valid state. Every blockchain call is also wrapped in a non-fatal `.catch()`, so a Fabric failure never breaks ID issuance. This makes the system resilient and safe to demo even on a borrowed device without Docker."

### Q: "Idemonstra mo na ang blockchain." 
- On your dev laptop (Fabric running, `FABRIC_ENABLED=true`): show an ID, click **Verify Integrity** → ✅ hash matches. Then manually edit the applicant's name in MongoDB → Verify again → ❌ **HASH MISMATCH** (this is the money shot — it proves tamper-detection).
- Have a **screen recording** of this as backup in case the live network misbehaves.

### Chaincode functions (memorize these 5):
`issueID` (anchor new), `verifyID` (read hash), `revokeID` (mark revoked), `getIDHistory` (full audit trail), `expireID` (mark expired). All in `blockchain/chaincode/id-contract.js`.

### ⚠️ One technical caveat to know (in case they probe deep):
The canonical hash depends on consistent JSON key order. It's built in fixed **alphabetical** order and **must never be reordered** after deployment, or existing integrity checks would break. There's a warning comment in the code. (Safer long-term: explicit sorted serialization — minor future improvement.)

---

## 3. 🔄 WORKFLOW — WHY IT'S DESIGNED THIS WAY

### Q: "Bakit hati sa dalawa ang encoding (Quick Encode tapos Complete Profile)?" ⭐
**Answer:** "Speed of public service. During interviews there's a queue of senior citizens and PWDs. The **Quick Encode** captures only the minimum fields needed to print the ID (name, birthdate, barangay, photo, signature, plus a few dept-specific ones), so the citizen gets their ID immediately. The remaining 20–30 profile fields are filled in **after the queue clears** (Complete Profile). The record is `PARTIAL` until complete, then auto-promotes to `COMPLETE`, which triggers blockchain anchoring. This mirrors how the office actually operates."

### Q: "Kailan nag-aanchor sa blockchain?"
**Answer:** "Automatically, on the backend, when an applicant's status goes PARTIAL → COMPLETE **and** an ACTIVE ID record exists. If the profile happens to be completed before the ID is generated, the ID-generation step anchors immediately instead. There's also a manual 'Anchor Now' button as a fallback. It only runs when `FABRIC_ENABLED=true`, and it's non-fatal."

### Q: "Paano ang ID expiry? May cron job ba?"
**Answer:** "No scheduler needed. Expiry is evaluated **lazily at verification time** — when a QR is scanned, the backend compares the expiry date to today and reports EXPIRED if past due. PWD = 5 years, Solo Parent = 2 years, Senior Citizen = lifetime (no expiry). The chaincode has an `expireID` function ready if a scheduled on-chain stamp is added later."

### Q: "Paano kung mawala/masira ang ID? May replacement ba?"
**Answer:** "Yes. Revocation is **card-level**: revoking marks the ID record REVOKED (and updates the chain), but the applicant record stays editable. A new replacement ID can then be issued. The database enforces only **one ACTIVE ID per applicant** at a time via a partial unique index — revoked IDs don't block a reissue."

### Status lifecycle (memorize):
`PARTIAL → COMPLETE` (applicant) · `ACTIVE → REVOKED / EXPIRED` (ID card) · anchor fires on COMPLETE.

---

## 4. 🔐 SECURITY & PRIVACY

### Q: "Paano mo pinoprotektahan ang system?"
- **Authentication:** JWT access token (15 min) + refresh token (7 days) **with rotation** on every use; bcrypt password hashing (cost 12).
- **Authorization (RBAC):** every API route checks role; staff/admin are **scoped to their own department** — a PWD encoder cannot read another department's records (enforced on applicants AND id-records, including the ID image endpoints).
- **Rate limiting:** 10 login attempts/min, 30 refresh/min.
- **Audit log:** every state-changing action is logged (user, action, IP, timestamp) — non-blocking so it never breaks the main flow.
- **Public QR endpoint:** exposes only masked name (e.g., "J*** D***"), ID type, status, expiry — **never** address, contact, or photo.
- **File access:** path-traversal protection; personal files (photos/signatures/IDs) require authentication; only templates/avatars are public.

### Q: "Login roles?"
SuperAdmin (system-wide, manages 3 dept admins) → Admin (per dept, manages staff + templates) → Encoder / Releasing Staff (encode + generate IDs; same permissions, different real-world role).

---

## 5. 🧪 TESTING

### Q: "Paano mo na-test?"
**Answer:** "Automated tests with Jest + Supertest + an in-memory MongoDB. Coverage: chaincode unit tests (issue/verify/revoke/expire/history), auth integration, applicant CRUD + RBAC, ID-record validation, public verification, and a dedicated security suite (401 no-token, 403 wrong-role, tampered token, public-route access)."

> ⚠️ **Run `npm test` in WSL2 and screenshot the green result for the defense.** The integration suite uses the `sharp` image library, whose native binary is built for Linux — so the full suite runs in **WSL2**, not on Windows directly. The chaincode unit tests run anywhere. If asked why not on Windows: "platform-native image binary — it's an environment detail, not a code issue."

### Honest test gaps (if pressed):
No automated test yet for reissue-after-revoke or cross-department access — those paths were hardened during review and are good candidates for added regression tests.

---

## 6. 🏗️ TECH STACK (one-liners)

- **Frontend:** React 18 + Vite + Tailwind v4, Zustand (auth), React Query (server state), React Hook Form + Zod.
- **Backend:** Node.js + Express, MongoDB + Mongoose, JWT, Multer, `@napi-rs/canvas` (server-side ID rendering), `qrcode`, `sharp` (image processing).
- **Blockchain:** Hyperledger Fabric 2.5, `@hyperledger/fabric-gateway`, JavaScript chaincode.
- **Why MongoDB?** Flexible schema — government field requirements differ per department and evolve over time.
- **Why server-side ID rendering?** Consistent output regardless of the staff's browser/device.

---

## 7. 📌 KNOWN LIMITATIONS / FUTURE WORK (say these proactively)

1. Blockchain hash covers identity fields only — **photo/address integrity = future work.**
2. No scheduled auto-retry for failed anchors — manual "Anchor Now" today.
3. No automated on-chain expiry job — expiry is computed at verification time.
4. Public verification app deploys separately to the cloud for production; demo uses localhost.
5. Tokens stored client-side — acceptable for an internal LGU tool; httpOnly cookies are a hardening option.
6. User Acceptance Testing with MSWDO staff + ISO/IEC 25010 evaluation are the remaining thesis steps.

---

## 8. 🎯 IF YOU REMEMBER ONLY 3 THINGS

1. **"Blockchain = tamper-evidence the database alone can't provide, because the hash lives outside the DB and is replicated."**
2. **"No personal data on-chain — only a one-way hash. RA 10173 compliant by design."**
3. **"The hash covers identity fields, not the photo — that's a documented limitation and future work."**

*Good luck, Cedrick. Kaya mo 'to. 🇵🇭*
