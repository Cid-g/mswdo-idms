import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileText, ClipboardList,
  LogOut, Settings, Printer, FileBarChart, ShieldCheck, CloudCog,
} from 'lucide-react';
import useAuthStore from '../../stores/authStore';
import api from '../../services/api';

// Bright accent variants — readable on dark backgrounds
const DEPT_ACCENT = {
  PWD:            '#60A5FA',
  SOLO_PARENT:    '#FB7185',
  SENIOR_CITIZEN: '#FCD34D',
};
const DEPT_ACTIVE_BG = {
  PWD:            'rgba(96,165,250,0.10)',
  SOLO_PARENT:    'rgba(251,113,133,0.10)',
  SENIOR_CITIZEN: 'rgba(252,211,77,0.10)',
};
const DEPT_LABEL_SHORT = {
  PWD: 'PWD', SOLO_PARENT: 'Solo Parent', SENIOR_CITIZEN: 'Senior Citizen',
};
const ROLE_LABEL = {
  SUPERADMIN: 'Super Admin', ADMIN: 'Admin',
  ENCODER: 'Encoder', RELEASING_STAFF: 'Releasing Staff',
};
const SETTINGS_PATH = {
  SUPERADMIN:      '/superadmin/settings',
  ADMIN:           '/admin/settings',
  ENCODER:         '/staff/settings',
  RELEASING_STAFF: '/staff/settings',
};

function getNavSections(role) {
  if (role === 'SUPERADMIN') return [
    { label: 'Overview', items: [
      { icon: LayoutDashboard, label: 'Dashboard',     path: '/superadmin/dashboard' },
    ]},
    { label: 'System', items: [
      { icon: Users,         label: 'Manage Admins', path: '/superadmin/users' },
      { icon: ClipboardList, label: 'Activity History', path: '/superadmin/audit-logs' },
      { icon: ShieldCheck,   label: 'Blockchain', path: '/superadmin/blockchain' },
      { icon: CloudCog,      label: 'Verification Sync', path: '/superadmin/verification-sync' },
    ]},
  ];
  if (role === 'ADMIN') return [
    { label: 'Overview', items: [
      { icon: LayoutDashboard, label: 'Dashboard',   path: '/admin/dashboard' },
    ]},
    { label: 'Management', items: [
      { icon: Users,         label: 'Staff',        path: '/admin/staff' },
      { icon: FileText,      label: 'ID Templates', path: '/admin/templates' },
      { icon: FileBarChart,  label: 'Reports',      path: '/admin/reports' },
      { icon: ClipboardList, label: 'Activity History', path: '/admin/audit-logs' },
    ]},
  ];
  return [
    { label: 'Records', items: [
      { icon: Users,    label: 'Applicants',   path: '/staff/applicants' },
      { icon: FileText, label: 'ID Templates', path: '/staff/templates' },
    ]},
    { label: 'Printing', items: [
      { icon: Printer, label: 'Batch Print', path: '/staff/batch-print' },
    ]},
  ];
}

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, refreshToken, logout } = useAuthStore();

  const accent   = DEPT_ACCENT[user?.department]    ?? '#94A3B8';
  const activeBg = DEPT_ACTIVE_BG[user?.department] ?? 'rgba(148,163,184,0.10)';
  const sections = getNavSections(user?.role);
  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '?';

  function isActive(path) {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  }

  async function handleLogout() {
    try {
      await api.post('/auth/logout', { refreshToken });
    } catch {
      // Server logout is best-effort; local logout must still complete.
    }
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <aside
      className="w-[230px] flex-shrink-0 flex flex-col h-screen select-none"
      style={{
        backgroundColor: '#111827',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '2px 0 12px rgba(0,0,0,0.25)',
      }}
      aria-label="Sidebar navigation"
    >
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-5 flex-shrink-0">
        <img
          src="/GERONA-LOGO-small-scaled.png"
          className="w-7 h-7 object-contain flex-shrink-0"
          alt="Municipality of Gerona Seal"
        />
        <div className="min-w-0">
          <p className="text-[15px] font-bold leading-tight tracking-tight text-white">
            MSWDO
          </p>
          <p className="text-[11px] font-medium mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
            ID Management System
          </p>
        </div>
      </div>

      {/* ── Dept context ──────────────────────────────────────────────────── */}
      {user?.department && (
        <div className="px-4 pb-4">
          <div
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
            style={{ backgroundColor: activeBg }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: accent }}
            />
            <span className="text-[11px] font-semibold" style={{ color: accent }}>
              {DEPT_LABEL_SHORT[user.department]}
            </span>
          </div>
        </div>
      )}

      {/* ── Separator ─────────────────────────────────────────────────────── */}
      <div className="mx-4 mb-3" style={{ height: '1px', backgroundColor: 'rgba(255,255,255,0.06)' }} />

      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <nav
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3"
        aria-label="Main navigation"
      >
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? 'mt-5' : ''}>
            {/* Section label */}
            <p
              className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-[0.10em]"
              style={{ color: 'rgba(255,255,255,0.28)' }}
            >
              {section.label}
            </p>

            {/* Items */}
            {section.items.map((item) => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  aria-current={active ? 'page' : undefined}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium text-left cursor-pointer transition-all duration-150"
                  style={
                    active
                      ? { backgroundColor: activeBg, color: accent }
                      : { color: 'rgba(255,255,255,0.50)' }
                  }
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)';
                      e.currentTarget.style.color = 'rgba(255,255,255,0.85)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'rgba(255,255,255,0.50)';
                    }
                  }}
                >
                  <item.icon
                    className="w-4 h-4 flex-shrink-0"
                    strokeWidth={active ? 2.25 : 1.75}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Separator ─────────────────────────────────────────────────────── */}
      <div className="mx-4" style={{ height: '1px', backgroundColor: 'rgba(255,255,255,0.06)' }} />

      {/* ── User section ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-3 pb-4">
        {/* Identity card */}
        <div
          className="flex items-center gap-3 px-3 py-3 rounded-xl mb-1"
          style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
        >
          <div
            className="w-9 h-9 rounded-full flex-shrink-0 overflow-hidden"
            style={{
              border: `1.5px solid ${accent}50`,
              boxShadow: `0 0 12px ${accent}18`,
            }}
          >
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={initials} className="w-full h-full object-cover" />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-[13px] font-bold"
                style={{ background: `linear-gradient(135deg, ${accent}40, ${accent}20)`, color: accent }}
              >
                {initials}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-white truncate leading-tight">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-[11px] truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {ROLE_LABEL[user?.role] ?? user?.role}
            </p>
          </div>
        </div>

        {/* Settings */}
        <button
          onClick={() => navigate(SETTINGS_PATH[user?.role] ?? '/')}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium text-left cursor-pointer transition-all duration-150"
          style={{ color: 'rgba(255,255,255,0.45)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.85)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'rgba(255,255,255,0.45)';
          }}
        >
          <Settings className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span>Settings</span>
        </button>

        {/* Sign Out */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium text-left cursor-pointer transition-all duration-150"
          style={{ color: 'rgba(248,113,113,0.55)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.10)';
            e.currentTarget.style.color = '#FCA5A5';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'rgba(248,113,113,0.55)';
          }}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
