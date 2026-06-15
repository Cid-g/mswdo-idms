import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, CheckCircle2, XCircle, ArrowRight, Wifi, WifiOff } from 'lucide-react';
import {
  getBlockchainHealth,
  getAnchoredRecords,
  getBlockchainStatus,
  verifyIntegrity,
  simulateTamper,
} from '../../services/blockchainService';

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
  const { data: health } = useQuery({ queryKey: ['bc-health'], queryFn: getBlockchainHealth });
  const { data: anchors = [] } = useQuery({ queryKey: ['bc-anchors'], queryFn: getAnchoredRecords });

  const [selected, setSelected]         = useState('');     // idNumber
  const [verifyResult, setVerifyResult] = useState(null);
  const [tamperResult, setTamperResult] = useState(null);
  const [busy, setBusy]                 = useState(false);

  const connected = health?.connected ?? false;
  const selectedAnchor = anchors.find((a) => a.idNumber === selected);

  const { data: status } = useQuery({
    queryKey: ['bc-status', selectedAnchor?.idRecordId],
    queryFn:  () => getBlockchainStatus(selectedAnchor.idRecordId),
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
    try { setVerifyResult(await verifyIntegrity(selected)); }
    finally { setBusy(false); }
  }

  async function handleTamper(field) {
    if (!selected) return;
    setBusy(true); setVerifyResult(null);
    try { setTamperResult(await simulateTamper(selected, field)); }
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
              <div className="flex gap-2 mt-4 flex-wrap">
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
                      ? <><CheckCircle2 className="w-5 h-5 text-emerald-400" /> <span className="text-emerald-300">Hash match — VERIFIED</span></>
                      : <><XCircle className="w-5 h-5 text-rose-400" /> <span className="text-rose-300">Integrity FAILED</span></>}
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
                    <XCircle className="w-5 h-5 text-rose-400" /> Tampered (simulated) — mismatch
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
