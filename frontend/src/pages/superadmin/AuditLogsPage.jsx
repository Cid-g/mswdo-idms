import useAuthStore from '../../stores/authStore';
import AuditLogsView from '../../components/AuditLogsView';

export default function SuperAdminAuditLogs() {
  const { user } = useAuthStore();
  return <AuditLogsView isSuperAdmin={true} user={user} />;
}
