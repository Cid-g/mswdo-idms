import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { cn, computeAge, formatDateShort, getPrimaryId } from '../../lib/utils';
import { applicantService } from '../../services/applicantService';
import useAuthStore from '../../stores/authStore';

// ── Status badge ───────────────────────────────────────────────────────────
const STATUS_STYLES = {
  PARTIAL:  'bg-amber-50 text-amber-800 border-amber-200',
  COMPLETE: 'bg-green-50 text-green-800 border-green-200',
  REVOKED:  'bg-red-50 text-red-800 border-red-200',
};
const STATUS_LABEL = {
  PARTIAL:  'Partial',
  COMPLETE: 'Complete',
  REVOKED:  'Revoked',
};

function StatusBadge({ status }) {
  return (
    <span
      role="status"
      aria-label={`Status: ${STATUS_LABEL[status] ?? status}`}
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border',
        STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600 border-gray-200'
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full bg-current opacity-70', status === 'PARTIAL' && 'animate-pulse')} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ── ID card status badge ────────────────────────────────────────────────────
function IDCardBadge({ idCard }) {
  if (!idCard) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-50 text-gray-500 border-gray-200">
        No ID
      </span>
    );
  }
  if (idCard.status === 'REVOKED') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-red-50 text-red-700 border-red-200">
        Revoked
      </span>
    );
  }
  if (idCard.isPrinted) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-blue-50 text-blue-700 border-blue-200">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Printed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-50 text-amber-700 border-amber-200">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Generated
    </span>
  );
}

// ── Skeleton rows ──────────────────────────────────────────────────────────
function SkeletonRows() {
  return Array.from({ length: 5 }).map((_, i) => (
    <tr key={i} className="border-t border-border/60">
      {Array.from({ length: 8 }).map((__, j) => (
        <td key={j} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: j === 1 ? '160px' : '80px' }} />
        </td>
      ))}
    </tr>
  ));
}

// ── Dept label for column headers ──────────────────────────────────────────
const DEPT_ID_LABEL = {
  PWD:            'Control No.',
  SENIOR_CITIZEN: 'OSCA No.',
  SOLO_PARENT:    'Case No.',
};

const DEPT_THEME = {
  PWD:            { accent: '#1E40AF', light: '#EFF6FF', gradient: 'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 60%, #2563EB 100%)', label: 'Persons with Disability' },
  SOLO_PARENT:    { accent: '#9F1239', light: '#FFF1F2', gradient: 'linear-gradient(135deg, #881337 0%, #9F1239 60%, #BE123C 100%)', label: 'Solo Parent' },
  SENIOR_CITIZEN: { accent: '#92400E', light: '#FFFBEB', gradient: 'linear-gradient(135deg, #78350F 0%, #92400E 60%, #B45309 100%)', label: 'Senior Citizen' },
};
const DEFAULT_THEME = { accent: '#334155', light: '#F1F5F9', gradient: 'linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%)', label: 'All Departments' };

const LIMIT = 20;

