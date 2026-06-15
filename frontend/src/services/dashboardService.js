import api from './api';

export const dashboardService = {
  getSuperadminDashboard: () =>
    api.get('/dashboard/superadmin').then((r) => r.data),

  getAdminDashboard: () =>
    api.get('/dashboard/admin').then((r) => r.data),
};
