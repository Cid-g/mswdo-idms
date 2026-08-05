import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, KeyRound, UserCheck, UserX, Search, Users,
  Eye, EyeOff, Loader2, ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { userService } from '../../services/userService';
import useAuthStore from '../../stores/authStore';

// ─── Dept theme ─────────────────────────────────────────────────────────────

const DEPT_THEME = {
  PWD: {
    gradient: 'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 60%, #2563EB 100%)',
    accent:   '#1E40AF',
    light:    '#EFF6FF',
    label:    'Persons with Disability',
  },
  SOLO_PARENT: {
    gradient: 'linear-gradient(135deg, #881337 0%, #9F1239 60%, #BE123C 100%)',
    accent:   '#9F1239',
    light:    '#FFF1F2',
    label:    'Solo Parent',
  },
  SENIOR_CITIZEN: {
    gradient: 'linear-gradient(135deg, #78350F 0%, #92400E 60%, #B45309 100%)',
    accent:   '#92400E',
    light:    '#FFFBEB',
    label:    'Senior Citizen',
  },
};
const DEFAULT_THEME = {
  gradient: 'linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%)',
  accent:   '#475569',
  light:    '#F1F5F9',
  label:    'Department',
};

// ─── Constants ──────────────────────────────────────────────────────────────

const ROLE_LABEL = {
  ENCODER:         'Encoder',
  RELEASING_STAFF: 'Releasing Staff',
};

const STATUS_BADGE = {
  ACTIVE:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  INACTIVE:  'bg-gray-100 text-gray-600 border border-gray-200',
  SUSPENDED: 'bg-amber-50 text-amber-700 border border-amber-200',
};

