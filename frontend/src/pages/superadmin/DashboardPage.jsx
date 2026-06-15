import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, Tooltip as PieTooltip,
} from 'recharts';
import {
  Accessibility, Users, UserCheck, CreditCard, UsersRound, AlertTriangle,
  LogIn, LogOut, UserPlus, FileEdit, IdCard, Printer, Ban, Link,
} from 'lucide-react';
import useAuthStore from '../../stores/authStore';
import { dashboardService } from '../../services/dashboardService';

const DEPTS = [
  { key: 'PWD',            label: 'Person with Disability', accent: '#1E40AF', light: '#EFF6FF', lineColor: '#3B82F6', Icon: Accessibility },
  { key: 'SOLO_PARENT',    label: 'Solo Parent',            accent: '#9F1239', light: '#FFF1F2', lineColor: '#E11D48', Icon: Users },
  { key: 'SENIOR_CITIZEN', label: 'Senior Citizen',         accent: '#92400E', light: '#FFFBEB', lineColor: '#D97706', Icon: UserCheck },
];

const ROLE_COLORS = ['#3B82F6', '#E11D48', '#D97706'];

const ACTION_ICONS = {
  LOGIN: LogIn, LOGOUT: LogOut, USER_CREATED: UserPlus, USER_UPDATED: FileEdit,
  ID_GENERATED: IdCard, ID_RELEASED: Printer, ID_REPRINTED: Printer, ID_REVOKED: Ban, BLOCKCHAIN: Link,
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatMonth(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-PH', { month: 'short', year: '2-digit' });
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const DEPT_LABEL = { PWD: 'PWD', SOLO_PARENT: 'Solo Parent', SENIOR_CITIZEN: 'Senior Citizen' };

// ── system-wide KPI card (glass, inside banner) ──────────────
function KpiCard({ label, value, Icon, loading, warn, index }) {
  return (
    <div
      className="rounded-xl p-5 transition-all duration-200 hover:-translate-y-1 animate-fade-up"
      style={{
        background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.18)', boxShadow: '0 8px 32px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.12)',
        animationDelay: `${index * 70}ms`,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>{label}</p>
        <Icon className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.65)' }} strokeWidth={1.75} />
      </div>
      {loading ? (
        <div className="h-9 w-20 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
      ) : (
        <p className="font-serif text-3xl leading-none" style={{ color: warn && value > 0 ? '#FCD34D' : 'white' }}>
          {(value ?? 0).toLocaleString()}
        </p>
      )}
    </div>
  );
}

// ── per-department detail card (light) ───────────────────────
function DeptCard({ dept, c, loading, index }) {
  const Metric = ({ label, value, warn }) => (
    <div>
      <p className="text-xs mb-0.5" style={{ color: 'var(--color-muted)' }}>{label}</p>
      {loading
        ? <div className="h-6 w-10 rounded animate-pulse" style={{ backgroundColor: 'var(--color-surface-2)' }} />
        : <p className="font-serif text-xl leading-none" style={{ color: warn && value > 0 ? '#D97706' : 'var(--color-text-1)' }}>{(value ?? 0).toLocaleString()}</p>}
    </div>
  );
  return (
    <div
      className="bg-white rounded-xl p-5 animate-fade-up"
      style={{ boxShadow: 'var(--shadow-card)', borderLeft: `3px solid ${dept.accent}`, animationDelay: `${index * 80}ms` }}
    >
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: dept.light }}>
          <dept.Icon className="w-4 h-4" style={{ color: dept.accent }} strokeWidth={1.75} />
        </div>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-1)' }}>{dept.label}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Applicants" value={c.applicants} />
        <Metric label="Active IDs" value={c.activeIDs} />
        <Metric label="Partial" value={c.partial} warn />
      </div>
    </div>
  );
}

function buildUserPieData(userCounts) {
  if (!userCounts) return [];
  const totals = { admin: 0, encoder: 0, releasing_staff: 0 };
  Object.values(userCounts).forEach((d) => {
    totals.admin += d.admin ?? 0;
    totals.encoder += d.encoder ?? 0;
    totals.releasing_staff += d.releasing_staff ?? 0;
  });
  return [
    { name: 'Admin', value: totals.admin, color: ROLE_COLORS[0] },
    { name: 'Encoder', value: totals.encoder, color: ROLE_COLORS[1] },
    { name: 'Releasing Staff', value: totals.releasing_staff, color: ROLE_COLORS[2] },
  ].filter((e) => e.value > 0);
}

const LineTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--color-text-1)', color: '#fff', boxShadow: 'var(--shadow-md)' }}>
      <p className="font-semibold mb-1">{formatMonth(label)}</p>
      {payload.map((p) => <p key={p.dataKey} style={{ color: p.color }}>{p.name}: {p.value}</p>)}
    </div>
  );
};

function ActivityEntry({ entry, isLast }) {
  const action = (entry.action ?? '').toUpperCase().replace(/[^A-Z_]/g, '_');
  const Icon = ACTION_ICONS[action] ?? FileEdit;
  const userName = entry.userId ? `${entry.userId.firstName ?? ''} ${entry.userId.lastName ?? ''}`.trim() : 'System';
  const dept = DEPT_LABEL[entry.department] ?? entry.department ?? 'System';
  return (
    <div className="flex items-start gap-3 py-2.5" style={isLast ? undefined : { borderBottom: '1px solid var(--color-border)' }}>
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: '#47556918' }}>
        <Icon className="w-3.5 h-3.5" style={{ color: '#475569' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs leading-snug truncate" style={{ color: 'var(--color-text-1)' }}>{entry.description}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{userName} · {dept} · {timeAgo(entry.createdAt)}</p>
      </div>
    </div>
  );
}

export default function SuperAdminDashboard() {
  const { user } = useAuthStore();
  const displayName = user?.firstName || user?.username || 'Admin';

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-superadmin'],
    queryFn: dashboardService.getSuperadminDashboard,
    staleTime: 60_000,
  });

  const tc = data?.totalCounts ?? {};
  const uc = data?.userCounts ?? {};
  const grand = DEPTS.reduce((acc, d) => {
    const c = tc[d.key] ?? {};
    const u = uc[d.key] ?? {};
    acc.applicants += c.applicants ?? 0;
    acc.activeIDs += c.activeIDs ?? 0;
    acc.partial += c.partial ?? 0;
    acc.staff += (u.admin ?? 0) + (u.encoder ?? 0) + (u.releasing_staff ?? 0);
    return acc;
  }, { applicants: 0, activeIDs: 0, partial: 0, staff: 0 });

  const trendData = (data?.idTrend ?? []).map((r) => ({ ...r, label: formatMonth(r.month) }));
  const pieData = buildUserPieData(data?.userCounts);
  const totalUsers = pieData.reduce((s, e) => s + e.value, 0);
  const activity = data?.recentActivity ?? [];

  const KPIS = [
    { label: 'Total Applicants', value: grand.applicants, Icon: Users },
    { label: 'Active IDs', value: grand.activeIDs, Icon: CreditCard },
    { label: 'Total Staff', value: grand.staff, Icon: UsersRound },
    { label: 'Needs Completion', value: grand.partial, Icon: AlertTriangle, warn: true },
  ];

  return (
    <div className="animate-fade-up">
      {/* ── Banner + system-wide KPI cards ───────────────────────── */}
      <div className="rounded-2xl overflow-hidden mb-6 relative" style={{ background: 'linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="absolute top-0 right-0 w-72 h-72 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.04)', transform: 'translate(30%, -40%)' }} />
        <div className="absolute bottom-0 left-0 w-56 h-56 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.03)', transform: 'translate(-30%, 40%)' }} />
        <div className="relative z-10 px-10 pt-10 pb-6">
          <h1 className="font-serif text-3xl text-white leading-tight mb-2">{greeting()}, {displayName}</h1>
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.875rem' }}>System Overview — All Departments</p>
        </div>
        <div className="relative z-10 grid grid-cols-4 gap-4 px-6 pb-6">
          {KPIS.map((k, i) => <KpiCard key={k.label} {...k} loading={isLoading} index={i} />)}
        </div>
      </div>

      {/* ── Per-department detail ─────────────────────────────────── */}
      <p className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-1)' }}>By Department</p>
      <div className="grid grid-cols-3 gap-4 mb-6">
        {DEPTS.map((dept, i) => <DeptCard key={dept.key} dept={dept} c={tc[dept.key] ?? {}} loading={isLoading} index={i} />)}
      </div>

      {/* ── ID trend + user donut ─────────────────────────────────── */}
      <div className="grid gap-5 mb-6" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="bg-white rounded-xl p-6" style={{ boxShadow: 'var(--shadow-card)' }}>
          <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-text-1)' }}>ID Issuance Trend</p>
          <p className="text-xs mb-5" style={{ color: 'var(--color-muted)' }}>Last 12 months — all departments</p>
          {isLoading ? (
            <div className="rounded-lg animate-pulse" style={{ height: '200px', backgroundColor: 'var(--color-surface)' }} />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<LineTooltip />} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }} formatter={(v) => DEPTS.find((d) => d.key === v)?.label ?? v} />
                {DEPTS.map((d) => (
                  <Line key={d.key} type="monotone" dataKey={d.key} name={d.key} stroke={d.lineColor} strokeWidth={2} dot={{ r: 3, fill: d.lineColor }} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl p-6 flex flex-col" style={{ boxShadow: 'var(--shadow-card)' }}>
          <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-text-1)' }}>User Distribution</p>
          <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>By role across all departments</p>
          {isLoading ? (
            <div className="flex-1 rounded-lg animate-pulse" style={{ minHeight: '160px', backgroundColor: 'var(--color-surface)' }} />
          ) : pieData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center rounded-lg" style={{ minHeight: '160px', backgroundColor: 'var(--color-surface)' }}>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No staff accounts yet</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={64} paddingAngle={3} dataKey="value">
                    {pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <PieTooltip formatter={(v, n) => [`${v} users`, n]} contentStyle={{ fontSize: '11px', borderRadius: '8px', border: '1px solid var(--color-border)' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="w-full space-y-1.5">
                {pieData.map((e) => (
                  <div key={e.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                      <span style={{ color: 'var(--color-muted)' }}>{e.name}</span>
                    </div>
                    <span className="font-semibold" style={{ color: 'var(--color-text-1)' }}>{e.value} / {totalUsers}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent activity + staff per department ────────────────── */}
      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="bg-white rounded-xl p-6 flex flex-col" style={{ boxShadow: 'var(--shadow-card)' }}>
          <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-text-1)' }}>Recent Activity</p>
          <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>System-wide — last 15 events</p>
          {isLoading ? (
            <div className="space-y-3 flex-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-lg animate-pulse flex-shrink-0" style={{ backgroundColor: 'var(--color-surface-2)' }} />
                  <div className="flex-1 space-y-1.5 pt-1">
                    <div className="h-2.5 rounded animate-pulse" style={{ width: `${[70, 85, 60, 75, 55][i]}%`, backgroundColor: 'var(--color-surface-2)' }} />
                    <div className="h-2 rounded animate-pulse" style={{ width: '40%', backgroundColor: 'var(--color-surface-2)' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.length === 0 ? (
            <div className="flex-1 flex items-center justify-center rounded-lg" style={{ backgroundColor: 'var(--color-surface)', minHeight: '120px' }}>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No activity yet</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto" style={{ maxHeight: '320px' }}>
              {activity.map((entry, idx) => <ActivityEntry key={entry._id ?? idx} entry={entry} isLast={idx === activity.length - 1} />)}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl p-6" style={{ boxShadow: 'var(--shadow-card)' }}>
          <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-text-1)' }}>Staff per Department</p>
          <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>Active accounts by role</p>
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--color-muted)' }}>
                <th className="text-left font-medium py-2">Dept</th>
                <th className="text-right font-medium py-2">Admin</th>
                <th className="text-right font-medium py-2">Enc.</th>
                <th className="text-right font-medium py-2">Rel.</th>
                <th className="text-right font-medium py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {DEPTS.map((d) => {
                const u = uc[d.key] ?? {};
                const tot = (u.admin ?? 0) + (u.encoder ?? 0) + (u.releasing_staff ?? 0);
                return (
                  <tr key={d.key} style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-1)' }}>
                    <td className="py-2.5 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.accent }} />
                      {DEPT_LABEL[d.key]}
                    </td>
                    <td className="text-right">{u.admin ?? 0}</td>
                    <td className="text-right">{u.encoder ?? 0}</td>
                    <td className="text-right">{u.releasing_staff ?? 0}</td>
                    <td className="text-right font-semibold">{tot}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: '2px solid var(--color-border)', color: 'var(--color-text-1)' }}>
                <td className="py-2.5 font-semibold">Total</td>
                <td className="text-right font-semibold">{DEPTS.reduce((s, d) => s + (uc[d.key]?.admin ?? 0), 0)}</td>
                <td className="text-right font-semibold">{DEPTS.reduce((s, d) => s + (uc[d.key]?.encoder ?? 0), 0)}</td>
                <td className="text-right font-semibold">{DEPTS.reduce((s, d) => s + (uc[d.key]?.releasing_staff ?? 0), 0)}</td>
                <td className="text-right font-semibold">{grand.staff}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
