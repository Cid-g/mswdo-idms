import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Lock, Loader2, Camera, User } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import useAuthStore from '../stores/authStore';
import { userService } from '../services/userService';

const DEPT_GRADIENT = {
  PWD:            'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 60%, #2563EB 100%)',
  SOLO_PARENT:    'linear-gradient(135deg, #881337 0%, #9F1239 60%, #BE123C 100%)',
  SENIOR_CITIZEN: 'linear-gradient(135deg, #78350F 0%, #92400E 60%, #B45309 100%)',
};
const DEPT_LABEL = { PWD: 'PWD', SOLO_PARENT: 'Solo Parent', SENIOR_CITIZEN: 'Senior Citizen' };
const ROLE_LABEL = {
  SUPERADMIN: 'Super Admin', ADMIN: 'Admin',
  ENCODER: 'Encoder', RELEASING_STAFF: 'Releasing Staff',
};

function getStrength(pwd) {
  if (!pwd) return null;
  let score = 0;
  if (pwd.length >= 8)          score++;
  if (pwd.length >= 12)         score++;
  if (/[A-Z]/.test(pwd))        score++;
  if (/[0-9]/.test(pwd))        score++;
  if (/[^a-zA-Z0-9]/.test(pwd)) score++;
  if (score <= 1) return { label: 'Weak',   color: 'bg-red-400',    width: 'w-1/4' };
  if (score === 2) return { label: 'Fair',   color: 'bg-orange-400', width: 'w-2/4' };
  if (score === 3) return { label: 'Good',   color: 'bg-yellow-400', width: 'w-3/4' };
  return            { label: 'Strong', color: 'bg-emerald-400', width: 'w-full' };
}