const STATUS_LABEL = {
  ACTIVE:    'Active',
  INACTIVE:  'Inactive',
  SUSPENDED: 'Suspended',
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function buildUsername(firstName, lastName) {
  const first = firstName.toLowerCase().replace(/\s+/g, '');
  const last = lastName.toLowerCase().replace(/\s+/g, '');
  return first || last ? `${first}.${last}` : '';
}

// ─── Password strength ───────────────────────────────────────────────────────

function getStrength(pwd) {
  if (!pwd) return null;
  let score = 0;
  if (pwd.length >= 8)          score++;
  if (pwd.length >= 12)         score++;
  if (/[A-Z]/.test(pwd))       score++;
  if (/[0-9]/.test(pwd))       score++;
  if (/[^a-zA-Z0-9]/.test(pwd)) score++;
  if (score <= 1) return { label: 'Weak',   barCls: 'bg-red-400',    textCls: 'text-red-500',    width: 'w-1/4' };
  if (score === 2) return { label: 'Fair',   barCls: 'bg-orange-400', textCls: 'text-orange-500', width: 'w-2/4' };
  if (score === 3) return { label: 'Good',   barCls: 'bg-yellow-400', textCls: 'text-yellow-600', width: 'w-3/4' };
  return             { label: 'Strong', barCls: 'bg-emerald-400', textCls: 'text-emerald-600', width: 'w-full' };
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

const inputCls =
  'w-full border border-border rounded-lg px-3 py-2 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-200 placeholder:text-muted/60';

function Field({ label, required, error, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-2 mb-1">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

// ─── Skeleton row ────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-t border-border/60">
      {[140, 100, 80, 64, 90].map((w, i) => (
        <td key={i} className="px-4 py-3.5">
          <div
            className="h-4 rounded animate-pulse"
            style={{ width: w, backgroundColor: 'var(--color-surface-2)' }}
          />
        </td>
      ))}
      <td className="px-4 py-3.5">
        <div className="flex gap-1">
          {[1, 2, 3].map((k) => (
            <div
              key={k}
              className="w-7 h-7 rounded-lg animate-pulse"
              style={{ backgroundColor: 'var(--color-surface-2)' }}
            />
          ))}
        </div>
      </td>
    </tr>
  );
}

// ─── Add Staff Modal ─────────────────────────────────────────────────────────

function AddStaffModal({ theme, onClose, onCreated }) {
  const [firstName,       setFirstName]       = useState('');
  const [lastName,        setLastName]        = useState('');
  const [middleName,      setMiddleName]      = useState('');
  const [username,        setUsername]        = useState('');
  const [usernameEdited,  setUsernameEdited]  = useState(false);
  const [email,           setEmail]           = useState('');
  const [role,            setRole]            = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd,         setShowPwd]         = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);
  const [errors,          setErrors]          = useState({});
  const [loading,         setLoading]         = useState(false);

  const strength = getStrength(password);

  function clearErr(key) {
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate() {
    const e = {};
    if (!firstName.trim())      e.firstName = 'Required';
    if (!lastName.trim())       e.lastName  = 'Required';
    if (!username.trim())       e.username  = 'Required';
    if (!email.trim())          e.email     = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Invalid email address';
    if (!role)                  e.role      = 'Select a role';
    if (!password)              e.password  = 'Required';
    else if (password.length < 8) e.password = 'At least 8 characters';
    if (!confirmPassword)        e.confirmPassword = 'Required';
    else if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);
    try {
      await userService.createUser({
        firstName,
        lastName,
        middleName: middleName || undefined,
        username,
        email,
        role,
        password,
      });
      onCreated(`${firstName} ${lastName}`);
      onClose();
    } catch (err) {
      const apiErr = err.response?.data?.error;
      if (apiErr?.code === 'CONFLICT') {
        const field = apiErr.message?.toLowerCase().includes('username') ? 'username' : 'email';
        setErrors({ [field]: apiErr.message });
      } else {
        setErrors({ _: apiErr?.message || 'Failed to create account.' });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[92vh] overflow-y-auto animate-modal-in">

        <h2 className="font-display text-xl text-text-1 mb-1">Add Staff Member</h2>
        <p className="text-xs text-muted mb-4">
          Create a new Encoder or Releasing Staff account for your department.
        </p>

        {errors._ && (
          <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
            {errors._}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          {/* Name */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name" required error={errors.firstName}>
              <input
                type="text"
                value={firstName}
                onChange={(e) => {
                  const nextFirstName = e.target.value;
                  setFirstName(nextFirstName);
                  if (!usernameEdited) setUsername(buildUsername(nextFirstName, lastName));
                  clearErr('firstName');
                }}
                className={cn(inputCls, errors.firstName && 'border-danger')}
                disabled={loading}
              />
            </Field>
            <Field label="Last Name" required error={errors.lastName}>
              <input
                type="text"
                value={lastName}
                onChange={(e) => {
                  const nextLastName = e.target.value;
                  setLastName(nextLastName);
                  if (!usernameEdited) setUsername(buildUsername(firstName, nextLastName));
                  clearErr('lastName');
                }}
                className={cn(inputCls, errors.lastName && 'border-danger')}
                disabled={loading}
              />
            </Field>
          </div>

          <Field label="Middle Name" error={errors.middleName}>
            <input
              type="text"
              value={middleName}
              onChange={(e) => setMiddleName(e.target.value)}
              className={inputCls}
              placeholder="Optional"
              disabled={loading}
            />
          </Field>

          <Field label="Username" required error={errors.username}>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setUsernameEdited(true);
                clearErr('username');
              }}
              className={cn(inputCls, errors.username && 'border-danger')}
              autoComplete="off"
              disabled={loading}
            />
          </Field>

          <Field label="Email Address" required error={errors.email}>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearErr('email'); }}
              className={cn(inputCls, errors.email && 'border-danger')}
              disabled={loading}
            />
          </Field>

          <Field label="Role" required error={errors.role}>
            <select
              value={role}
              onChange={(e) => { setRole(e.target.value); clearErr('role'); }}
              className={cn(inputCls, 'cursor-pointer', errors.role && 'border-danger')}
              disabled={loading}
            >
              <option value="">Select role…</option>
              <option value="ENCODER">Encoder</option>
              <option value="RELEASING_STAFF">Releasing Staff</option>
            </select>
          </Field>

          <hr className="border-border" />

          <Field label="Password" required error={errors.password}>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearErr('password'); }}
                className={cn(inputCls, 'pr-10', errors.password && 'border-danger')}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-2 transition-colors"
                aria-label={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {strength && (
              <div className="mt-1.5">
                <div className="h-1 w-full bg-border rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all duration-300', strength.barCls, strength.width)} />
                </div>
                <p className={cn('text-xs mt-0.5', strength.textCls)}>{strength.label} password</p>
              </div>
            )}
          </Field>

          <Field label="Confirm Password" required error={errors.confirmPassword}>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); clearErr('confirmPassword'); }}
                className={cn(inputCls, 'pr-10', errors.confirmPassword && 'border-danger')}
                placeholder="Re-enter password"
                autoComplete="new-password"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-2 transition-colors"
                aria-label={showConfirm ? 'Hide confirm' : 'Show confirm'}
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2.5 border border-border rounded-xl text-sm text-text-2 hover:bg-surface transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2.5 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ backgroundColor: theme.accent }}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Creating…
                </>
              ) : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Modal ──────────────────────────────────────────────────────────────

