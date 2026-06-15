import api from './api';

export const reportsService = {
  listReports: () => api.get('/reports').then((r) => r.data.reports),
  getReport: (id) => api.get(`/reports/${id}`).then((r) => r.data),
  downloadReport: async (id) => {
    const res = await api.get(`/reports/${id}/export`, { responseType: 'blob' });
    const cd = res.headers['content-disposition'] || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `${id}.xlsx`;
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Delay revoke so Firefox doesn't cancel the queued download.
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  },
};
