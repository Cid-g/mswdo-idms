import { useNavigate } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import useAuthStore from '../stores/authStore';

const ROLE_HOME = {
  SUPERADMIN:      '/superadmin/dashboard',
  ADMIN:           '/admin/dashboard',
  ENCODER:         '/staff/applicants',
  RELEASING_STAFF: '/staff/applicants',
};

export default function UnauthorizedPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-6">
      <div className="text-center max-w-sm">
        <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-red-50 border border-red-100 flex items-center justify-center">
          <ShieldOff className="w-8 h-8 text-danger" />
        </div>
        <h1 className="font-display text-2xl text-text-1 mb-2">Access Denied</h1>
        <p className="text-sm text-muted mb-8">
          You don't have permission to view this page.
        </p>
        <button
          onClick={() => navigate(user ? (ROLE_HOME[user.role] ?? '/') : '/login', { replace: true })}
          className="px-6 h-10 rounded-lg bg-sa-700 text-white text-sm font-semibold hover:bg-sa-600 transition-colors"
        >
          Go to my dashboard
        </button>
      </div>
    </div>
  );
}
