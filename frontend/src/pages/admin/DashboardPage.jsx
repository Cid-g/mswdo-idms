import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Users, CreditCard, AlertTriangle, XCircle,
  LogIn, LogOut, UserPlus, FileEdit, IdCard, Printer, Ban, Link,
} from 'lucide-react';
import useAuthStore from '../../stores/authStore';
import { dashboardService } from '../../services/dashboardService';
import SoloParentReports from '../../components/dashboard/SoloParentReports';
import PwdReports from '../../components/dashboard/PwdReports';
import SeniorCitizenReports from '../../components/dashboard/SeniorCitizenReports';

const DEPT_CONFIG = {
  PWD: {
    label:    'Persons with Disability',
    gradient: 'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 60%, #2563EB 100%)',
    accent:   '#1E40AF',
    barFill:  '#3B82F6',
  },
  SOLO_PARENT: {
    label:    'Solo Parent',
    gradient: 'linear-gradient(135deg, #881337 0%, #9F1239 60%, #BE123C 100%)',
    accent:   '#9F1239',
    barFill:  '#E11D48',
  },
  SENIOR_CITIZEN: {
    label:    'Senior Citizen',
    gradient: 'linear-gradient(135deg, #78350F 0%, #92400E 60%, #B45309 100%)',
    accent:   '#92400E',
    barFill:  '#D97706',
  },
};

const STAT_CARDS = [
  { label: 'Total Applicants', key: 'totalApplicants', Icon: Users,         color: null },
  { label: 'Active IDs',       key: 'activeIDs',       Icon: CreditCard,    color: null },
  { label: 'Needs Completion', key: 'partialRecords',  Icon: AlertTriangle, color: '#D97706' },
  { label: 'Revoked IDs',      key: 'revokedIDs',      Icon: XCircle,       color: '#DC2626' },
];

const ACTION_ICONS = {
  LOGIN:         LogIn,
  LOGOUT:        LogOut,
  USER_CREATED:  UserPlus,
  USER_UPDATED:  FileEdit,
  ID_GENERATED:  IdCard,
  ID_RELEASED:   Printer,
  ID_REPRINTED:  Printer,
  ID_REVOKED:    Ban,
  BLOCKCHAIN:    Link,
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
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-PH', { month: 'short' });
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ActivityEntry({ entry, accent, isLast }) {
  const action = (entry.action ?? '').toUpperCase().replace(/[^A-Z_]/g, '_');
  const IconComponent = ACTION_ICONS[action] ?? FileEdit;
  const userName = entry.userId
    ? `${entry.userId.firstName ?? ''} ${entry.userId.lastName ?? ''}`.trim()
    : 'System';

  return (
    <div className="flex items-start gap-3 py-2.5" style={isLast ? undefined : { borderBottom: '1px solid var(--color-border)' }}>
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: `${accent}18` }}
      >
        <IconComponent className="w-3.5 h-3.5" style={{ color: accent }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs leading-snug truncate" style={{ color: 'var(--color-text-1)' }}>
          {entry.description}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
          {userName} · {timeAgo(entry.createdAt)}
        </p>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs"
      style={{ background: 'var(--color-text-1)', color: '#fff', boxShadow: 'var(--shadow-md)' }}
    >
      <p className="font-semibold">{label}: {payload[0]?.value ?? 0} IDs</p>
    </div>
  );
};

