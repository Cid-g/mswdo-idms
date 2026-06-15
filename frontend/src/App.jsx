import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './stores/authStore';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';

// Public pages
import LoginPage        from './pages/LoginPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import VerificationPage from './pages/VerificationPage';

// SuperAdmin pages
import SuperAdminDashboard  from './pages/superadmin/DashboardPage';
import ManageAdminsPage     from './pages/superadmin/ManageAdminsPage';
import SuperAdminAuditLogs  from './pages/superadmin/AuditLogsPage';
import BlockchainPage       from './pages/superadmin/BlockchainPage';

// Admin pages
import AdminDashboard       from './pages/admin/DashboardPage';
import StaffPage            from './pages/admin/StaffPage';
import CreateStaffPage      from './pages/admin/CreateStaffPage';
import IDTemplatesPage      from './pages/admin/IDTemplatesPage';
import TemplatePlacerEditor from './pages/admin/TemplatePlacerEditor';
import AdminAuditLogs       from './pages/admin/AuditLogsPage';
import ReportsPage          from './pages/admin/ReportsPage';

// Shared pages
import AccountSettingsPage from './pages/AccountSettingsPage';

// Staff pages
import ApplicantsPage      from './pages/staff/ApplicantsPage';
import NewApplicantPage    from './pages/staff/NewApplicantPage';
import ApplicantDetailPage from './pages/staff/ApplicantDetailPage';
import IDCardPage          from './pages/staff/IDCardPage';
import BatchPrintPage      from './pages/staff/BatchPrintPage';

const ROLE_HOME = {
  SUPERADMIN:      '/superadmin/dashboard',
  ADMIN:           '/admin/dashboard',
  ENCODER:         '/staff/applicants',
  RELEASING_STAFF: '/staff/applicants',
};

/** Root "/" — redirects based on current role, or to /login if not authenticated */
function RootRedirect() {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />;
  return <Navigate to={ROLE_HOME[user.role] ?? '/login'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── Public ─────────────────────────────────────────── */}
        <Route path="/login"        element={<LoginPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="/verify"       element={<VerificationPage />} />
        <Route path="/"             element={<RootRedirect />} />

        {/* ── SuperAdmin ─────────────────────────────────────── */}
        <Route
          path="/superadmin/*"
          element={
            <ProtectedRoute allowedRoles={['SUPERADMIN']}>
              <AppLayout>
                <Routes>
                  <Route path="dashboard"  element={<SuperAdminDashboard />} />
                  <Route path="users"      element={<ManageAdminsPage />} />
                  <Route path="audit-logs" element={<SuperAdminAuditLogs />} />
                  <Route path="blockchain" element={<BlockchainPage />} />
                  <Route path="settings"  element={<AccountSettingsPage />} />
                  <Route path="*" element={<Navigate to="/superadmin/dashboard" replace />} />
                </Routes>
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* ── Admin ──────────────────────────────────────────── */}
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <AppLayout>
                <Routes>
                  <Route path="dashboard"  element={<AdminDashboard />} />
                  <Route path="staff"      element={<StaffPage />} />
                  <Route path="staff/new"  element={<CreateStaffPage />} />
                  <Route path="templates"            element={<IDTemplatesPage />} />
                  <Route path="templates/editor/:id" element={<TemplatePlacerEditor />} />
                  <Route path="audit-logs" element={<AdminAuditLogs />} />
                  <Route path="reports"    element={<ReportsPage />} />
                  <Route path="settings"  element={<AccountSettingsPage />} />
                  <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
                </Routes>
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* ── Staff (Encoder + Releasing Staff) ──────────────── */}
        <Route
          path="/staff/*"
          element={
            <ProtectedRoute allowedRoles={['ENCODER', 'RELEASING_STAFF']}>
              <AppLayout>
                <Routes>
                  <Route path="applicants"             element={<ApplicantsPage />} />
                  <Route path="applicants/new"         element={<NewApplicantPage />} />
                  <Route path="applicants/:id"         element={<ApplicantDetailPage />} />
                  <Route path="templates"              element={<IDTemplatesPage />} />
                  <Route path="templates/editor/:id"   element={<TemplatePlacerEditor />} />
                  <Route path="applicants/:id/id-card"  element={<IDCardPage />} />
                  <Route path="batch-print"            element={<BatchPrintPage />} />
                  <Route path="settings"               element={<AccountSettingsPage />} />
                  <Route path="*" element={<Navigate to="/staff/applicants" replace />} />
                </Routes>
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* ── Catch-all ──────────────────────────────────────── */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
