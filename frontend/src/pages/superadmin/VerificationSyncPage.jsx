import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CloudCog,
  Copy,
  DatabaseBackup,
  Info,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  TimerOff,
  X,
} from 'lucide-react';
import {
  getVerificationSyncStatus,
  resyncVerificationRecord,
  retryVerificationSyncOperation,
} from '../../services/verificationSyncService';

const ID_REF_PATTERN = /^[a-f0-9]{24}$/i;
const RESYNC_REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{7,63}$/;

const STATE_STYLES = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-800',
  PROCESSING: 'border-sky-200 bg-sky-50 text-sky-800',
  FAILED: 'border-rose-200 bg-rose-50 text-rose-800',
  SENT: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

const SUMMARY_CARDS = [
  { key: 'PENDING', label: 'Pending', helper: 'Waiting for delivery', icon: Clock3 },
  { key: 'PROCESSING', label: 'Processing', helper: 'Currently leased', icon: Send },
  { key: 'FAILED', label: 'Failed', helper: 'Needs operator review', icon: AlertTriangle },
  { key: 'SENT', label: 'Sent', helper: 'Acknowledged by host', icon: CheckCircle2 },
];

function formatDateTime(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'Unknown';
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function shortenRef(value) {
  if (!value) return 'Unavailable';
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function createResyncRequestId() {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const randomPart = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 24)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(0, 24);
  return `resync-${day}-${randomPart}`.toLowerCase().slice(0, 64);
}

function failureText(failure) {
  if (!failure) return 'No classified failure';
  const details = [failure.code];
  if (failure.remoteCode) details.push(`remote ${failure.remoteCode}`);
  if (failure.status) details.push(`HTTP ${failure.status}`);
  return details.join(' · ');
}

function StatusBadge({ state }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATE_STYLES[state] ?? 'border-slate-200 bg-slate-50 text-slate-700'}`}>
      {state}
    </span>
  );
}

function ReferenceButton({ value, label = 'Copy' }) {
  async function copyReference() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Reference copied.');
    } catch {
      toast.error('Reference could not be copied.');
    }
  }

  return (
    <button
      type="button"
      onClick={copyReference}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
      aria-label={`${label} ${value}`}
    >
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

function OperationIdentity({ operation, onUseForResync }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">{operation.event}</span>
        <StatusBadge state={operation.state} />
      </div>
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
        <span className="font-mono">Record {shortenRef(operation.idRecordId)}</span>
        {operation.idRecordId && <ReferenceButton value={operation.idRecordId} label="Copy" />}
        {onUseForResync && operation.idRecordId && (
          <button
            type="button"
            onClick={() => onUseForResync(operation.idRecordId)}
            className="rounded-md px-1.5 py-1 font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            Select for resync
          </button>
        )}
      </div>
      <p className="font-mono text-[11px] text-slate-400">
        Operation {shortenRef(operation.operationRef)}
      </p>
    </div>
  );
}

function EmptyState({ children }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

function ConfirmDialog({ title, description, confirmLabel, tone = 'slate', busy, onCancel, onConfirm, children }) {
  const buttonClass = tone === 'danger'
    ? 'bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600'
    : 'bg-slate-900 hover:bg-slate-800 focus-visible:outline-slate-900';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        onClick={busy ? undefined : onCancel}
        aria-label="Close confirmation"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="verification-confirm-title"
        className="relative z-10 w-full max-w-lg animate-modal-in rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="verification-confirm-title" className="font-serif text-2xl text-slate-900">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close confirmation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {children && <div className="mt-5">{children}</div>}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${buttonClass}`}
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ item, value }) {
  const Icon = item.icon;
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{value ?? 0}</p>
        </div>
        <div className={`rounded-xl border p-2.5 ${STATE_STYLES[item.key]}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{item.helper}</p>
    </article>
  );
}

function QueueHealthBanner({ status }) {
  const failed = status?.counts?.FAILED ?? 0;
  const stale = status?.staleProcessing?.count ?? 0;
  const undelivered = status?.undeliveredCount ?? 0;

  let presentation;
  if (failed > 0 || stale > 0) {
    presentation = {
      icon: AlertTriangle,
      title: 'Operator attention required',
      message: `${failed} failed and ${stale} stale processing operation${failed + stale === 1 ? '' : 's'} need review.`,
      classes: 'border-rose-200 bg-rose-50 text-rose-900',
      iconClasses: 'text-rose-600',
    };
  } else if (undelivered > 0) {
    presentation = {
      icon: RefreshCw,
      title: 'Synchronization in progress',
      message: `${undelivered} operation${undelivered === 1 ? '' : 's'} remain in the local delivery queue.`,
      classes: 'border-amber-200 bg-amber-50 text-amber-900',
      iconClasses: 'text-amber-600',
    };
  } else {
    presentation = {
      icon: CheckCircle2,
      title: 'Local verification queue is caught up',
      message: 'No pending, processing, or failed verification synchronization work is recorded.',
      classes: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      iconClasses: 'text-emerald-600',
    };
  }

  const Icon = presentation.icon;
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${presentation.classes}`}>
      <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${presentation.iconClasses}`} aria-hidden="true" />
      <div>
        <p className="font-semibold">{presentation.title}</p>
        <p className="mt-1 text-sm opacity-80">{presentation.message}</p>
      </div>
    </div>
  );
}

function OldestOperationCard({ operation, onUseForResync }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Clock3 className="h-5 w-5 text-slate-500" />
        <h2 className="font-serif text-xl text-slate-900">Oldest undelivered work</h2>
      </div>
      {!operation ? (
        <div className="mt-4">
          <EmptyState>No undelivered verification operation.</EmptyState>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <OperationIdentity operation={operation} onUseForResync={onUseForResync} />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:text-right">
            <div>
              <dt className="text-xs text-slate-500">Age</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{formatDuration(operation.ageMs)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Revision</dt>
              <dd className="mt-0.5 font-mono font-semibold text-slate-900">{operation.epoch}.{operation.revision}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Attempts</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{operation.attempts}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Created</dt>
              <dd className="mt-0.5 text-xs font-medium text-slate-700">{formatDateTime(operation.createdAt)}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}

function StaleProcessingTable({ group, onUseForResync }) {
  const items = group?.items ?? [];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <TimerOff className="h-5 w-5 text-slate-500" />
            <h2 className="font-serif text-xl text-slate-900">Stale processing leases</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Visibility only. The background worker owns lease recovery; this page never force-unlocks rows.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {group?.count ?? 0} total
        </span>
      </div>

      {items.length === 0 ? (
        <div className="mt-4"><EmptyState>No expired or missing processing leases.</EmptyState></div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.06em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Operation</th>
                <th className="px-4 py-3 font-semibold">Revision</th>
                <th className="px-4 py-3 font-semibold">Lease</th>
                <th className="px-4 py-3 font-semibold">Overdue</th>
                <th className="px-4 py-3 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.map((operation) => (
                <tr key={operation.operationRef} className="align-top">
                  <td className="px-4 py-4"><OperationIdentity operation={operation} onUseForResync={onUseForResync} /></td>
                  <td className="px-4 py-4 font-mono text-slate-700">{operation.epoch}.{operation.revision}</td>
                  <td className="px-4 py-4">
                    <span className="font-semibold text-rose-700">{operation.lease?.state ?? 'UNKNOWN'}</span>
                    <p className="mt-1 text-xs text-slate-500">{formatDateTime(operation.lease?.lockedUntil)}</p>
                  </td>
                  <td className="px-4 py-4 font-semibold text-slate-800">{formatDuration(operation.overdueMs)}</td>
                  <td className="px-4 py-4 text-xs text-slate-600">{formatDateTime(operation.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(group?.count ?? 0) > items.length && (
        <p className="mt-3 text-xs text-slate-500">Showing {items.length} of {group.count} stale operations.</p>
      )}
    </section>
  );
}

function FailureTable({ group, retryingRef, onRetry, onUseForResync }) {
  const items = group?.items ?? [];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-600" />
            <h2 className="font-serif text-xl text-slate-900">Recent terminal failures</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Only sanitized failure classifications are displayed. Retry requeues the same immutable revision.
          </p>
        </div>
        <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
          {group?.count ?? 0} total
        </span>
      </div>

      {items.length === 0 ? (
        <div className="mt-4"><EmptyState>No failed verification synchronization operation.</EmptyState></div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[920px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.06em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Operation</th>
                <th className="px-4 py-3 font-semibold">Revision</th>
                <th className="px-4 py-3 font-semibold">Attempts</th>
                <th className="px-4 py-3 font-semibold">Failure</th>
                <th className="px-4 py-3 font-semibold">Last update</th>
                <th className="px-4 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.map((operation) => {
                const isRetrying = retryingRef === operation.operationRef;
                return (
                  <tr key={operation.operationRef} className="align-top">
                    <td className="px-4 py-4"><OperationIdentity operation={operation} onUseForResync={onUseForResync} /></td>
                    <td className="px-4 py-4 font-mono text-slate-700">{operation.epoch}.{operation.revision}</td>
                    <td className="px-4 py-4 font-semibold text-slate-800">{operation.attempts}</td>
                    <td className="px-4 py-4">
                      <p className="max-w-[260px] break-words font-mono text-xs text-rose-700">{failureText(operation.failure)}</p>
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-600">{formatDateTime(operation.updatedAt)}</td>
                    <td className="px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => onRetry(operation)}
                        disabled={isRetrying}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isRetrying ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        Retry
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(group?.count ?? 0) > items.length && (
        <p className="mt-3 text-xs text-slate-500">Showing {items.length} of {group.count} failed operations.</p>
      )}
    </section>
  );
}

function ResyncPanel({ idRecordRef, requestId, onRecordRefChange, onRequestIdChange, onRegenerate, onReview, disabled }) {
  const validRecordRef = ID_REF_PATTERN.test(idRecordRef);
  const validRequestId = RESYNC_REQUEST_ID_PATTERN.test(requestId);
  return (
    <section id="verification-resync" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm scroll-mt-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-2.5 text-indigo-700">
          <DatabaseBackup className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-serif text-xl text-slate-900">Full-record resynchronization</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Builds a new authoritative verification projection from the current local ID record. This is not a retry and does not modify older outbox history.
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            Resolve every PENDING, PROCESSING, or FAILED operation for this record first. The server will reject resync when undelivered work or inconsistent revision history exists.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <label className="block">
          <span className="text-sm font-semibold text-slate-800">ID record reference</span>
          <input
            type="text"
            value={idRecordRef}
            onChange={(event) => onRecordRefChange(event.target.value.trim())}
            maxLength={24}
            spellCheck="false"
            autoComplete="off"
            placeholder="24-character record reference"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 font-mono text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
          <span className={`mt-1.5 block text-xs ${idRecordRef && !validRecordRef ? 'text-rose-600' : 'text-slate-500'}`}>
            {idRecordRef && !validRecordRef
              ? 'Enter exactly 24 hexadecimal characters.'
              : 'Use a record reference shown above or supplied by an authorized support workflow.'}
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-800">Idempotency request ID</span>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={requestId}
              onChange={(event) => onRequestIdChange(event.target.value.toLowerCase())}
              maxLength={64}
              spellCheck="false"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-3 font-mono text-sm text-slate-800 outline-none transition focus:border-slate-500 focus:bg-white focus:ring-2 focus:ring-slate-200"
            />
            <button
              type="button"
              onClick={onRegenerate}
              className="rounded-xl border border-slate-300 px-3 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              aria-label="Generate a new request ID"
              title="Generate a new request ID"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <span className={`mt-1.5 block text-xs ${validRequestId ? 'text-slate-500' : 'text-rose-600'}`}>
            {validRequestId
              ? 'Reusing this ID with the same projection is idempotent; reusing it after the projection changes is rejected.'
              : 'Use 8 to 64 lowercase letters, numbers, dots, underscores, or hyphens.'}
          </span>
        </label>
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 text-sm text-slate-600">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" />
          <p>The browser queues only a local recovery request. The background sender remains the sole hosted-service write path.</p>
        </div>
        <button
          type="button"
          onClick={onReview}
          disabled={disabled || !validRecordRef || !validRequestId}
          className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <DatabaseBackup className="h-4 w-4" />
          Review resync
        </button>
      </div>
    </section>
  );
}

export default function VerificationSyncPage() {
  const queryClient = useQueryClient();
  const [retryTarget, setRetryTarget] = useState(null);
  const [resyncReviewOpen, setResyncReviewOpen] = useState(false);
  const [idRecordRef, setIdRecordRef] = useState('');
  const [requestId, setRequestId] = useState(createResyncRequestId);

  const statusQuery = useQuery({
    queryKey: ['verification-sync-status'],
    queryFn: getVerificationSyncStatus,
    refetchInterval: 15_000,
  });

  const retryMutation = useMutation({
    mutationFn: retryVerificationSyncOperation,
    onSuccess: async (result) => {
      setRetryTarget(null);
      toast.success(`${result.operation.event} revision ${result.operation.revision} was requeued.`);
      await queryClient.invalidateQueries({ queryKey: ['verification-sync-status'] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.error?.message || 'The failed operation could not be retried.');
    },
  });

  const resyncMutation = useMutation({
    mutationFn: resyncVerificationRecord,
    onSuccess: async (result) => {
      setResyncReviewOpen(false);
      if (result.queued) {
        toast.success(`Authoritative revision ${result.operation.revision} was queued for synchronization.`);
      } else {
        toast.info(`The request was already queued as revision ${result.operation.revision}; no duplicate was created.`);
      }
      setRequestId(createResyncRequestId());
      await queryClient.invalidateQueries({ queryKey: ['verification-sync-status'] });
    },
    onError: (error) => {
      toast.error(error.response?.data?.error?.message || 'Full-record resynchronization could not be queued.');
    },
  });

  const status = statusQuery.data;
  const retryingRef = retryMutation.isPending ? retryMutation.variables : null;
  const generatedAt = formatDateTime(status?.generatedAt);
  const operationCount = useMemo(
    () => Object.values(status?.counts ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0),
    [status?.counts]
  );

  function useRecordForResync(recordRef) {
    setIdRecordRef(recordRef);
    document.getElementById('verification-resync')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast.info('Record selected. Resolve undelivered work before submitting a resync.');
  }

  function confirmRetry() {
    if (!retryTarget?.operationRef || retryMutation.isPending) return;
    retryMutation.mutate(retryTarget.operationRef);
  }

  function confirmResync() {
    if (
      !ID_REF_PATTERN.test(idRecordRef)
      || !RESYNC_REQUEST_ID_PATTERN.test(requestId)
      || resyncMutation.isPending
    ) return;
    resyncMutation.mutate({ idRecordRef, requestId });
  }

  return (
    <div className="mx-auto max-w-7xl animate-fade-up text-slate-900">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-serif text-3xl text-slate-900">
            <CloudCog className="h-7 w-7 text-slate-600" /> Verification Synchronization
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Local queue visibility and controlled recovery for the outbound-only hosted verification projection.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <div className="text-left text-xs text-slate-500 sm:text-right">
            <p>Latest local scan</p>
            <p className="mt-0.5 font-mono text-slate-700">{generatedAt}</p>
          </div>
          <button
            type="button"
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${statusQuery.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-sky-700" />
          <p className="leading-6">
            This page reports local delivery operations only. A SENT count confirms hosted acknowledgment, but it does not by itself determine whether a specific public QR check returns VALID, UNKNOWN, NOT_VALID, or NOT_FOUND.
          </p>
        </div>
      </div>

      {statusQuery.isLoading ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <div className="text-center text-slate-500">
            <LoaderCircle className="mx-auto h-7 w-7 animate-spin" />
            <p className="mt-3 text-sm">Loading local verification operations…</p>
          </div>
        </div>
      ) : statusQuery.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Verification synchronization status could not be loaded.</p>
              <p className="mt-1 text-sm opacity-80">
                {statusQuery.error?.response?.data?.error?.message || 'Check the local backend connection and try again.'}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <QueueHealthBanner status={status} />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {SUMMARY_CARDS.map((item) => (
              <SummaryCard key={item.key} item={item} value={status?.counts?.[item.key]} />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 shadow-sm">
            <span><strong className="text-slate-800">{status?.undeliveredCount ?? 0}</strong> undelivered</span>
            <span><strong className="text-slate-800">{operationCount}</strong> total durable operations</span>
            <span>Rows are privacy-safe and capped for operator review; aggregate counts remain complete.</span>
          </div>

          <OldestOperationCard operation={status?.oldestUndelivered} onUseForResync={useRecordForResync} />
          <StaleProcessingTable group={status?.staleProcessing} onUseForResync={useRecordForResync} />
          <FailureTable
            group={status?.recentFailures}
            retryingRef={retryingRef}
            onRetry={setRetryTarget}
            onUseForResync={useRecordForResync}
          />
          <ResyncPanel
            idRecordRef={idRecordRef}
            requestId={requestId}
            onRecordRefChange={setIdRecordRef}
            onRequestIdChange={setRequestId}
            onRegenerate={() => setRequestId(createResyncRequestId())}
            onReview={() => setResyncReviewOpen(true)}
            disabled={resyncMutation.isPending}
          />
        </div>
      )}

      {retryTarget && (
        <ConfirmDialog
          title="Retry failed verification operation?"
          description="This resets the selected immutable FAILED row to PENDING. The background sender will perform the delivery; no new verification revision is created."
          confirmLabel="Queue retry"
          tone="danger"
          busy={retryMutation.isPending}
          onCancel={() => setRetryTarget(null)}
          onConfirm={confirmRetry}
        >
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <OperationIdentity operation={retryTarget} />
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600">
              <div>
                <dt>Revision</dt>
                <dd className="mt-1 font-mono font-semibold text-slate-900">{retryTarget.epoch}.{retryTarget.revision}</dd>
              </div>
              <div>
                <dt>Previous attempts</dt>
                <dd className="mt-1 font-semibold text-slate-900">{retryTarget.attempts}</dd>
              </div>
            </dl>
          </div>
        </ConfirmDialog>
      )}

      {resyncReviewOpen && (
        <ConfirmDialog
          title="Create a new authoritative revision?"
          description="Full-record resynchronization rebuilds the public-safe projection from current local sources. It is not a retry, does not overwrite prior outbox rows, and is rejected while undelivered work exists."
          confirmLabel="Queue new revision"
          busy={resyncMutation.isPending}
          onCancel={() => setResyncReviewOpen(false)}
          onConfirm={confirmResync}
        >
          <dl className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">ID record reference</dt>
              <dd className="mt-1 break-all font-mono text-slate-900">{idRecordRef}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Request ID</dt>
              <dd className="mt-1 break-all font-mono text-slate-900">{requestId}</dd>
            </div>
          </dl>
        </ConfirmDialog>
      )}
    </div>
  );
}
