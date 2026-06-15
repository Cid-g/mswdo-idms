import useAuthStore from '../../stores/authStore';
import AuditLogsView from '../../components/AuditLogsView';

export default function AdminAuditLogs() {
  const { user } = useAuthStore();
  return <AuditLogsView isSuperAdmin={false} user={user} />;
}
