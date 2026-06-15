import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Auth store — persisted to localStorage so the session survives page reloads.
 * accessToken will likely be expired after a reload; the axios interceptor handles
 * silent refresh using the stored refreshToken.
 */
const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      /** Called after a successful login or token refresh */
      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),

      /** Called by the axios interceptor after a silent token refresh */
      setTokens: (accessToken, refreshToken) =>
        set((state) => ({
          accessToken,
          refreshToken: refreshToken ?? state.refreshToken,
        })),

      /** Patches user fields in state (after profile update) */
      updateUserData: (updates) =>
        set((state) => ({ user: state.user ? { ...state.user, ...updates } : state.user })),

      /** Clears all auth state */
      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }),
    }),
    {
      name: 'mswdo-auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

export default useAuthStore;
