import axios from 'axios';
import useAuthStore from '../stores/authStore';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
});

// ── Request interceptor — attach current access token ────────
api.interceptors.request.use(
  (config) => {
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor — silent token refresh on 401 ───────
let isRefreshing = false;
let pendingQueue = [];   // requests that arrived while refresh was in flight

function drainQueue(error, token) {
  pendingQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token)
  );
  pendingQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalReq = error.config;

    // Only intercept 401s that have not already been retried
    if (error.response?.status !== 401 || originalReq._retried) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      // Another refresh is already in flight — queue this request
      return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve, reject });
      }).then((token) => {
        originalReq.headers.Authorization = `Bearer ${token}`;
        return api(originalReq);
      });
    }

    originalReq._retried = true;
    isRefreshing = true;

    const { refreshToken, logout, setTokens } = useAuthStore.getState();

    if (!refreshToken) {
      isRefreshing = false;
      logout();
      if (window.location.pathname !== '/login') window.location.href = '/login';
      return Promise.reject(error);
    }

    try {
      // Use a fresh axios instance to avoid re-triggering this interceptor
      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
      const { accessToken: newAccess, refreshToken: newRefresh } = data;

      setTokens(newAccess, newRefresh);
      drainQueue(null, newAccess);

      originalReq.headers.Authorization = `Bearer ${newAccess}`;
      return api(originalReq);
    } catch (refreshErr) {
      drainQueue(refreshErr, null);
      logout();
      if (window.location.pathname !== '/login') window.location.href = '/login';
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  }
);

export default api;