function Field({ label, required, error, children }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

const inputCls =
  'w-full border border-border rounded-xl px-3.5 py-2.5 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-muted/60 ' +
  'disabled:bg-surface disabled:cursor-not-allowed';

const pwSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword:     z.string().min(8, 'New password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export default function AccountSettingsPage() {
  const { user, updateUserData } = useAuthStore();

  const gradient =
    DEPT_GRADIENT[user?.department] ??
    'linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%)';

  // ── Profile state ────────────────────────────────────────────────────────
  const [firstName,    setFirstName]    = useState(user?.firstName ?? '');
  const [lastName,     setLastName]     = useState(user?.lastName  ?? '');
  const [avatarPreview, setAvatarPreview] = useState(user?.avatarUrl ?? null);
  const [avatarFile,   setAvatarFile]   = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const fileRef = useRef(null);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function handleProfileSave(e) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      toast.error('First and last name are required.');
      return;
    }
    setSavingProfile(true);
    try {
      const fd = new FormData();
      fd.append('firstName', firstName.trim());
      fd.append('lastName',  lastName.trim());
      if (avatarFile) fd.append('avatar', avatarFile);
      const updated = await userService.updateProfile(fd);
      updateUserData({
        firstName: updated.firstName,
        lastName:  updated.lastName,
        avatarUrl: updated.avatarUrl ?? null,
      });
      setAvatarFile(null);
      toast.success('Profile updated.');
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  }

  // ── Password state ───────────────────────────────────────────────────────
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(pwSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword');
  const strength    = getStrength(newPassword);

  async function onPasswordSubmit(data) {
    try {
      await userService.changePassword(data.currentPassword, data.newPassword);
      toast.success('Password changed successfully.');
      reset();
    } catch (err) {
      const apiErr = err.response?.data?.error;
      if (apiErr?.code === 'INVALID_CREDENTIALS') {
        setError('currentPassword', { message: 'Incorrect current password.' });
      } else {
        toast.error(apiErr?.message || 'Failed to change password.');
      }
    }
  }

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '?';

  return (
    <div className="max-w-2xl animate-fade-up">
      {/* ── Banner ── */}
      <div
        className="rounded-2xl overflow-hidden mb-6 relative"
        style={{ background: gradient, minHeight: '110px', boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none"
             style={{ background: 'rgba(255,255,255,0.05)', transform: 'translate(30%,-40%)' }} />
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none"
             style={{ background: 'rgba(255,255,255,0.04)', transform: 'translate(-30%,40%)' }} />
        <div className="relative z-10 px-8 py-6">
          <h1 className="font-serif text-3xl text-white leading-tight">Account Settings</h1>
          <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
            {user?.firstName} {user?.lastName}
            {user?.department && (
              <span className="ml-2 opacity-75">· {DEPT_LABEL[user.department]}</span>
            )}
          </p>
        </div>
      </div>

      {/* ── Profile Card ── */}
      <div
        className="bg-white border border-border rounded-2xl p-6 mb-4"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface">
            <User className="w-4 h-4" style={{ color: 'var(--color-muted)' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text-1)' }}>Profile</p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {ROLE_LABEL[user?.role] ?? user?.role}
            </p>
          </div>
        </div>

        <form onSubmit={handleProfileSave}>
          {/* Avatar + name row */}
          <div className="flex items-start gap-6 mb-5">
            {/* Avatar picker */}
            <div className="flex-shrink-0">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="relative group w-20 h-20 rounded-full overflow-hidden cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400"
                style={{ border: '2px solid var(--color-border)' }}
                aria-label="Change profile picture"
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt={initials} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-500 text-2xl font-bold">
                    {initials}
                  </div>
                )}
                {/* Overlay */}
                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  <Camera className="w-5 h-5 text-white mb-0.5" />
                  <span className="text-white text-[10px] font-medium">Change</span>
                </div>
              </button>
              <p className="text-[10px] text-center mt-1.5" style={{ color: 'var(--color-muted)' }}>
                JPG · PNG · WebP
              </p>
            </div>

            {/* Name fields */}
            <div className="flex-1 grid grid-cols-2 gap-3">
              <Field label="First Name" required>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  className={inputCls}
                  disabled={savingProfile}
                />
              </Field>
              <Field label="Last Name" required>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  className={inputCls}
                  disabled={savingProfile}
                />
              </Field>
              {/* Read-only username */}
              <Field label="Username">
                <input
                  type="text"
                  value={user?.username ?? ''}
                  readOnly
                  className={cn(inputCls, 'col-span-2 bg-surface cursor-default text-muted')}
                />
              </Field>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingProfile}
              className="px-5 py-2 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-900 transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {savingProfile ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
              ) : (
                'Save Profile'
              )}
            </button>
          </div>
        </form>
      </div>

      {/* ── Password Card ── */}
      <div
        className="bg-white border border-border rounded-2xl p-6"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface">
            <Lock className="w-4 h-4" style={{ color: 'var(--color-muted)' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text-1)' }}>
              Change Password
            </p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Minimum 8 characters required
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onPasswordSubmit)} className="space-y-4" noValidate>
          <Field label="Current Password" required error={errors.currentPassword?.message}>
            <div className="relative">
              <input
                {...register('currentPassword')}
                type={showCurrent ? 'text' : 'password'}
                placeholder="Enter your current password"
                className={cn(inputCls, 'pr-10', errors.currentPassword && 'border-danger focus:ring-red-200')}
                disabled={isSubmitting}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-2 transition-colors"
                aria-label={showCurrent ? 'Hide' : 'Show'}
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          <hr className="border-border" />

          <Field label="New Password" required error={errors.newPassword?.message}>
            <div className="relative">
              <input
                {...register('newPassword')}
                type={showNew ? 'text' : 'password'}
                placeholder="At least 8 characters"
                className={cn(inputCls, 'pr-10', errors.newPassword && 'border-danger focus:ring-red-200')}
                disabled={isSubmitting}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-2 transition-colors"
                aria-label={showNew ? 'Hide' : 'Show'}
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {strength && (
              <div className="mt-2">
                <div className="h-1 w-full bg-border rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all duration-300', strength.color, strength.width)} />
                </div>
                <p className={cn('text-xs mt-1', {
                  'text-red-500':     strength.label === 'Weak',
                  'text-orange-500':  strength.label === 'Fair',
                  'text-yellow-600':  strength.label === 'Good',
                  'text-emerald-600': strength.label === 'Strong',
                })}>
                  {strength.label} password
                </p>
              </div>
            )}
          </Field>

          <Field label="Confirm New Password" required error={errors.confirmPassword?.message}>
            <div className="relative">
              <input
                {...register('confirmPassword')}
                type={showConfirm ? 'text' : 'password'}
                placeholder="Re-enter new password"
                className={cn(inputCls, 'pr-10', errors.confirmPassword && 'border-danger focus:ring-red-200')}
                disabled={isSubmitting}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-2 transition-colors"
                aria-label={showConfirm ? 'Hide' : 'Show'}
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-900 transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer mt-1"
            >
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
              ) : (
                'Update Password'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