export default function ApplicantsPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page,         setPage]         = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceTimer = useRef(null);

  function handleSearchChange(val) {
    setSearch(val);
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 350);
  }

  const { data, isLoading } = useQuery({
    queryKey: ['applicants', { status: statusFilter, search: debouncedSearch, page }],
    queryFn: () => applicantService.getApplicants({
      ...(statusFilter    && { status: statusFilter }),
      ...(debouncedSearch && { search: debouncedSearch }),
      page,
      limit: LIMIT,
    }),
    keepPreviousData: true,
  });

  const applicants  = data?.data ?? [];
  const total       = data?.total ?? 0;
  const totalPages  = Math.ceil(total / LIMIT);
  const idColLabel  = DEPT_ID_LABEL[user?.department] ?? 'ID No.';

  const dept  = user?.department;
  const theme = DEPT_THEME[dept] ?? DEFAULT_THEME;

  return (
    <div className="animate-fade-up">
      <a
        href="#applicants-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium focus:bg-white focus:text-text-1 focus:shadow-lg"
      >
        Skip to applicants list
      </a>
      {/* ── Dept gradient banner ── */}
      <div
        className="rounded-2xl overflow-hidden mb-6 relative"
        style={{ background: theme.gradient, minHeight: '110px', boxShadow: 'var(--shadow-lg)' }}
      >
        {/* Decorative circles */}
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none"
             style={{ background: 'rgba(255,255,255,0.05)', transform: 'translate(30%,-40%)' }} />
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none"
             style={{ background: 'rgba(255,255,255,0.04)', transform: 'translate(-30%,40%)' }} />
        <div className="relative z-10 px-8 py-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-3xl text-white leading-tight">Applicants</h1>
            <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
              {theme.label}
              {total > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{ background: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.9)' }}>
                  {total}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => navigate('/staff/applicants/new')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.28)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            New Applicant
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search by name or ID number…"
            aria-label="Search applicants by name or ID number"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
            style={{ boxShadow: 'var(--shadow-card)' }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2.5 border border-border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 cursor-pointer"
          style={{ boxShadow: 'var(--shadow-card)' }}
        >
          <option value="">All Status</option>
          <option value="PARTIAL">Partial</option>
          <option value="COMPLETE">Complete</option>
          <option value="REVOKED">Revoked</option>
        </select>
      </div>

      {/* Table */}
      <div
        id="applicants-main"
        className="mt-4 bg-white border border-border rounded-2xl overflow-hidden"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        {!isLoading && applicants.length === 0 ? (
          <div className="py-16 text-center">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: theme.light }}
            >
              <Search className="w-6 h-6" style={{ color: theme.accent }} />
            </div>
            <p className="font-semibold text-text-1 text-sm mb-1">
              {debouncedSearch || statusFilter ? 'No applicants match your filters' : 'No applicants yet'}
            </p>
            <p className="text-muted text-sm mb-4">
              {debouncedSearch || statusFilter
                ? 'Try adjusting your search or clearing the filters.'
                : `Start by adding the first applicant for the ${theme.label} department.`}
            </p>
            {!debouncedSearch && !statusFilter && (
              <button
                onClick={() => navigate('/staff/applicants/new')}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                style={{ backgroundColor: theme.accent }}
              >
                <Plus className="w-4 h-4" />
                Add First Applicant
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {[idColLabel, 'Full Name', 'Age / Sex', 'Barangay', 'Status', 'ID Card', 'Date Added', 'Actions'].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonRows />
              ) : (
                applicants.map((a) => {
                  const { value: idValue } = getPrimaryId(a);
                  const age = a.birthdate ? computeAge(a.birthdate) : null;
                  const sexDisplay = a.sex === 'M' ? 'M' : a.sex === 'F' ? 'F' : a.sex?.[0] ?? '—';

                  return (
                    <tr
                      key={a._id}
                      className="border-t border-border/60 transition-colors cursor-pointer"
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.light)}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '')}
                      onClick={() => navigate(`/staff/applicants/${a._id}`)}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-text-2">{idValue || '—'}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-1">
                          {a.lastName}, {a.firstName}
                          {a.middleName ? ` ${a.middleName[0]}.` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-text-2">
                        {age !== null ? `${age} / ` : ''}{sexDisplay}
                      </td>
                      <td className="px-4 py-3 text-text-2">{a.barangay || '—'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="px-4 py-3">
                        <IDCardBadge idCard={a.idCard} />
                      </td>
                      <td className="px-4 py-3 text-text-2">{formatDateShort(a.createdAt)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/staff/applicants/${a._id}`); }}
                          aria-label="View applicant"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-surface-2"
                          style={{ color: 'var(--color-muted)' }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = theme.accent)}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-muted)')}
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted">
          <span>
            Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
