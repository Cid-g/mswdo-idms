import api from './api';

export async function getBlockchainStatus(idRecordId) {
  const { data } = await api.get(`/blockchain/status/${idRecordId}`);
  return data;
}

export async function verifyIntegrity(idNumber) {
  const { data } = await api.get(`/blockchain/verify/${idNumber}`);
  return data;
}

export async function anchorRecord(idRecordId) {
  const { data } = await api.post(`/blockchain/anchor/${idRecordId}`);
  return data;
}

// ── Super-admin blockchain page ──────────────────────────────

export async function getBlockchainHealth() {
  const { data } = await api.get('/blockchain/health');
  return data;
}

export async function getAnchoredRecords() {
  const { data } = await api.get('/blockchain/anchors');
  return data;
}

export async function simulateTamper(idNumber, field) {
  const { data } = await api.get(`/blockchain/simulate-tamper/${idNumber}`, { params: { field } });
  return data;
}
