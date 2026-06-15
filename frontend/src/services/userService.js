import api from './api';

export const userService = {
  getUsers: (params) => api.get('/users', { params }).then((r) => r.data),
  getUserById: (id) => api.get(`/users/${id}`).then((r) => r.data),
  createUser: (data) => api.post('/users', data).then((r) => r.data),
  updateUser: (id, data) => api.patch(`/users/${id}`, data).then((r) => r.data),
  updateStatus: (id, status) => api.patch(`/users/${id}/status`, { status }).then((r) => r.data),
  resetPassword: (id, newPassword) =>
    api.post(`/users/${id}/reset-password`, { newPassword }).then((r) => r.data),
  changePassword: (currentPassword, newPassword) =>
    api.patch('/users/me/password', { currentPassword, newPassword }).then((r) => r.data),
  updateProfile: (formData) =>
    api.patch('/users/me/profile', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
};
