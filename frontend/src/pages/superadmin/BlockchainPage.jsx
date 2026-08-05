import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  PauseCircle,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import {
  applyBlockchainReconciliation,
  getAnchoredRecords,
  getBlockchainHealth,
  getBlockchainStatus,
  getBlockchainSyncStatus,
  retryBlockchainOperation,
  scanBlockchainReconciliation,
  simulateTamper,
  verifyIntegrity,
} from '../../services/blockchainService';

const FLOW = [
  { icon: '📄', label: 'ID Record' },
  { icon: '🧮', label: 'Canonical fields' },
  { icon: '#️⃣', label: 'SHA-256 hash' },
  { icon: '⛓️', label: 'Anchored on-chain' },
  { icon: '✓', label: 'Verify' },
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
const RECONCILIATION_LABELS = {
  ledgerTerminalAhead: 'Ledger terminal state ahead',
  missingTerminalIntents: 'Missing terminal intents',
  missingAnchorIntents: 'Missing anchor intents',
  partialUnanchored: 'Intentionally unanchored partial IDs',
  staleAnchors: 'Stale anchor receipts',
  ledgerMissingKnownRecords: 'Known records missing from ledger',
};

function Section({ label, children }) {
  return (
    <section className="mb-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 mb-3">{label}</p>
      {children}
    </section>
  );
}

function HashChip({ value }) {
  if (!value) return <span className="text-slate-500">—</span>;
  const short = `${value.slice(0, 8)}…${value.slice(-6)}`;
  return <span className="font-mono text-[12px] text-slate-200" title={value}>{short}</span>;
}

function formatDuration(milliseconds) {
  if (milliseconds == null) return 'No waiting operations';
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function gatewayPresentation(health, isLoading) {
  if (isLoading && !health) {
    return {
      label: 'Reconnecting',
      detail: 'Checking the Fabric gateway and ledger state.',
      tone: 'warning',
      Icon: RefreshCw,
    };
  }
  if (!health?.fabricEnabled) {
    return {
      label: 'Disabled',
      detail: 'Blockchain execution is disabled. Durable intents remain queued.',
      tone: 'muted',
      Icon: WifiOff,
    };
  }
  if (health?.ledger?.paused) {
    return {
      label: 'Paused—ledger changed',
      detail: 'The genesis epoch changed. Workers are paused until explicit reconciliation.',
      tone: 'danger',
      Icon: PauseCircle,
    };
  }
  if (health?.connected && health?.ready) {
    return {
      label: 'Connected',
      detail: 'Fabric is connected and the accepted ledger epoch is active.',
      tone: 'success',
      Icon: Wifi,
    };
  }
  return {
    label: 'Reconnecting',
    detail: 'The backend is available, but Fabric is not ready yet. Queued work is preserved.',
    tone: 'warning',
    Icon: RefreshCw,
  };
}

const GATEWAY_TONES = {
  success: { bg: '#DCFCE7', border: '#BBF7D0', text: '#166534' },
  warning: { bg: '#FEF3C7', border: '#FDE68A', text: '#92400E' },
  danger: { bg: '#FEE2E2', border: '#FECACA', text: '#991B1B' },
  muted: { bg: '#F1F5F9', border: '#CBD5E1', text: '#475569' },
};

function CountCard({ label, count, detail }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 font-serif text-3xl text-slate-900">{count ?? 0}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

function buildProblemRows(syncStatus) {
  if (!syncStatus) return [];
  const rows = [];
  const seen = new Set();

  for (const item of syncStatus.failed ?? []) {
    seen.add(item.operationId);
    rows.push({ ...item, rowType: 'FAILED' });
  }
  for (const item of syncStatus.blocked ?? []) {
    if (seen.has(item.operationId)) continue;
    seen.add(item.operationId);
    rows.push({ ...item, rowType: 'BLOCKED' });
  }
  for (const item of syncStatus.alertedRevokes ?? []) {
    if (seen.has(item.operationId)) continue;
    seen.add(item.operationId);
    rows.push({ ...item, rowType: 'ALERTED_REVOKE' });
  }
  for (const item of syncStatus.unanchoredTerminalIds ?? []) {
    rows.push({
      ...item,
      operation: item.status,
      state: 'NOT_APPLICABLE',
      attempts: null,
      lastError: null,
      predecessor: null,
      operationId: null,
      rowType: 'NEVER_ANCHORED',
    });
  }
  return rows;
}

function stateText(row) {
  if (row.rowType === 'ALERTED_REVOKE') return 'Requires attention—retrying automatically';
  if (row.rowType === 'NEVER_ANCHORED') return 'Never entered the ledger';
  return row.state;
}

function ProblemTable({ rows, retryingId, onRetry }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
        No failed, blocked, alerted, or intentionally unanchored terminal records require review.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-[980px] w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-3 py-3 font-semibold uppercase tracking-wide">Record</th>
            <th className="px-3 py-3 font-semibold uppercase tracking-wide">Operation</th>
            <th className="px-3 py-3 font-semibold uppercase tracking-wide">State</th>
            <th className="px-3 py-3 font-semibold uppercase tracking-wide">Attempts</th>
            <th className="px-3 py-3 font-semibold uppercase tracking-wide">Last error</th>
            <th className="px-3 py-3 font-semibold uppercase tracking-wide">Predecessor</th>
            <th className="px-3 py-3 font-semibold uppercase tracking-wide">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const retryable = row.rowType === 'FAILED' || row.rowType === 'BLOCKED';
            return (
              <tr key={row.operationId ?? `unanchored:${row.idRecordId}`} className="align-top text-slate-700">
                <td className="px-3 py-3 font-mono text-[11px] text-slate-900">{row.recordRef}</td>
                <td className="px-3 py-3 font-semibold">{row.operation}</td>
                <td className="px-3 py-3 max-w-52">
                  <span className={row.rowType === 'ALERTED_REVOKE' ? 'font-semibold text-amber-700' : row.rowType === 'NEVER_ANCHORED' ? 'font-semibold text-slate-600' : 'font-semibold text-slate-800'}>
                    {stateText(row)}
                  </span>
                </td>
                <td className="px-3 py-3">{row.attempts ?? '—'}</td>
                <td className="px-3 py-3 max-w-72 whitespace-normal break-words text-slate-600">
                  {row.lastError || (row.rowType === 'NEVER_ANCHORED' ? 'This terminal card had no anchor prerequisite.' : '—')}
                </td>
                <td className="px-3 py-3 max-w-56 whitespace-normal break-words text-slate-600">
                  {row.predecessor
                    ? `${row.predecessor.operation} · ${row.predecessor.state}`
                    : '—'}
                </td>
                <td className="px-3 py-3">
                  {retryable ? (
                    <button
                      type="button"
                      onClick={() => onRetry(row.operationId)}
                      disabled={retryingId === row.operationId}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {retryingId === row.operationId ? 'Retrying…' : 'Retry'}
                    </button>
                  ) : (
                    <span className="text-slate-400">Automatic / not applicable</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReconciliationReport({ report }) {
  if (!report) return null;
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-slate-900">Latest read-only scan</p>
        <p className="font-mono text-[11px] text-slate-500">Generated {formatDateTime(report.generatedAt)}</p>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(RECONCILIATION_LABELS).map(([key, label]) => (
          <div key={key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">{report.counts?.[key] ?? 0}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">Observed epoch:</span>{' '}
        <span className="font-mono break-all">{report.ledger?.observedEpoch ?? 'Unavailable'}</span>
      </div>
    </div>
  );
}

export default function BlockchainPage() {
  const queryClient = useQueryClient();
  const healthQuery = useQuery({
    queryKey: ['bc-health'],
    queryFn: getBlockchainHealth,
    refetchInterval: 15_000,
  });
  const anchorsQuery = useQuery({ queryKey: ['bc-anchors'], queryFn: getAnchoredRecords });
  const syncQuery = useQuery({
    queryKey: ['bc-sync-status'],
    queryFn: getBlockchainSyncStatus,
    refetchInterval: 15_000,
  });

  const [selected, setSelected] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [tamperResult, setTamperResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [reconciliationReport, setReconciliationReport] = useState(null);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);

  const health = healthQuery.data;
  const anchors = anchorsQuery.data ?? [];
  const syncStatus = syncQuery.data;
  const gateway = gatewayPresentation(health, healthQuery.isLoading);
  const gatewayTone = GATEWAY_TONES[gateway.tone];
  const GatewayIcon = gateway.Icon;
  const selectedAnchor = anchors.find((anchor) => anchor.idNumber === selected);
  const problemRows = useMemo(() => buildProblemRows(syncStatus), [syncStatus]);

  const { data: status } = useQuery({
    queryKey: ['bc-status', selectedAnchor?.idRecordId],
    queryFn: () => getBlockchainStatus(selectedAnchor.idRecordId),
    enabled: Boolean(selectedAnchor),
  });

  const retryMutation = useMutation({
    mutationFn: retryBlockchainOperation,
    onMutate: () => setActionMessage(''),
    onSuccess: async (operation) => {
      setActionMessage(`${operation.operation} for ${operation.recordRef} was reset to ${operation.state}.`);
      await queryClient.invalidateQueries({ queryKey: ['bc-sync-status'] });
    },
    onError: (error) => {
      setActionMessage(error.response?.data?.error?.message || 'The operation could not be retried.');
    },
  });

  const scanMutation = useMutation({
    mutationFn: scanBlockchainReconciliation,
    onMutate: () => {
      setActionMessage('');
      setRecoveryConfirmed(false);
    },
    onSuccess: (report) => {
      setReconciliationReport(report);
      setActionMessage('Read-only reconciliation scan completed. Review the report before applying recovery.');
    },
    onError: (error) => {
      setReconciliationReport(null);
      setActionMessage(error.response?.data?.error?.message || 'Reconciliation scan failed.');
    },
  });

  const applyMutation = useMutation({
    mutationFn: () => applyBlockchainReconciliation(reconciliationReport.ledger.observedEpoch),
    onMutate: () => setActionMessage(''),
    onSuccess: async (result) => {
      setActionMessage(`Recovery applied. Accepted ledger epoch ${result.ledger.acceptedEpoch}.`);
      setRecoveryConfirmed(false);
      setReconciliationReport(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bc-health'] }),
        queryClient.invalidateQueries({ queryKey: ['bc-sync-status'] }),
        queryClient.invalidateQueries({ queryKey: ['bc-anchors'] }),
      ]);
    },
    onError: (error) => {
      setActionMessage(error.response?.data?.error?.message || 'Recovery could not be applied. Run a new scan and review the result.');
    },
  });

  function onSelect(idNumber) {
    setSelected(idNumber);
    setVerifyResult(null);
    setTamperResult(null);
  }

  async function handleVerify() {
    if (!selected) return;
    setBusy(true);
    setTamperResult(null);
    try {
      setVerifyResult(await verifyIntegrity(selected));
    } finally {
      setBusy(false);
    }
  }

  async function handleTamper(field) {
    if (!selected) return;
    setBusy(true);
    setVerifyResult(null);
    try {
      setTamperResult(await simulateTamper(selected, field));
    } finally {
      setBusy(false);
    }
  }

  const canApplyRecovery = Boolean(
    reconciliationReport?.ledger?.observedEpoch
    && recoveryConfirmed
    && !applyMutation.isPending
  );

  return (
    <div className="mx-auto max-w-6xl animate-fade-up text-slate-900">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-serif text-3xl text-slate-900">
            <ShieldCheck className="h-7 w-7 text-slate-600" /> Blockchain Integrity
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Tamper evidence, durable synchronization, and ledger recovery controls.
          </p>
        </div>
        <div
          className="flex max-w-md items-start gap-2 rounded-xl border px-3 py-2"
          style={{ background: gatewayTone.bg, borderColor: gatewayTone.border, color: gatewayTone.text }}
        >
          <GatewayIcon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${gateway.label === 'Reconnecting' ? 'animate-spin' : ''}`} />
          <div>
            <p className="text-xs font-semibold">Gateway: {gateway.label}</p>
            <p className="mt-0.5 text-xs opacity-90">{gateway.detail}</p>
          </div>
        </div>
      </div>

      <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5" style={{ boxShadow: 'var(--shadow-card)' }} aria-labelledby="sync-status-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="sync-status-heading" className="font-serif text-2xl text-slate-900">Blockchain Sync Status</h2>
            <p className="mt-1 text-sm text-slate-500">
              Queue health is separate from gateway availability. Queued does not mean anchored.
            </p>
          </div>
          <button
            type="button"
            onClick={() => Promise.all([healthQuery.refetch(), syncQuery.refetch(), anchorsQuery.refetch()])}
            disabled={healthQuery.isFetching || syncQuery.isFetching}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${healthQuery.isFetching || syncQuery.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {(healthQuery.isError || syncQuery.isError) && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            The operational status could not be loaded. This does not prove that Fabric is connected or that the queue is healthy.
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CountCard label="Pending" count={syncStatus?.counts?.PENDING} detail="Waiting for a worker claim" />
          <CountCard label="Processing" count={syncStatus?.counts?.PROCESSING} detail="Currently leased by a worker" />
          <CountCard label="Blocked" count={syncStatus?.counts?.BLOCKED} detail="Waiting for an earlier sequence" />
          <CountCard label="Failed" count={syncStatus?.counts?.FAILED} detail="Requires retry or reconciliation" />
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Oldest waiting operation: <span className="font-semibold text-slate-700">{formatDuration(syncStatus?.oldest?.ageMs)}</span>
          {syncStatus?.oldest && <> · {syncStatus.oldest.recordRef} · {syncStatus.oldest.operation}</>}
        </p>

        <div className="mt-5">
          <ProblemTable
            rows={problemRows}
            retryingId={retryMutation.isPending ? retryMutation.variables : null}
            onRetry={(operationId) => retryMutation.mutate(operationId)}
          />
        </div>

        <div className="mt-6 border-t border-slate-200 pt-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <h3 className="text-sm font-semibold text-slate-900">Ledger reconciliation</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Scan is read-only. Apply recovery can replay immutable operations or adopt terminal ledger state, so it requires a reviewed report and explicit confirmation.
              </p>
              {health?.ledger?.paused && (
                <p className="mt-2 text-xs font-semibold text-red-700">
                  Workers are paused because the observed ledger epoch differs from the accepted epoch. Run a scan; do not use a generic queue retry.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scanMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {scanMutation.isPending ? 'Scanning…' : 'Scan consistency'}
            </button>
          </div>

          <ReconciliationReport report={reconciliationReport} />

          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <label className="flex items-start gap-3 text-sm text-amber-950">
              <input
                type="checkbox"
                checked={recoveryConfirmed}
                onChange={(event) => setRecoveryConfirmed(event.target.checked)}
                disabled={!reconciliationReport || applyMutation.isPending}
                className="mt-0.5 h-4 w-4 rounded border-amber-400 focus-visible:ring-2 focus-visible:ring-sky-500"
              />
              <span>
                I reviewed the latest scan and confirm recovery against epoch{' '}
                <span className="font-mono text-xs break-all">{reconciliationReport?.ledger?.observedEpoch ?? '—'}</span>.
              </span>
            </label>
            <button
              type="button"
              onClick={() => applyMutation.mutate()}
              disabled={!canApplyRecovery}
              className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-amber-700 bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-amber-300 disabled:bg-amber-200 disabled:text-amber-700"
            >
              {applyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
              {applyMutation.isPending ? 'Applying recovery…' : 'Apply recovery'}
            </button>
          </div>
        </div>

        <p role="status" aria-live="polite" className="mt-4 min-h-5 text-sm font-medium text-slate-700">
          {actionMessage}
        </p>
      </section>

      <div className="rounded-2xl bg-slate-950 p-5 text-slate-100" style={{ boxShadow: 'var(--shadow-lg)' }}>
        <Section label="① Paano gumagana">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-800/50 p-4">
            {FLOW.map((step, index) => (
              <div key={step.label} className="flex items-center gap-2">
                <div className="flex w-24 flex-col items-center gap-1 text-center">
                  <span className="text-2xl">{step.icon}</span>
                  <span className="text-[11px] text-slate-300">{step.label}</span>
                </div>
                {index < FLOW.length - 1 && <ArrowRight className="h-4 w-4 flex-shrink-0 text-sky-500" />}
              </div>
            ))}
          </div>
        </Section>

        <Section label="② Live demo">
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
            <label className="mb-1 block text-[12px] text-slate-400" htmlFor="anchored-record-select">Piliin ang record:</label>
            <select
              id="anchored-record-select"
              value={selected}
              onChange={(event) => onSelect(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              <option value="">— select an anchored record —</option>
              {anchors.map((anchor) => (
                <option key={anchor.idNumber} value={anchor.idNumber}>
                  {anchor.idNumber} — {anchor.applicantName}
                </option>
              ))}
            </select>

            {anchors.length === 0 && (
              <p className="mt-3 text-[12px] text-amber-300">
                Walang verified anchor receipt pa. Queued operations are not listed as anchored records.
              </p>
            )}

            {selected && (
              <>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleVerify}
                    disabled={busy}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
                  >
                    Verify integrity
                  </button>
                  {TAMPER_FIELDS.map((field) => (
                    <button
                      type="button"
                      key={field}
                      onClick={() => handleTamper(field)}
                      disabled={busy}
                      className="rounded-lg bg-rose-800 px-3 py-2 text-sm font-medium hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50"
                    >
                      Tamper {field}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Walang sinisira sa totoong DB — in-memory lang ang tamper simulation.
                </p>

                {verifyResult && (
                  <div
                    className="mt-4 rounded-lg border p-4"
                    style={verifyResult.hashMatch
                      ? { background: 'rgba(5,46,26,0.6)', borderColor: '#15803d' }
                      : { background: 'rgba(59,10,10,0.6)', borderColor: '#b91c1c' }}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      {verifyResult.hashMatch
                        ? <><CheckCircle2 className="h-5 w-5 text-emerald-400" /> <span className="text-emerald-300">Hash match — VERIFIED</span></>
                        : <><XCircle className="h-5 w-5 text-rose-400" /> <span className="text-rose-300">Integrity FAILED</span></>}
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
                  <div className="mt-4 rounded-lg border p-4" style={{ background: 'rgba(59,10,10,0.6)', borderColor: '#b91c1c' }}>
                    <div className="flex items-center gap-2 font-semibold text-rose-300">
                      <XCircle className="h-5 w-5 text-rose-400" /> Tampered (simulated) — mismatch
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

        {selected && (
          <Section label="③ On-chain proof (anchor details)">
            <div className="space-y-1 rounded-xl border border-slate-700 bg-slate-900 p-4 font-mono text-[12px] text-slate-300">
              <div>canonicalHash : <HashChip value={status?.canonicalHash} /></div>
              <div>txId          : {status?.txId ?? '—'} · block #{status?.blockNumber ?? '—'}</div>
              <div>receipt state : {status?.receiptState ?? '—'}</div>
              <div>anchoredAt    : {status?.anchoredAt ? new Date(status.anchoredAt).toLocaleString('en-PH') : '—'}</div>
              <div>last check    : {status?.lastCheckPassed == null ? '—' : status.lastCheckPassed ? '✅ passed' : '❌ failed'}</div>
            </div>
          </Section>
        )}

        <Section label="④ Scope vs Limitations">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl p-4" style={{ background: 'rgba(5,46,26,0.5)' }}>
              <p className="mb-2 font-semibold text-emerald-300">GINAGAWA</p>
              <ul className="ml-5 list-disc space-y-1 text-[13px] text-emerald-100/90">
                {SCOPE_DOES.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className="rounded-xl p-4" style={{ background: 'rgba(59,10,10,0.5)' }}>
              <p className="mb-2 font-semibold text-rose-300">HINDI GINAGAWA</p>
              <ul className="ml-5 list-disc space-y-1 text-[13px] text-rose-100/90">
                {SCOPE_DOESNT.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        </Section>

        <Section label="⑤ Defensible Q&A">
          <div className="space-y-2">
            {QA.map(({ q, a }) => (
              <details key={q} className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">{q}</summary>
                <p className="mt-2 text-[13px] text-slate-300">{a}</p>
              </details>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
