import api from './api';

export const auditLogService = {
  getLogs: (params = {}) =>
    api.get('/audit-logs', { params }).then((r) => r.data),

  getActions: () =>
    api.get('/audit-logs/actions').then((r) => r.data),

  getUsers: () =>
    api.get('/audit-logs/users').then((r) => r.data),

  exportCsv: (params = {}) =>
    api.get('/audit-logs', {
      params:       { ...params, export: 'csv' },
      responseType: 'blob',
    }).then((r) => r.data),
};
