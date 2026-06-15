import api from './api';

// GET /templates?department=X  → { template, activeVersion }
export async function getTemplate(department) {
  const params = department ? { department } : {};
  const { data } = await api.get('/templates', { params });
  return data;
}

// POST /templates/versions  (multipart)
export async function createVersion({
  department,
  frontFile,
  backFile,
  useCurrentFront = false,
  useCurrentBack  = false,
  note            = '',
}) {
  const form = new FormData();
  if (department) form.append('department', department);
  if (frontFile)  form.append('frontFile', frontFile);
  if (backFile)   form.append('backFile',  backFile);
  form.append('useCurrentFront', String(useCurrentFront));
  form.append('useCurrentBack',  String(useCurrentBack));
  if (note) form.append('note', note);
  const { data } = await api.post('/templates/versions', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

// GET /templates/:templateId/versions
export async function listVersions(templateId) {
  const { data } = await api.get(`/templates/${templateId}/versions`);
  return data;
}

// GET /templates/versions/:versionId
export async function getVersion(versionId) {
  const { data } = await api.get(`/templates/versions/${versionId}`);
  return data;
}

// PATCH /templates/versions/:versionId/activate
export async function activateVersion(versionId) {
  const { data } = await api.patch(`/templates/versions/${versionId}/activate`);
  return data;
}

// PATCH /templates/versions/:versionId/config
export async function saveConfig(versionId, side, placeholderConfig) {
  const { data } = await api.patch(`/templates/versions/${versionId}/config`, {
    side,
    placeholderConfig,
  });
  return data;
}

// GET /templates/versions/:versionId/preview?side=front|back
export async function fetchPreviewBlob(versionId, side = 'front') {
  const response = await api.get(`/templates/versions/${versionId}/preview`, {
    params: { side },
    responseType: 'blob',
  });
  return response.data;
}
