import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  LogIn, LogOut, UserPlus, FileEdit, IdCard, Printer, Ban,
  Link, Upload, Search, Download, ChevronLeft, ChevronRight,
  SlidersHorizontal, X, FileText, Layers, CheckCircle, Settings,
} from 'lucide-react';
import { auditLogService } from '../services/auditLogService';
import { cn } from '../lib/utils';

// ── Config ────────────────────────────────────────────────────────────────────

const DEPT_CONFIG = {
  PWD:            { label: 'PWD',          color: '#1E40AF', bg: '#EFF6FF' },
  SOLO_PARENT:    { label: 'Solo Parent',  color: '#9F1239', bg: '#FFF1F2' },
  SENIOR_CITIZEN: { label: 'Senior Citizen', color: '#92400E', bg: '#FFFBEB' },
};

const ACTION_META = {
  LOGIN:              { Icon: LogIn,    color: '#0369A1', bg: '#E0F2FE',  label: 'Signed In' },
  LOGOUT:             { Icon: LogOut,   color: '#4B5563', bg: '#F3F4F6',  label: 'Signed Out' },
  USER_CREATED:       { Icon: UserPlus, color: '#16A34A', bg: '#DCFCE7',  label: 'Staff Added' },
  USER_UPDATED:       { Icon: FileEdit, color: '#D97706', bg: '#FEF3C7',  label: 'Staff Updated' },
  USER_STATUS_CHANGED:{ Icon: FileEdit, color: '#D97706', bg: '#FEF3C7',  label: 'Staff Status Changed' },
  APPLICANT_CREATED:  { Icon: FileText, color: '#7C3AED', bg: '#EDE9FE',  label: 'New Applicant Added' },
  APPLICANT_UPDATED:  { Icon: FileEdit, color: '#7C3AED', bg: '#EDE9FE',  label: 'Applicant Info Updated' },
  ID_GENERATED:       { Icon: IdCard,   color: '#0369A1', bg: '#E0F2FE',  label: 'ID Created' },
  ID_RELEASED:        { Icon: Printer,  color: '#16A34A', bg: '#DCFCE7',  label: 'ID Released' },
  ID_REPRINTED:       { Icon: Printer,  color: '#D97706', bg: '#FEF3C7',  label: 'ID Reprinted' },
  ID_REVOKED:         { Icon: Ban,      color: '#DC2626', bg: '#FEE2E2',  label: 'ID Cancelled' },
  BLOCKCHAIN_ANCHORED:    { Icon: Link,         color: '#059669', bg: '#D1FAE5',  label: 'ID Secured' },
  TEMPLATE_UPLOADED:      { Icon: Upload,       color: '#7C3AED', bg: '#EDE9FE',  label: 'ID Design Uploaded' },
  TEMPLATE_VERSION_CREATED:{ Icon: Layers,      color: '#7C3AED', bg: '#EDE9FE',  label: 'ID Design Version Saved' },
  TEMPLATE_ACTIVATED:     { Icon: CheckCircle,  color: '#16A34A', bg: '#DCFCE7',  label: 'ID Design Activated' },
  TEMPLATE_CONFIG_UPDATED:{ Icon: Settings,     color: '#D97706', bg: '#FEF3C7',  label: 'ID Design Updated' },
};

function getActionMeta(action) {
  if (!action) return { Icon: FileText, color: '#4B5563', bg: '#F3F4F6', label: action };
  const key = Object.keys(ACTION_META).find((k) => action.toUpperCase().includes(k));
  return ACTION_META[key] ?? { Icon: FileText, color: '#4B5563', bg: '#F3F4F6', label: action };
}

const DEPT_OPTIONS = [
  { value: '',               label: 'All Departments' },
  { value: 'PWD',            label: 'PWD' },
  { value: 'SOLO_PARENT',    label: 'Solo Parent' },
  { value: 'SENIOR_CITIZEN', label: 'Senior Citizen' },
];

const PAGE_SIZE = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

function DeptBadge({ dept }) {
  const cfg = DEPT_CONFIG[dept];
  if (!cfg) return null;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

function ActionBadge({ action }) {
  const { Icon, color, bg, label } = getActionMeta(action);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: bg, color }}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {label}
    </span>
  );
}

// ── Timeline item ─────────────────────────────────────────────────────────────

