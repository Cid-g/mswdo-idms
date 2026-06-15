import api from './api';

export async function generateIDRecord(applicantId) {
  const { data } = await api.post('/id-records', { applicantId });
  return data;
}

export async function getIDRecordByApplicant(applicantId) {
  const { data } = await api.get('/id-records', { params: { applicantId } });
  return data;
}

export async function fetchIDImageBlob(idRecordId) {
  const response = await api.get(`/id-records/${idRecordId}/image`, { responseType: 'blob' });
  return response.data;
}

export async function fetchIDBackImageBlob(idRecordId) {
  const response = await api.get(`/id-records/${idRecordId}/image/back`, { responseType: 'blob' });
  return response.data;
}

export async function releaseID(idRecordId) {
  const { data } = await api.post(`/id-records/${idRecordId}/release`);
  return data;
}

export async function reprintID(idRecordId) {
  const { data } = await api.post(`/id-records/${idRecordId}/reprint`);
  return data;
}

export async function revokeID(idRecordId, reason) {
  const { data } = await api.post(`/id-records/${idRecordId}/revoke`, { reason });
  return data;
}