function EditModal({ user, theme, onClose, onSave }) {
  const [form, setForm] = useState({
    firstName:  user.firstName,
    lastName:   user.lastName,
    middleName: user.middleName || '',
    email:      user.email,
  });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      setError('First name, last name, and email are required.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await onSave(user._id, form);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to update staff member.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-md animate-modal-in">
        <h2 className="font-display text-xl text-text-1 mb-1">Edit Staff Member</h2>
        <p className="text-xs text-muted mb-4">
          {user.firstName} {user.lastName}
          <span className="ml-1 text-text-2">(@{user.username})</span>
        </p>
        {error && (
          <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
            {error}
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name" required>
              <input
                type="text"
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                className={inputCls}
                disabled={loading}
              />
            </Field>
            <Field label="Last Name" required>
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                className={inputCls}
                disabled={loading}
              />
            </Field>
          </div>
          <Field label="Middle Name">
            <input
              type="text"
              value={form.middleName}
              onChange={(e) => setForm((f) => ({ ...f, middleName: e.target.value }))}
              className={inputCls}
              placeholder="Optional"
              disabled={loading}
            />
          </Field>
          <Field label="Email Address" required>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className={inputCls}
              disabled={loading}
            />
          </Field>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2.5 border border-border rounded-xl text-sm text-text-2 hover:bg-surface transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2.5 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: theme.accent }}
            >
              {loading ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Reset Password Modal ────────────────────────────────────────────────────

function ResetPasswordModal({ user, theme, onClose, onSave }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm]         = useState('');
  const [showPwd, setShowPwd]         = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (newPassword !== confirm)  { setError('Passwords do not match.'); return; }
    setError('');
    setLoading(true);
    try {
      await onSave(user._id, newPassword);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm animate-modal-in">
        <h2 className="font-display text-xl text-text-1 mb-1">Reset Password</h2>
        <p className="text-sm text-muted mb-4">
          For {user.firstName} {user.lastName}
          <span className="ml-1 text-text-2">(@{user.username})</span>
        </p>
        {error && (
          <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
            {error}
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="New Password" required>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={cn(inputCls, 'pr-10')}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                disabled={loading}
              />
              <button type="button" onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-2 transition-colors"
                aria-label={showPwd ? 'Hide password' : 'Show password'}>
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
          <Field label="Confirm Password" required>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={cn(inputCls, 'pr-10')}
                placeholder="Re-enter password"
                autoComplete="new-password"
                disabled={loading}
              />
              <button type="button" onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-2 transition-colors"
                aria-label={showConfirm ? 'Hide confirm' : 'Show confirm'}>
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={loading}
              className="flex-1 px-4 py-2.5 border border-border rounded-xl text-sm text-text-2 hover:bg-surface transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 px-4 py-2.5 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: theme.accent }}>
              {loading ? 'Resetting…' : 'Reset Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Confirm Status Modal ─────────────────────────────────────────────────────

function ConfirmStatusModal({ user, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);
  const isActive = user.status === 'ACTIVE';

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm(user._id, isActive ? 'INACTIVE' : 'ACTIVE');
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm animate-modal-in">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
          style={{ backgroundColor: isActive ? 'var(--color-danger-bg)' : 'var(--color-success-bg)' }}
        >
          <ShieldAlert className="w-5 h-5"
            style={{ color: isActive ? 'var(--color-danger)' : 'var(--color-success)' }} />
        </div>
        <h2 className="font-display text-xl text-text-1 mb-2">
          {isActive ? 'Deactivate Account?' : 'Activate Account?'}
        </h2>
        <p className="text-sm text-muted mb-6">
          {isActive
            ? `${user.firstName} ${user.lastName} will no longer be able to log in.`
            : `${user.firstName} ${user.lastName} will be able to log in again.`}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={loading}
            className="flex-1 px-4 py-2.5 border border-border rounded-xl text-sm text-text-2 hover:bg-surface transition-colors">
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={loading}
            className={cn(
              'flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-50',
              isActive ? 'bg-danger hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700',
            )}>
            {loading ? '…' : isActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StaffPage() {
  const { user: currentUser } = useAuthStore();
  const queryClient = useQueryClient();
  const theme = DEPT_THEME[currentUser?.department] ?? DEFAULT_THEME;

  const [search,       setSearch]       = useState('');
  const [roleFilter,   setRoleFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser,  setEditingUser]  = useState(null);
  const [resetPwdUser, setResetPwdUser] = useState(null);
  const [statusUser,   setStatusUser]   = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['staff', { role: roleFilter, status: statusFilter }],
    queryFn: () =>
      userService.getUsers({
        ...(roleFilter   && { role: roleFilter }),
        ...(statusFilter && { status: statusFilter }),
        limit: 100,
      }),
  });

  const users = (data?.data ?? []).filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.firstName.toLowerCase().includes(q) ||
      u.lastName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q)
    );
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => userService.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Staff member updated.');
    },
    onError: (err) => toast.error(err.response?.data?.error?.message || 'Failed to update.'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => userService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Account status updated.');
    },
    onError: (err) => toast.error(err.response?.data?.error?.message || 'Failed to update status.'),
  });

  const resetPwdMutation = useMutation({
    mutationFn: ({ id, newPassword }) => userService.resetPassword(id, newPassword),
    onSuccess: () => toast.success('Password reset successfully.'),
    onError: (err) => toast.error(err.response?.data?.error?.message || 'Failed to reset password.'),
  });

  const deptName = theme.label;

  return (
    <>
    <div className="animate-fade-up">

      {/* ── Dept gradient banner ────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden mb-6 relative"
        style={{ background: theme.gradient, boxShadow: 'var(--shadow-lg)', minHeight: '140px' }}
      >
        <div
          className="absolute top-0 right-0 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.06)', transform: 'translate(30%, -40%)' }}
        />
        <div className="relative z-10 px-10 py-10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
            >
              <Users className="w-6 h-6 text-white" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="font-display text-3xl text-white leading-tight mb-1">
                Staff Management
              </h1>
              <p style={{ color: 'rgba(255,255,255,0.70)', fontSize: '0.875rem' }}>
                {deptName} Department Staff
              </p>
            </div>
          </div>

          {/* Add Staff button — in banner for prominence */}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors"
            style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: '#fff' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.28)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.18)')}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add Staff
          </button>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Search by name or username…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-200"
            style={{ boxShadow: 'var(--shadow-card)' }}
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2.5 border border-border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-200 cursor-pointer"
          style={{ boxShadow: 'var(--shadow-card)' }}
        >
          <option value="">All Roles</option>
          <option value="ENCODER">Encoder</option>
          <option value="RELEASING_STAFF">Releasing Staff</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 border border-border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-200 cursor-pointer"
          style={{ boxShadow: 'var(--shadow-card)' }}
        >
          <option value="">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
      </div>

      {/* ── Table card ───────────────────────────────────────────── */}
      <div
        className="bg-white border border-border rounded-2xl overflow-hidden"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {['Name', 'Username', 'Role', 'Status', 'Date Added', 'Actions'].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wide"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [1, 2, 3].map((k) => <SkeletonRow key={k} />)
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-14 text-center">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-25" style={{ color: theme.accent }} />
                  <p className="text-sm font-medium text-text-2 mb-1">
                    {search || roleFilter || statusFilter
                      ? 'No staff match your filters.'
                      : 'No staff accounts yet.'}
                  </p>
                  {!search && !roleFilter && !statusFilter && (
                    <p className="text-xs text-muted mb-4">Add the first staff member for your department.</p>
                  )}
                  {!search && !roleFilter && !statusFilter && (
                    <button
                      onClick={() => setShowAddModal(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                      style={{ backgroundColor: theme.accent }}
                    >
                      <Plus className="w-4 h-4" />
                      Add First Staff Member
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isSelf = u._id === currentUser?.id;
                return (
                  <tr
                    key={u._id}
                    className="border-t border-border/60 transition-colors"
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.light)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '')}
                  >
                    <td className="px-4 py-3.5">
                      <p className="font-medium text-text-1">
                        {u.lastName}, {u.firstName}
                        {u.middleName ? ` ${u.middleName[0]}.` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 text-text-2">@{u.username}</td>
                    <td className="px-4 py-3.5">
                      <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600">
                        {ROLE_LABEL[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold',
                          STATUS_BADGE[u.status] ?? STATUS_BADGE.INACTIVE,
                        )}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                        {STATUS_LABEL[u.status] ?? u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-text-2">{formatDate(u.createdAt)}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => setEditingUser(u)}
                          title="Edit staff member"
                          className="p-1.5 rounded-lg text-muted hover:text-text-1 hover:bg-slate-100 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <button
                          onClick={() => setResetPwdUser(u)}
                          title="Reset password"
                          className="p-1.5 rounded-lg text-muted hover:text-text-1 hover:bg-slate-100 transition-colors"
                        >
                          <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        {!isSelf && (
                          <button
                            onClick={() => setStatusUser(u)}
                            title={u.status === 'ACTIVE' ? 'Deactivate account' : 'Activate account'}
                            className={cn(
                              'p-1.5 rounded-lg transition-colors',
                              u.status === 'ACTIVE'
                                ? 'text-muted hover:text-danger hover:bg-red-50'
                                : 'text-muted hover:text-emerald-600 hover:bg-emerald-50',
                            )}
                          >
                            {u.status === 'ACTIVE'
                              ? <UserX className="w-3.5 h-3.5" aria-hidden="true" />
                              : <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && data && (
        <p className="mt-2 text-xs text-muted text-right">
          {users.length} of {data.total} staff member{data.total !== 1 ? 's' : ''}
        </p>
      )}
    </div>

    {/* ── Modals — outside animated div so fixed positioning uses the viewport ── */}
    {showAddModal && (
      <AddStaffModal
        theme={theme}
        onClose={() => setShowAddModal(false)}
        onCreated={(name) => {
          queryClient.invalidateQueries({ queryKey: ['staff'] });
          toast.success(`Staff account for ${name} created successfully.`);
        }}
      />
    )}
    {editingUser && (
      <EditModal
        user={editingUser}
        theme={theme}
        onClose={() => setEditingUser(null)}
        onSave={(id, data) => updateMutation.mutateAsync({ id, data })}
      />
    )}
    {resetPwdUser && (
      <ResetPasswordModal
        user={resetPwdUser}
        theme={theme}
        onClose={() => setResetPwdUser(null)}
        onSave={(id, newPassword) => resetPwdMutation.mutateAsync({ id, newPassword })}
      />
    )}
    {statusUser && (
      <ConfirmStatusModal
        user={statusUser}
        onClose={() => setStatusUser(null)}
        onConfirm={(id, status) => statusMutation.mutateAsync({ id, status })}
      />
    )}
    </>
  );
}
