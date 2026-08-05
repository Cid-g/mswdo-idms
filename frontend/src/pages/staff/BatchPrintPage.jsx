import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Printer, Loader2, Search, X, CreditCard,
  ArrowLeft, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '../../services/api';
import useAuthStore from '../../stores/authStore';

const DEPT_ACCENT = {
  PWD:            '#1E40AF',
  SOLO_PARENT:    '#9F1239',
  SENIOR_CITIZEN: '#92400E',
};
const DEPT_GRADIENT = {
  PWD:            'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 60%, #2563EB 100%)',
  SOLO_PARENT:    'linear-gradient(135deg, #881337 0%, #9F1239 60%, #BE123C 100%)',
  SENIOR_CITIZEN: 'linear-gradient(135deg, #78350F 0%, #92400E 60%, #B45309 100%)',
};

function fmtPrintDate(iso) {
  if (!iso) return null;
  const d    = new Date(iso);
  const now  = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days === 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 7)  return `${days} days ago`;
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BatchPrintPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const accent   = DEPT_ACCENT[user?.department] ?? '#334155';
  const gradient = DEPT_GRADIENT[user?.department]
    ?? 'linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%)';

  const [queue,     setQueue]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState(new Set());
  const [images,    setImages]    = useState({});
  const [search,    setSearch]    = useState('');
  const [filter,    setFilter]    = useState('unprinted'); // 'all' | 'unprinted' | 'printed'
  const [preparing, setPreparing] = useState(false);

  const blobUrlsRef = useRef({});
  const loadedRef   = useRef(new Set());
  const loadingRef  = useRef(new Set());

  // Cleanup blob URLs on unmount
  useEffect(() => () => {
    Object.values(blobUrlsRef.current).forEach(({ front, back }) => {
      if (front) URL.revokeObjectURL(front);
      if (back)  URL.revokeObjectURL(back);
    });
  }, []);

  // ── Image loading ──────────────────────────────────────────────────────────

  const loadImageById = useCallback(async (record) => {
    const id = record._id;
    if (loadedRef.current.has(id) || loadingRef.current.has(id)) return;
    loadingRef.current.add(id);
    try {
      const [frontRes, backRes] = await Promise.allSettled([
        api.get(`/id-records/${id}/image`, { responseType: 'blob' }),
        record.hasBack
          ? api.get(`/id-records/${id}/image/back`, { responseType: 'blob' })
          : Promise.resolve(null),
      ]);
      const front = frontRes.status === 'fulfilled' && frontRes.value
        ? URL.createObjectURL(frontRes.value.data) : null;
      const back  = backRes.status  === 'fulfilled' && backRes.value
        ? URL.createObjectURL(backRes.value.data)  : null;
      blobUrlsRef.current[id] = { front, back };
      loadedRef.current.add(id);
      setImages((prev) => ({ ...prev, [id]: { front, back } }));
    } finally {
      loadingRef.current.delete(id);
    }
  }, []);

  // Fetch queue + auto-load all thumbnails
  useEffect(() => {
    let active = true;
    api.get('/id-records/print-queue')
      .then(({ data }) => {
        if (!active) return;
        setQueue(data);
        data.forEach((record) => loadImageById(record));
      })
      .catch(() => {
        if (active) toast.error('Failed to load print queue.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [loadImageById]);

  // ── Selection helpers ──────────────────────────────────────────────────────

  const filtered = queue.filter((r) => {
    if (filter === 'unprinted' && (r.printCount || 0) > 0)  return false;
    if (filter === 'printed'   && (r.printCount || 0) === 0) return false;
    if (search.trim()) {
      const term = search.toLowerCase();
      const name = `${r.applicant?.lastName ?? ''} ${r.applicant?.firstName ?? ''}`.toLowerCase();
      if (!name.includes(term) && !r.idNumber.toLowerCase().includes(term)) return false;
    }
    return true;
  });

  const selectedList = queue.filter((r) => selected.has(r._id));
  const pagesNeeded  = Math.ceil(selectedList.length / 4);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filtered.map((r) => r._id)));
  }

  function selectUnprinted() {
    setSelected(new Set(
      filtered.filter((r) => (r.printCount || 0) === 0).map((r) => r._id),
    ));
  }

  // ── Print action ───────────────────────────────────────────────────────────

  async function handlePrint() {
    if (selectedList.length === 0) return;

    // Ensure images are loaded for everything selected
    const unloaded = selectedList.filter((r) => !loadedRef.current.has(r._id));
    if (unloaded.length > 0) {
      setPreparing(true);
      await Promise.allSettled(unloaded.map(loadImageById));
      setPreparing(false);
    }

    // Auto-log print (fire-and-forget, non-blocking)
    const ids = selectedList.map((r) => r._id);
    api.post('/id-records/batch-log-print', { ids })
      .then(() => {
        const now = new Date().toISOString();
        setQueue((prev) => prev.map((r) =>
          selected.has(r._id)
            ? { ...r, lastPrintedAt: now, printCount: (r.printCount || 0) + 1 }
            : r,
        ));
      })
      .catch(() => {}); // non-fatal

    // Open browser print dialog
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Print CSS ─────────────────────────────────────────────────────── */}
      <style>{`
        @media screen  { .print-target { display: none !important; } }
        @media print {
          aside, .no-print { display: none !important; }
          main { padding: 0 !important; overflow: visible !important; }
          .print-target { display: block !important; padding: 10mm; }
          /* Each row = one person: [Front][Back] side by side */
          .print-row {
            display: grid;
            grid-template-columns: 85.6mm 85.6mm;
            gap: 4mm;
            margin-bottom: 4mm;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .print-cell { width: 85.6mm; height: 54mm; overflow: hidden; }
          .print-cell img { width: 85.6mm; height: 54mm; display: block; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      {/* ── Screen UI ─────────────────────────────────────────────────────── */}
      <div className="animate-fade-up no-print flex flex-col gap-4">

        {/* Banner */}
        <div
          className="rounded-2xl overflow-hidden relative"
          style={{ background: gradient, minHeight: '110px', boxShadow: 'var(--shadow-lg)' }}
        >
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none"
               style={{ background: 'rgba(255,255,255,0.05)', transform: 'translate(30%,-40%)' }} />
          <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none"
               style={{ background: 'rgba(255,255,255,0.04)', transform: 'translate(-30%,40%)' }} />
          <div className="relative z-10 px-8 py-6 flex items-center justify-between">
            <div>
              <h1 className="font-serif text-3xl text-white leading-tight">Batch Print</h1>
              <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
                Print multiple ID cards per sheet — front and back side by side
              </p>
            </div>
            <button
              onClick={() => navigate('/staff/applicants')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.28)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
            >
              <ArrowLeft className="w-4 h-4" /> Applicants
            </button>
          </div>
        </div>

        {/* Toolbar: filter chips + search + quick-select buttons */}
        <div
          className="bg-white rounded-2xl border border-border px-4 py-3 flex items-center gap-3 flex-wrap"
          style={{ boxShadow: 'var(--shadow-card)' }}
        >
          {/* Filter chips */}
          <div className="flex gap-1.5">
            {[
              { key: 'all',       label: 'All active' },
              { key: 'unprinted', label: 'Not yet printed' },
              { key: 'printed',   label: 'Printed' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={
                  filter === key
                    ? { background: accent, color: 'white' }
                    : { background: 'var(--color-surface)', color: 'var(--color-text-2)' }
                }
              >
                {label}
              </button>
            ))}
          </div>

          <div className="w-px h-5 flex-shrink-0" style={{ background: 'var(--color-border)' }} />

          {/* Search */}
          <div className="relative flex-1 min-w-44">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-muted)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or ID number..."
              className="w-full pl-9 pr-8 py-1.5 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-200"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5" style={{ color: 'var(--color-muted)' }} />
              </button>
            )}
          </div>

          {/* Quick-select buttons */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={selectAll}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text-2)' }}
            >
              Select All ({filtered.length})
            </button>
            <button
              onClick={selectUnprinted}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}
            >
              Unprinted Only
            </button>
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}
              >
                Clear selection
              </button>
            )}
          </div>
        </div>

        {/* Print tip (shown only when something is selected) */}
        {selected.size > 0 && (
          <div
            className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-xs"
            style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)', border: '1px solid #BAE6FD' }}
          >
            <Printer className="w-4 h-4 flex-shrink-0 mt-px" />
            <span>
              Each row prints one person's <strong>front and back side by side</strong>.
              After printing, cut each row — you'll have both sides of one ID card.
              {pagesNeeded > 1 && ` This selection will use ${pagesNeeded} A4 pages.`}
            </span>
          </div>
        )}

        {/* ID list */}
        <div
          className="bg-white rounded-2xl border border-border overflow-hidden"
          style={{ boxShadow: 'var(--shadow-card)', marginBottom: selected.size > 0 ? '72px' : 0 }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: accent }} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: 'var(--color-surface-2)' }}
              >
                <CreditCard className="w-7 h-7" style={{ color: 'var(--color-border)' }} strokeWidth={1.5} />
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-2)' }}>
                {filter !== 'all' || search ? 'No IDs match your filter' : 'No active IDs to print'}
              </p>
              {(filter !== 'all' || search) && (
                <button
                  onClick={() => { setFilter('all'); setSearch(''); }}
                  className="mt-2 text-xs underline"
                  style={{ color: accent }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((record) => {
                const isSel     = selected.has(record._id);
                const img       = images[record._id];
                const isPrinted = (record.printCount || 0) > 0;

                return (
                  <div
                    key={record._id}
                    onClick={() => toggleSelect(record._id)}
                    className="flex items-center gap-4 px-5 py-3.5 cursor-pointer transition-colors hover:bg-surface"
                    style={isSel ? { background: 'var(--color-surface)' } : {}}
                  >
                    {/* Checkbox */}
                    <div
                      className="w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-all"
                      style={
                        isSel
                          ? { background: accent, borderColor: accent }
                          : { background: 'white', borderColor: 'var(--color-border)' }
                      }
                    >
                      {isSel && (
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>

                    {/* Thumbnail pair: front + back */}
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Thumb url={img?.front} label="Front" />
                      {record.hasBack
                        ? <Thumb url={img?.back} label="Back" />
                        : <EmptyThumb />
                      }
                    </div>

                    {/* Name + ID number */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--color-text-1)' }}>
                        {record.applicant?.lastName?.toUpperCase()}, {record.applicant?.firstName}
                        {record.applicant?.middleName ? ` ${record.applicant.middleName[0]}.` : ''}
                      </p>
                      <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-muted)' }}>
                        {record.idNumber}
                      </p>
                    </div>

                    {/* Status column */}
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0 text-xs">
                      {isPrinted ? (
                        <span className="flex items-center gap-1" style={{ color: 'var(--color-success)' }}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Printed{record.printCount > 1 ? ` (${record.printCount}×)` : ''}
                          {record.lastPrintedAt && (
                            <span style={{ color: 'var(--color-muted)' }}>
                              &nbsp;·&nbsp;{fmtPrintDate(record.lastPrintedAt)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 font-medium" style={{ color: 'var(--color-warning)' }}>
                          <Printer className="w-3.5 h-3.5" />
                          Never printed
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Sticky action bar (appears on selection) ──────────────────────── */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-0 right-0 z-40 no-print"
          style={{
            left: '230px',
            background: 'rgba(255,255,255,0.96)',
            backdropFilter: 'blur(8px)',
            borderTop: '1px solid var(--color-border)',
            boxShadow: '0 -4px 20px rgba(15,22,35,0.09)',
          }}
        >
          <div className="px-8 py-3 flex items-center gap-3">
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text-1)' }}>
                {selected.size} ID{selected.size !== 1 ? 's' : ''} selected
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {pagesNeeded} A4 page{pagesNeeded !== 1 ? 's' : ''} · 4 per page · front + back per row
              </p>
            </div>
            <div className="flex-1" />

            <button
              onClick={handlePrint}
              disabled={preparing}
              className="flex items-center gap-2 h-10 px-6 rounded-xl text-sm font-bold text-white transition-all"
              style={{
                background: accent,
                opacity: preparing ? 0.75 : 1,
                cursor: preparing ? 'not-allowed' : 'pointer',
                boxShadow: `0 4px 14px ${accent}40`,
              }}
            >
              {preparing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Preparing…</>
                : <><Printer className="w-4 h-4" /> Print {selected.size} ID{selected.size !== 1 ? 's' : ''}</>
              }
            </button>
          </div>
        </div>
      )}

      {/* ── Print-only output ─────────────────────────────────────────────── */}
      {/* Each .print-row = one person: [Front cell][Back cell] side by side */}
      <div className="print-target">
        {selectedList.map((record) => {
          const img = images[record._id];
          return (
            <div key={record._id} className="print-row">
              <div className="print-cell">
                {img?.front && <img src={img.front} alt="" />}
              </div>
              <div className="print-cell">
                {img?.back && <img src={img.back} alt="" />}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Thumb({ url, label }) {
  return (
    <div
      className="rounded overflow-hidden flex-shrink-0 flex items-center justify-center relative"
      style={{
        width: 80, height: 50,
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
      }}
    >
      {url ? (
        <>
          <img src={url} alt={label} className="w-full h-full object-cover" />
          <span
            className="absolute bottom-0 left-0 right-0 text-center text-white text-[9px] font-semibold py-px"
            style={{ background: 'rgba(0,0,0,0.45)' }}
          >
            {label}
          </span>
        </>
      ) : (
        <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--color-border)' }} />
      )}
    </div>
  );
}

function EmptyThumb() {
  return (
    <div
      className="rounded flex-shrink-0 flex items-center justify-center"
      style={{
        width: 80, height: 50,
        background: 'var(--color-surface)',
        border: '1px dashed var(--color-border)',
      }}
    >
      <span className="text-[9px] font-medium text-center px-1" style={{ color: 'var(--color-muted)' }}>
        1 side only
      </span>
    </div>
  );
}
