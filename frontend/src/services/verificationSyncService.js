import api from './api';

export async function getVerificationSyncStatus() {
  const { data } = await api.get('/verification-sync/status');
  return data;
}

export async function retryVerificationSyncOperation(operationRef) {
  const { data } = await api.post(
    `/verification-sync/operations/${encodeURIComponent(operationRef)}/retry`
  );
  return data;
}

export async function resyncVerificationRecord({ idRecordRef, requestId }) {
  const { data } = await api.post(
    `/verification-sync/records/${encodeURIComponent(idRecordRef)}/resync`,
    { requestId }
  );
  return data;
}