function LogItem({ log, showDept }) {
  const { Icon, color, bg } = getActionMeta(log.action);
  const user = log.userId;
  const name = user ? `${user.firstName} ${user.lastName}` : 'System';
  const roleLabel = user?.role?.replace(/_/g, ' ') ?? '';
  const deptLabel = DEPT_CONFIG[user?.department]?.label ?? '';

  return (
    <div className="flex gap-4 py-3.5 group" style={{ borderBottom: '1px solid var(--color-border)' }}>
      {/* Timeline dot + icon */}
      <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: bg }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color }} aria-hidden="true" />
        </div>
        <div className="w-px flex-1 mt-2" style={{ backgroundColor: 'var(--color-border)' }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <ActionBadge action={log.action} />
          {showDept && log.department && <DeptBadge dept={log.department} />}
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {format(new Date(log.createdAt), 'MMM d, yyyy · h:mm a')}
          </span>
        </div>

        <p className="text-sm font-medium" style={{ color: 'var(--color-text-1)' }}>
          {log.description}
        </p>

        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-2)' }}>
          <span className="font-medium">{name}</span>
          {roleLabel && (
            <span style={{ color: 'var(--color-muted)' }}>
              {' · '}{roleLabel}
              {deptLabel && ` · ${deptLabel}`}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AuditLogsView({ isSuperAdmin, user }) {
  const [page, setPage]             = useState(1);
  const [department, setDepartment] = useState('');
  const [userId, setUserId]         = useState('');
  const [action, setAction]         = useState('');
  const [targetType, setTargetType] = useState('');
  const [search, setSearch]         = useState('');
  const [from, setFrom]             = useState('');
  const [to, setTo]                 = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting]   = useState(false);

  const accent = user?.department
    ? (DEPT_CONFIG[user.department]?.color ?? '#334155')
    : '#334155';

  const gradient = isSuperAdmin
    ? 'linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%)'
    : (user?.department === 'PWD'
        ? 'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 60%, #2563EB 100%)'
        : user?.department === 'SOLO_PARENT'
          ? 'linear-gradient(135deg, #881337 0%, #9F1239 60%, #BE123C 100%)'
          : 'linear-gradient(135deg, #78350F 0%, #92400E 60%, #B45309 100%)');

  const params = useMemo(() => ({
    page,
    limit: PAGE_SIZE,
    ...(isSuperAdmin && department ? { department } : {}),
    ...(userId     ? { userId }     : {}),
    ...(action     ? { action }     : {}),
    ...(targetType ? { targetType } : {}),
    ...(search     ? { search }     : {}),
    ...(from ? { from } : {}),
    ...(to   ? { to }   : {}),
  }), [page, isSuperAdmin, department, userId, action, targetType, search, from, to]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-logs', params],
    queryFn:  () => auditLogService.getLogs(params),
    keepPreviousData: true,
  });

  const { data: actions = [] } = useQuery({
    queryKey: ['audit-actions'],
    queryFn:  auditLogService.getActions,
    staleTime: 60_000,
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['audit-users'],
    queryFn:  auditLogService.getUsers,
    staleTime: 60_000,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  const hasFilters = department || userId || action || targetType || search || from || to;

  function clearFilters() {
    setDepartment('');
    setUserId('');
    setAction('');
    setTargetType('');
    setSearch('');
    setFrom('');
    setTo('');
    setPage(1);
  }

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const { department: d, userId: u, action: a, targetType: tt, search: s, from: f, to: t } = params;
      const blob = await auditLogService.exportCsv({
        ...(d  ? { department: d }  : {}),
        ...(u  ? { userId: u }      : {}),
        ...(a  ? { action: a }      : {}),
        ...(tt ? { targetType: tt } : {}),
        ...(s  ? { search: s }      : {}),
        ...(f  ? { from: f }        : {}),
        ...(t  ? { to: t }          : {}),
      });
      const url = URL.createObjectURL(blob);
      const a2  = document.createElement('a');
      a2.href     = url;
      a2.download = `audit-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      a2.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [params]);

  return (
    <div className="animate-fade-up">
      {/* ── Banner ────────────────────────────────────────────── */}
      <div
        className="rounded-2xl px-8 py-7 mb-6 text-white"
        style={{ background: gradient }}
      >
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {isSuperAdmin ? 'System Administration' : 'Department Administration'}
        </p>
        <h1 className="text-3xl font-serif leading-tight">Activity History</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.70)' }}>
          {isSuperAdmin
            ? 'Complete record of all system activity across all departments'
            : `Activity log for ${DEPT_CONFIG[user?.department]?.label ?? 'your'} department`}
        </p>
      </div>

      {/* ── Controls row ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={cn(
              'inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium border transition-all',
              filtersOpen || hasFilters
                ? 'text-white border-transparent'
                : 'border-[var(--color-border)] text-[var(--color-text-2)] hover:bg-[var(--color-surface)]',
            )}
            style={filtersOpen || hasFilters
              ? { backgroundColor: accent, borderColor: accent }
              : {}}
          >
            <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
            Filters
            {hasFilters && (
              <span className="w-5 h-5 rounded-full bg-white/25 text-[10px] font-bold flex items-center justify-center">
                {[department, userId, action, targetType, search, from, to].filter(Boolean).length}
              </span>
            )}
          </button>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-lg text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors border border-[var(--color-danger)]/30"
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {data && (
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {data.total.toLocaleString()} activities
            </span>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium border border-[var(--color-border)] text-[var(--color-text-2)] hover:bg-[var(--color-surface)] disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            {exporting ? 'Downloading…' : 'Download Report'}
          </button>
        </div>
      </div>

      {/* ── Filter panel ─────────────────────────────────────── */}
      {filtersOpen && (
        <div
          className="bg-white rounded-xl p-5 mb-4 animate-fade-up"
          style={{ boxShadow: 'var(--shadow-card)' }}
        >
          {/* Row 1: search + dept (SA only) + action + target type */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4 mb-4">
            <div className={isSuperAdmin ? '' : 'sm:col-span-2 md:col-span-2'}>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>
                Search
              </label>
              <div className="relative">
                <Search
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                  style={{ color: 'var(--color-muted)' }}
                />
                <input
                  type="text"
                  placeholder="e.g. applicant created, ID released…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="w-full h-9 pl-8 pr-3 rounded-lg border text-sm bg-white focus:outline-none transition"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)' }}
                />
              </div>
            </div>

            {isSuperAdmin && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>
                  Department
                </label>
                <select
                  value={department}
                  onChange={(e) => { setDepartment(e.target.value); setPage(1); }}
                  className="w-full h-9 px-3 rounded-lg border text-sm bg-white focus:outline-none transition"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)' }}
                >
                  {DEPT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>
                Staff
              </label>
              <select
                value={userId}
                onChange={(e) => { setUserId(e.target.value); setPage(1); }}
                className="w-full h-9 px-3 rounded-lg border text-sm bg-white focus:outline-none transition"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)' }}
              >
                <option value="">All Staff</option>
                {staff.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.firstName} {u.lastName}
                    {u.role ? ` · ${u.role.replace(/_/g, ' ')}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>
                Activity
              </label>
              <select
                value={action}
                onChange={(e) => { setAction(e.target.value); setPage(1); }}
                className="w-full h-9 px-3 rounded-lg border text-sm bg-white focus:outline-none transition"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)' }}
              >
                <option value="">All Activities</option>
                {actions.map((a) => (
                  <option key={a} value={a}>
                    {getActionMeta(a).label !== a ? getActionMeta(a).label : a.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>
                Category
              </label>
              <select
                value={targetType}
                onChange={(e) => { setTargetType(e.target.value); setPage(1); }}
                className="w-full h-9 px-3 rounded-lg border text-sm bg-white focus:outline-none transition"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)' }}
              >
                <option value="">All Categories</option>
                <option value="Applicant">Applicant</option>
                <option value="IDRecord">ID Card</option>
                <option value="User">Staff Account</option>
                <option value="IDTemplateVersion">ID Design</option>
              </select>
            </div>
          </div>

          {/* Row 2: date range */}
          <div className="grid grid-cols-2 gap-4 md:w-1/2">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>
                From Date
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setPage(1); }}
                className="w-full h-9 px-3 rounded-lg border text-sm bg-white focus:outline-none transition"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)' }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>
                To Date
              </label>
              <input
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); setPage(1); }}
                className="w-full h-9 px-3 rounded-lg border text-sm bg-white focus:outline-none transition"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Log timeline ─────────────────────────────────────── */}
      <div
        className="bg-white rounded-xl overflow-hidden"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        {isLoading && (
          <div className="divide-y divide-[var(--color-border)]">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-4 px-6 py-4 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 bg-gray-100 rounded w-40" />
                  <div className="h-3.5 bg-gray-200 rounded w-64" />
                  <div className="h-3 bg-gray-100 rounded w-32" />
                </div>
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Search className="w-12 h-12" style={{ color: 'var(--color-border)' }} />
            <p className="text-base font-medium" style={{ color: 'var(--color-text-2)' }}>Couldn't load activity history</p>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Check your connection and try again.</p>
          </div>
        )}

        {!isLoading && !isError && data?.data?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Search className="w-12 h-12" style={{ color: 'var(--color-border)' }} />
            <p className="text-base font-medium" style={{ color: 'var(--color-text-2)' }}>No activity found</p>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              Try adjusting your date range or filter criteria.
            </p>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
                style={{ color: accent }}
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        {!isLoading && !isError && data?.data?.length > 0 && (
          <div className="px-6">
            {data.data.map((log) => (
              <LogItem key={log._id} log={log} showDept={isSuperAdmin} />
            ))}
          </div>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────── */}
      {!isLoading && data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Showing{' '}
            <span style={{ color: 'var(--color-text-1)', fontWeight: 500 }}>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)}
            </span>{' '}
            of{' '}
            <span style={{ color: 'var(--color-text-1)', fontWeight: 500 }}>
              {data.total.toLocaleString()}
            </span>
          </p>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="w-9 h-9 rounded-lg flex items-center justify-center border border-[var(--color-border)] disabled:opacity-40 hover:bg-[var(--color-surface)] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let p;
              if (totalPages <= 5)         p = i + 1;
              else if (page <= 3)          p = i + 1;
              else if (page >= totalPages - 2) p = totalPages - 4 + i;
              else                         p = page - 2 + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-medium border transition-all"
                  style={
                    p === page
                      ? { backgroundColor: accent, borderColor: accent, color: '#fff' }
                      : { borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }
                  }
                >
                  {p}
                </button>
              );
            })}

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="w-9 h-9 rounded-lg flex items-center justify-center border border-[var(--color-border)] disabled:opacity-40 hover:bg-[var(--color-surface)] transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
