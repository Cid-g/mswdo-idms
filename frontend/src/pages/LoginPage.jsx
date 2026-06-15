import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';
import { loginSchema } from '../lib/validations/loginSchema';
import useAuthStore from '../stores/authStore';
import api from '../services/api';

const ROLE_REDIRECTS = {
  SUPERADMIN:      '/superadmin/dashboard',
  ADMIN:           '/admin/dashboard',
  ENCODER:         '/staff/applicants',
  RELEASING_STAFF: '/staff/applicants',
};

export default function LoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated, user, setAuth } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState('');

  // Already authenticated → redirect
  useEffect(() => {
    if (isAuthenticated && user) {
      navigate(ROLE_REDIRECTS[user.role] ?? '/', { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema) });

  async function onSubmit(data) {
    setServerError('');
    try {
      const res = await api.post('/auth/login', data);
      const { accessToken, refreshToken, user } = res.data;
      setAuth(user, accessToken, refreshToken);
      navigate(ROLE_REDIRECTS[user.role] ?? '/', { replace: true });
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ??
        'Login failed. Please check your credentials.';
      setServerError(msg);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Left brand panel (40%) ─────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-2/5 flex-col items-center justify-center p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%)' }}
        aria-hidden="true"
      >
        {/* Decorative circles */}
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-white/[0.03] -translate-y-40 translate-x-40 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-96 h-96 rounded-full bg-white/[0.03] translate-y-48 -translate-x-48 pointer-events-none" />

        <div className="relative z-10 text-center">
          {/* Municipal seal */}
          <img
            src="/GERONA-LOGO-small-scaled.png"
            className="w-24 h-24 object-contain drop-shadow-lg mx-auto mb-8"
            alt="Municipality of Gerona Seal"
          />

          {/* Municipality name */}
          <h1 className="font-serif text-2xl text-white leading-tight mb-1">
            Municipality of Gerona
          </h1>
          <p className="text-white/70 text-sm tracking-widest uppercase mb-8">
            Tarlac
          </p>

          {/* System identity */}
          <p className="text-white/90 font-semibold text-lg leading-tight mb-1">
            MSWDO
          </p>
          <p className="text-white/60 text-sm">
            ID Management System
          </p>

          {/* Footer */}
          <div className="mt-14 pt-6 border-t border-white/10 space-y-1">
            <p className="text-white/40 text-xs italic">
              "Serving Our Community with Dignity"
            </p>
            <p className="text-white/25 text-xs mt-1">Secured by Hyperledger Fabric Blockchain</p>
          </div>
        </div>
      </div>

      {/* ── Right form panel (60%) ─────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-surface px-6 lg:px-16 overflow-y-auto">
        <div className="w-full max-w-md py-10">

          {/* Mobile logo — hidden on large screens */}
          <div className="lg:hidden text-center mb-8">
            <img
              src="/GERONA-LOGO-small-scaled.png"
              className="w-14 h-14 object-contain mx-auto mb-3"
              alt="Municipality of Gerona Seal"
            />
            <p className="text-sm text-muted font-medium">MSWDO · Gerona, Tarlac</p>
          </div>

          {/* Card */}
          <div
            className="bg-white rounded-2xl p-8"
            style={{ boxShadow: 'var(--shadow-card)' }}
          >
            {/* Heading */}
            <h2 className="font-serif text-3xl text-text-1 leading-tight mb-1">
              Welcome Back
            </h2>
            <p className="text-sm text-muted mb-8">
              Sign in to access the ID management system.
            </p>

            <form onSubmit={handleSubmit(onSubmit)} noValidate>
              {/* Username */}
              <div className="mb-5">
                <label
                  htmlFor="username"
                  className="block text-sm font-medium text-text-2 mb-1.5"
                >
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  {...register('username')}
                  disabled={isSubmitting}
                  placeholder="Enter your username"
                  className="w-full h-10 px-3 rounded-lg border border-border text-sm text-text-1 bg-white
                    placeholder:text-muted
                    focus:outline-none focus:ring-2 focus:ring-sa-600/25 focus:border-sa-600
                    disabled:bg-surface disabled:text-muted
                    transition-colors"
                  aria-describedby={errors.username ? 'username-error' : undefined}
                />
                {errors.username && (
                  <p id="username-error" role="alert" className="mt-1 text-xs text-danger">
                    {errors.username.message}
                  </p>
                )}
              </div>

              {/* Password */}
              <div className="mb-6">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-text-2 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    {...register('password')}
                    disabled={isSubmitting}
                    placeholder="Enter your password"
                    className="w-full h-10 px-3 pr-10 rounded-lg border border-border text-sm text-text-1 bg-white
                      placeholder:text-muted
                      focus:outline-none focus:ring-2 focus:ring-sa-600/25 focus:border-sa-600
                      disabled:bg-surface disabled:text-muted
                      transition-colors"
                    aria-describedby={errors.password ? 'password-error' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={isSubmitting}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-2 transition-colors disabled:opacity-40"
                  >
                    {showPassword
                      ? <EyeOff className="w-4 h-4" />
                      : <Eye className="w-4 h-4" />
                    }
                  </button>
                </div>
                {errors.password && (
                  <p id="password-error" role="alert" className="mt-1 text-xs text-danger">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {/* Server error alert */}
              {serverError && (
                <div
                  role="alert"
                  className="mb-5 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-danger-bg border border-red-200 text-sm text-red-700"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{serverError}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-10 rounded-lg bg-sa-700 hover:bg-sa-600 active:bg-sa-700
                  text-white text-sm font-semibold
                  flex items-center justify-center gap-2
                  transition-colors
                  disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {isSubmitting ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          </div>

          {/* Footer */}
          <p className="text-center mt-6 text-xs text-muted leading-relaxed">
            Municipal Social Welfare and Development Office
            <br />
            Gerona, Tarlac
          </p>
        </div>
      </div>
    </div>
  );
}
