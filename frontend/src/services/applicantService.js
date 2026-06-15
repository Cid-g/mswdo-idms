import api from './api';

export const applicantService = {
  getApplicants: (params) =>
    api.get('/applicants', { params }).then((r) => r.data),

  getApplicantById: (id) =>
    api.get(`/applicants/${id}`).then((r) => r.data),

  createApplicant: (data) =>
    api.post('/applicants', data).then((r) => r.data),

  updateApplicant: (id, data) =>
    api.patch(`/applicants/${id}`, data).then((r) => r.data),

  updatePwdDetails: (id, data) =>
    api.patch(`/applicants/${id}/pwd-details`, data).then((r) => r.data),

  updateSoloParentDetails: (id, data) =>
    api.patch(`/applicants/${id}/solo-parent-details`, data).then((r) => r.data),

  updateSeniorCitizenDetails: (id, data) =>
    api.patch(`/applicants/${id}/senior-citizen-details`, data).then((r) => r.data),

  // Phase 5 — photo: send cropped image blob as multipart
  // Note: do NOT set Content-Type header — axios auto-sets multipart boundary
  uploadPhoto: (id, blob) => {
    const form = new FormData();
    form.append('photo', blob, 'photo.png');
    return api.post(`/applicants/${id}/photo`, form).then((r) => r.data);
  },

  // Phase 5 — signature from canvas (base64 data URL)
  uploadSignatureBase64: (id, dataUrl) =>
    api.post(`/applicants/${id}/signature`, { signatureBase64: dataUrl }).then((r) => r.data),

  // Phase 5 — signature from file upload
  uploadSignatureFile: (id, file) => {
    const form = new FormData();
    form.append('signature', file, 'signature.png');
    return api.post(`/applicants/${id}/signature`, form).then((r) => r.data);
  },

  getFileUrl: (relPath) => relPath ? `/api/files/${relPath}` : null,

  // Fetch a protected file (/api/files/...) through the authenticated axios
  // instance and return an object URL safe to use in <img src>.
  fetchFileBlob: async (apiUrl) => {
    if (!apiUrl) return null;
    // axios baseURL is "/api", so strip the leading "/api" before calling
    const path = apiUrl.startsWith('/api') ? apiUrl.slice(4) : apiUrl;
    const r = await api.get(path, { responseType: 'blob' });
    return URL.createObjectURL(r.data);
  },
};