export default function AdminDashboard() {
  const { user } = useAuthStore();
  const dept        = DEPT_CONFIG[user?.department] ?? DEPT_CONFIG.PWD;
  const displayName = user?.firstName || user?.username || 'Admin';

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-admin'],
    queryFn:  dashboardService.getAdminDashboard,
    staleTime: 60_000,
  });

  const trendData = (data?.monthlyTrend ?? []).map((r) => ({ ...r, label: formatMonth(r.month) }));

  return (
    <div className="animate-fade-up">
      {/* ── Dept gradient banner + glassmorphism stat cards ──────── */}
      <div
        className="rounded-2xl overflow-hidden mb-6 relative"
        style={{
          background: dept.gradient,
          boxShadow:  'var(--shadow-lg)',
        }}
      >
        <div
          className="absolute top-0 right-0 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.04)', transform: 'translate(30%, -40%)' }}
        />
        <div
          className="absolute bottom-0 left-0 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.03)', transform: 'translate(-30%, 40%)' }}
        />
        <div className="relative z-10 px-10 pt-10 pb-6">
          <h1 className="font-serif text-3xl text-white leading-tight mb-2">{dept.label}</h1>
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.875rem' }}>
            {greeting()}, {displayName} — Department Dashboard
          </p>
        </div>

        {/* ── 4 glassmorphism stat cards (inside banner) ── */}
        <div className="relative z-10 grid grid-cols-4 gap-4 px-6 pb-6">
          {STAT_CARDS.map((card, i) => {
            const value    = data?.[card.key] ?? 0;
            const numColor = card.color === '#D97706' ? '#FCD34D'
                           : card.color === '#DC2626' ? '#FCA5A5'
                           : 'white';
            return (
              <div
                key={card.key}
                className="rounded-xl p-5 transition-all duration-200 hover:-translate-y-1 animate-fade-up"
                style={{
                  background:           'rgba(255,255,255,0.10)',
                  backdropFilter:       'blur(14px)',
                  WebkitBackdropFilter: 'blur(14px)',
                  border:               '1px solid rgba(255,255,255,0.18)',
                  boxShadow:            '0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.12)',
                  animationDelay:       `${i * 70}ms`,
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {card.label}
                  </p>
                  <card.Icon
                    className="w-4 h-4 flex-shrink-0"
                    style={{ color: 'rgba(255,255,255,0.65)' }}
                    strokeWidth={1.75}
                  />
                </div>
                {isLoading ? (
                  <div className="h-9 w-20 rounded animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
                ) : (
                  <p className="font-serif text-3xl leading-none" style={{ color: numColor }}>
                    {value.toLocaleString()}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Chart + activity feed ──────────────────────────────────── */}
      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        {/* Bar chart */}
        <div className="bg-white rounded-xl p-6" style={{ boxShadow: 'var(--shadow-card)' }}>
          <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-text-1)' }}>
            Monthly ID Issuance
          </p>
          <p className="text-xs mb-5" style={{ color: 'var(--color-muted)' }}>Last 6 months</p>
          {isLoading ? (
            <div
              className="rounded-lg animate-pulse"
              style={{ height: '180px', backgroundColor: 'var(--color-surface)' }}
            />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: `${dept.accent}10` }} />
                <Bar dataKey="count" fill={dept.barFill} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Activity feed */}
        <div className="bg-white rounded-xl p-6 flex flex-col" style={{ boxShadow: 'var(--shadow-card)' }}>
          <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-text-1)' }}>
            Recent Activity
          </p>
          <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>Last 10 events</p>

          {isLoading ? (
            <div className="space-y-3 flex-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div
                    className="w-7 h-7 rounded-lg animate-pulse flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-surface-2)' }}
                  />
                  <div className="flex-1 space-y-1.5 pt-1">
                    <div
                      className="h-2.5 rounded animate-pulse"
                      style={{ width: `${[70, 85, 60, 75, 55][i]}%`, backgroundColor: 'var(--color-surface-2)' }}
                    />
                    <div
                      className="h-2 rounded animate-pulse"
                      style={{ width: '40%', backgroundColor: 'var(--color-surface-2)' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : !data?.recentActivity?.length ? (
            <div
              className="flex-1 flex items-center justify-center rounded-lg"
              style={{ backgroundColor: 'var(--color-surface)', minHeight: '120px' }}
            >
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No activity yet</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto" style={{ maxHeight: '220px' }}>
              {data.recentActivity.map((entry, idx) => (
                <ActivityEntry key={entry._id} entry={entry} accent={dept.accent} isLast={idx === data.recentActivity.length - 1} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Department-specific reports ─────────────────────────────── */}
      {!isLoading && data?.reports && (
        <>
          {user?.department === 'SOLO_PARENT' && <SoloParentReports reports={data.reports} dept={dept} />}
          {user?.department === 'PWD' && <PwdReports reports={data.reports} dept={dept} />}
          {user?.department === 'SENIOR_CITIZEN' && <SeniorCitizenReports reports={data.reports} dept={dept} />}
        </>
      )}
    </div>
  );
}
