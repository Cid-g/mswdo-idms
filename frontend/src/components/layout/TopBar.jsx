import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileText, ClipboardList,
  LogOut, ChevronDown, Settings, FileBarChart,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import useAuthStore from '../../stores/authStore';
import api from '../../services/api';

// ── Theme maps ─────────────────────────────────────────────────────────────────
const DEPT_ACCENT = {
  PWD:            '#1E40AF',
  SOLO_PARENT:    '#9F1239',
  SENIOR_CITIZEN: '#92400E',
};
const DEPT_ACCENT_LIGHT = {
  PWD:            '#EFF6FF',
  SOLO_PARENT:    '#FFF1F2',
  SENIOR_CITIZEN: '#FFFBEB',
};
const DEPT_LABEL = {
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

// ── Nav items per role ─────────────────────────────────────────────────────────
function getNavItems(role) {
  if (role === 'SUPERADMIN') return [
    { icon: LayoutDashboard, label: 'Dashboard',     path: '/superadmin/dashboard' },
    { icon: Users,           label: 'Manage Admins', path: '/superadmin/users' },
    { icon: ClipboardList,   label: 'Activity History', path: '/superadmin/audit-logs' },
  ];
  if (role === 'ADMIN') return [
    { icon: LayoutDashboard, label: 'Dashboard',   path: '/admin/dashboard' },
    { icon: Users,           label: 'Staff',        path: '/admin/staff' },
    { icon: FileText,        label: 'ID Templates', path: '/admin/templates' },
    { icon: FileBarChart,    label: 'Reports',      path: '/admin/reports' },
    { icon: ClipboardList,   label: 'Activity History', path: '/admin/audit-logs' },
  ];
  return [
    { icon: Users,    label: 'Applicants',   path: '/staff/applicants' },
    { icon: FileText, label: 'ID Templates', path: '/staff/templates' },
  ];
}

// ── TopBar ─────────────────────────────────────────────────────────────────────
export default function TopBar() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user, refreshToken, logout } = useAuthStore();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const accent      = DEPT_ACCENT[user?.department]      ?? '#475569';
  const accentLight = DEPT_ACCENT_LIGHT[user?.department] ?? '#F1F5F9';
  const navItems    = getNavItems(user?.role);
  const initials    = user
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

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    if (!dropdownOpen) return;
    function onOutsideClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setDropdownOpen(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [dropdownOpen]);

  // Route changes close the menu on the next task without synchronously setting state in the effect.
  useEffect(() => {
    const timer = window.setTimeout(() => setDropdownOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  return (
    <header
      className="h-16 flex-shrink-0 flex items-center justify-between px-6 bg-white"
      style={{
        borderBottom: `2px solid ${accent}`,
        boxShadow: '0 1px 12px rgba(0,0,0,0.06)',
        position: 'relative',
        zIndex: 40,
      }}
      aria-label="Main navigation"
    >
      {/* ── Left: Logo + dept pill ──────────────────────────────── */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <img
          src="/GERONA-LOGO-small-scaled.png"
          className="w-8 h-8 object-contain flex-shrink-0"
          alt="Municipality of Gerona Seal"
        />
        <div className="leading-none">
          <span className="text-[15px] font-bold text-text-1 tracking-tight">MSWDO</span>
          <span className="text-[15px] font-normal text-muted ml-1">IDMS</span>
        </div>

        <div className="w-px h-5 flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />

        {user?.department ? (
          <span
            className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
            style={{ backgroundColor: accentLight, color: accent }}
          >
            {DEPT_LABEL[user.department]}
          </span>
        ) : (
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
            System
          </span>
        )}
      </div>

      {/* ── Center: Nav links ───────────────────────────────────── */}
      <nav className="flex items-center gap-0.5" aria-label="Primary navigation">
        {navItems.map((item) => {
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150',
              )}
              style={active
                ? { backgroundColor: accentLight, color: accent }
                : { color: 'var(--color-text-2)' }
              }
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                  e.currentTarget.style.color = 'var(--color-text-1)';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--color-text-2)';
                }
              }}
            >
              <item.icon
                className="w-4 h-4 flex-shrink-0"
                strokeWidth={active ? 2.25 : 1.75}
                aria-hidden="true"
              />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* ── Right: Avatar + dropdown ────────────────────────────── */}
      <div className="relative flex-shrink-0" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((current) => !current)}
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
          aria-label="Open user menu"
          className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full transition-colors hover:bg-surface cursor-pointer"
        >
          {/* Avatar circle */}
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
            style={{ backgroundColor: accent }}
          >
            {initials}
          </div>
          <span className="text-sm font-medium text-text-1 hidden md:block leading-none">
            {user?.firstName}
          </span>
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 transition-transform duration-200 flex-shrink-0',
              dropdownOpen && 'rotate-180'
            )}
            style={{ color: 'var(--color-muted)' }}
            aria-hidden="true"
          />
        </button>

        {/* ── Dropdown panel ──────────────────────────────────── */}
        {dropdownOpen && (
          <div
            className="absolute right-0 top-full mt-2.5 w-64 bg-white rounded-2xl overflow-hidden animate-fade-up"
            style={{
              boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.05)',
              border: '1px solid var(--color-border)',
              transformOrigin: 'top right',
            }}
            role="menu"
          >
            {/* Profile card */}
            <div
              className="px-4 py-4"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                  style={{ backgroundColor: accent }}
                >
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-1 leading-tight truncate">
                    {user?.firstName} {user?.lastName}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span
                      className="inline-flex text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: accentLight, color: accent }}
                    >
                      {ROLE_LABEL[user?.role] ?? user?.role}
                    </span>
                    {user?.department && (
                      <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                        {DEPT_LABEL[user.department]}
                      </span>
                    )}
                  </div>
                  {user?.email && (
                    <p className="text-[11px] mt-1 truncate" style={{ color: 'var(--color-muted)' }}>
                      {user.email}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-2" role="none">
              <button
                onClick={() => { navigate(SETTINGS_PATH[user?.role] ?? '/'); setDropdownOpen(false); }}
                role="menuitem"
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left"
                style={{ color: 'var(--color-text-2)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-surface)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <Settings className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                Account Settings
              </button>
              <button
                onClick={handleLogout}
                role="menuitem"
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left"
                style={{ color: 'var(--color-danger)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-danger-bg)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <LogOut className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
