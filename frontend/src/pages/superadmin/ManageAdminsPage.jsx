import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, KeyRound, UserCheck, UserX, Users, Eye, EyeOff, ShieldAlert, UserPlus, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { userService } from '../../services/userService';
import useAuthStore from '../../stores/authStore';

// ─── Constants ─────────────────────────────────────────────────────────────

const DEPT_BADGE = {
  PWD:            { cls: 'bg-blue-50 text-blue-800 border border-blue-200',    label: 'PWD' },
  SOLO_PARENT:    { cls: 'bg-rose-50 text-rose-800 border border-rose-200',    label: 'Solo Parent' },
  SENIOR_CITIZEN: { cls: 'bg-amber-50 text-amber-800 border border-amber-200', label: 'Senior Citizen' },
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

// ─── Password strength ───────────────────────────────────────────────────────

function getStrength(pwd) {
  if (!pwd) return null;
  let score = 0;
  if (pwd.length >= 8)           score++;
  if (pwd.length >= 12)          score++;
  if (/[A-Z]/.test(pwd))        score++;
  if (/[0-9]/.test(pwd))        score++;
  if (/[^a-zA-Z0-9]/.test(pwd)) score++;
  if (score <= 1) return { label: 'Weak',   barCls: 'bg-red-400',    textCls: 'text-red-500',    width: 'w-1/4' };
  if (score === 2) return { label: 'Fair',   barCls: 'bg-orange-400', textCls: 'text-orange-500', width: 'w-2/4' };
  if (score === 3) return { label: 'Good',   barCls: 'bg-yellow-400', textCls: 'text-yellow-600', width: 'w-3/4' };
  return              { label: 'Strong', barCls: 'bg-emerald-400', textCls: 'text-emerald-600', width: 'w-full' };
}

// ─── Shared input style ─────────────────────────────────────────────────────

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

// ─── Skeleton row ───────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-t border-border/60">
      {[80, 140, 100, 180, 64].map((w, i) => (
        <td key={i} className="px-4 py-3.5">
          <div
            className="h-4 rounded animate-pulse"
            style={{ width: w, backgroundColor: 'var(--color-surface-2)' }}
          />
        </td>
      ))}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1">
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

// ─── Create Admin Modal ─────────────────────────────────────────────────────

function CreateAdminModal({ onClose, onCreated }) {
  const [firstName,       setFirstName]       = useState('');
  const [lastName,        setLastName]        = useState('');
  const [middleName,      setMiddleName]      = useState('');
  const [username,        setUsername]        = useState('');
  const [usernameEdited,  setUsernameEdited]  = useState(false);
  const [email,           setEmail]           = useState('');
  const [department,      setDepartment]      = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd,         setShowPwd]         = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);
  const [errors,          setErrors]          = useState({});
  const [loading,         setLoading]         = useState(false);

  useEffect(() => {
    if (usernameEdited) return;
    const first = firstName.toLowerCase().replace(/\s+/g, '');
    const last  = lastName.toLowerCase().replace(/\s+/g, '');
    if (first || last) setUsername(`${first}.${last}`);
  }, [firstName, lastName, usernameEdited]);

  const strength = getStrength(password);

  function clearErr(key) { setErrors((e) => ({ ...e, [key]: undefined })); }

  function validate() {
    const e = {};
    if (!firstName.trim())   e.firstName   = 'Required';
    if (!lastName.trim())    e.lastName    = 'Required';
    if (!username.trim())    e.username    = 'Required';
    if (!email.trim())       e.email       = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Invalid email';
    if (!department)         e.department  = 'Select a department';
    if (!password)           e.password    = 'Required';
    else if (password.length < 8) e.password = 'At least 8 characters';
    if (!confirmPassword)    e.confirmPassword = 'Required';
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
        role: 'ADMIN',
        department,
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
        <h2 className="font-serif text-xl text-text-1 mb-1">Add Admin Account</h2>
        <p className="text-xs text-muted mb-4">
          Create a new department administrator account.
        </p>

        {errors._ && (
          <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
            {errors._}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          <Field label="Department" required error={errors.department}>
            <select
              value={department}
              onChange={(e) => { setDepartment(e.target.value); clearErr('department'); }}
              className={cn(inputCls, 'cursor-pointer', errors.department && 'border-danger')}
              disabled={loading}
            >
              <option value="">Select department…</option>
              <option value="PWD">Persons with Disability (PWD)</option>
              <option value="SOLO_PARENT">Solo Parent</option>
              <option value="SENIOR_CITIZEN">Senior Citizen</option>
            </select>
          </Field>

          <hr className="border-border" />

          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name" required error={errors.firstName}>
              <input
                type="text"
                value={firstName}
                onChange={(e) => { setFirstName(e.target.value); clearErr('firstName'); }}
                className={cn(inputCls, errors.firstName && 'border-danger')}
                disabled={loading}
              />
            </Field>
            <Field label="Last Name" required error={errors.lastName}>
              <input
                type="text"
                value={lastName}
                onChange={(e) => { setLastName(e.target.value); clearErr('lastName'); }}
                className={cn(inputCls, errors.lastName && 'border-danger')}
                disabled={loading}
              />
            </Field>
          </div>

          <Field label="Middle Name">
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
              onChange={(e) => { setUsername(e.target.value); setUsernameEdited(true); clearErr('username'); }}
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
              <button type="button" onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-2 transition-colors"
                aria-label={showPwd ? 'Hide password' : 'Show password'}>
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
              <button type="button" onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-2 transition-colors"
                aria-label={showConfirm ? 'Hide confirm' : 'Show confirm'}>
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={loading}
              className="flex-1 px-4 py-2.5 border border-border rounded-xl text-sm text-text-2 hover:bg-surface transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 px-4 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Creating…</>
              ) : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Modal ─────────────────────────────────────────────────────────────

function EditModal({ user, onClose, onSave }) {
  const [form, setForm] = useState({
    firstName:  user.firstName,
    lastName:   user.lastName,
    middleName: user.middleName || '',
    email:      user.email,
  });
  const [error, setError]   = useState('');
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
      setError(err.response?.data?.error?.message || 'Failed to update.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 w-full max-w-md animate-modal-in">
        <h2 className="font-display text-xl text-text-1 mb-1">Edit Admin Account</h2>
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
          <div
            className="rounded-lg px-3 py-2 text-xs text-muted"
            style={{ backgroundColor: 'var(--color-surface-2)' }}
          >
            Username cannot be changed after account creation.
          </div>
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
              className="flex-1 px-4 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-900 transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Reset Password Modal ───────────────────────────────────────────────────

function ResetPasswordModal({ user, onClose, onSave }) {
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
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-2 transition-colors"
                aria-label={showPwd ? 'Hide password' : 'Show password'}
              >
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
              className="flex-1 px-4 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-900 transition-colors disabled:opacity-50"
            >
              {loading ? 'Resetting…' : 'Reset Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Confirm Status Modal ───────────────────────────────────────────────────

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
          <ShieldAlert
            className="w-5 h-5"
            style={{ color: isActive ? 'var(--color-danger)' : 'var(--color-success)' }}
          />
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
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2.5 border border-border rounded-xl text-sm text-text-2 hover:bg-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={cn(
              'flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-50',
              isActive ? 'bg-danger hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700',
            )}
          >
            {loading ? '…' : isActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function ManageAdminsPage() {
  const { user: currentUser } = useAuthStore();
  const queryClient = useQueryClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser,  setEditingUser]  = useState(null);
  const [resetPwdUser, setResetPwdUser] = useState(null);
  const [statusUser,   setStatusUser]   = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['users', { role: 'ADMIN' }],
    queryFn: () => userService.getUsers({ role: 'ADMIN', limit: 20 }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => userService.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Admin account updated.');
    },
    onError: (err) => toast.error(err.response?.data?.error?.message || 'Failed to update.'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => userService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Account status updated.');
    },
    onError: (err) => toast.error(err.response?.data?.error?.message || 'Failed to update status.'),
  });

  const resetPwdMutation = useMutation({
    mutationFn: ({ id, newPassword }) => userService.resetPassword(id, newPassword),
    onSuccess: () => toast.success('Password reset successfully.'),
    onError: (err) => toast.error(err.response?.data?.error?.message || 'Failed to reset password.'),
  });

  const admins = data?.data ?? [];

  return (
    <>
    <div className="animate-fade-up">

      {/* ── Slate gradient banner ─────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden mb-6 relative"
        style={{
          background: 'linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%)',
          boxShadow: 'var(--shadow-lg)',
          minHeight: '140px',
        }}
      >
        <div
          className="absolute top-0 right-0 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.04)', transform: 'translate(30%, -40%)' }}
        />
        <div className="relative z-10 px-10 py-10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
            >
              <Users className="w-6 h-6 text-white" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="font-serif text-3xl text-white leading-tight mb-1">
                Manage Admins
              </h1>
              <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.875rem' }}>
                Department Administrator Accounts
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors"
            style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: '#fff' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.28)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.18)')}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add Admin
          </button>
        </div>
      </div>

      {/* ── Table card ───────────────────────────────────────────── */}
      <div
        className="bg-white border border-border rounded-2xl overflow-hidden"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        {isError ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted mb-3">Failed to load admin accounts.</p>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 text-sm border border-border rounded-lg text-text-2 hover:bg-surface transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Department', 'Admin Name', 'Username', 'Email', 'Status', 'Actions'].map((h) => (
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
              {isLoading
                ? [1, 2, 3].map((k) => <SkeletonRow key={k} />)
                : admins.length === 0
                  ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                          <Users className="w-6 h-6 text-slate-400" />
                        </div>
                        <p className="text-sm font-medium text-text-2 mb-1">No admin accounts yet</p>
                        <p className="text-xs text-muted mb-4">
                          Add administrators for each department to get started.
                        </p>
                        <button
                          onClick={() => setShowAddModal(true)}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-slate-800 hover:bg-slate-900 transition-colors"
                        >
                          <UserPlus className="w-4 h-4" />
                          Add First Admin
                        </button>
                      </td>
                    </tr>
                  )
                  : admins.map((admin) => {
                    const dept   = DEPT_BADGE[admin.department];
                    const status = STATUS_BADGE[admin.status] ?? STATUS_BADGE.INACTIVE;
                    const isSelf = admin._id === currentUser?.id;

                    return (
                      <tr
                        key={admin._id}
                        className="border-t border-border/60 transition-colors"
                        style={{ '--hover-bg': 'var(--color-surface)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ''}
                      >
                        {/* Department */}
                        <td className="px-4 py-3.5">
                          <span
                            className={cn(
                              'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold',
                              dept?.cls ?? 'bg-gray-100 text-gray-600 border border-gray-200',
                            )}
                          >
                            {dept?.label ?? admin.department}
                          </span>
                        </td>

                        {/* Name */}
                        <td className="px-4 py-3.5">
                          <p className="font-medium text-text-1">
                            {admin.firstName} {admin.lastName}
                          </p>
                          {admin.middleName && (
                            <p className="text-xs text-muted">{admin.middleName}</p>
                          )}
                        </td>

                        {/* Username */}
                        <td className="px-4 py-3.5 text-text-2">@{admin.username}</td>

                        {/* Email */}
                        <td className="px-4 py-3.5 text-text-2">{admin.email}</td>

                        {/* Status */}
                        <td className="px-4 py-3.5">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold',
                              status,
                            )}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                            {STATUS_LABEL[admin.status] ?? admin.status}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => setEditingUser(admin)}
                              title="Edit admin"
                              className="p-1.5 rounded-lg text-muted hover:text-text-1 hover:bg-slate-100 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => setResetPwdUser(admin)}
                              title="Reset password"
                              className="p-1.5 rounded-lg text-muted hover:text-text-1 hover:bg-slate-100 transition-colors"
                            >
                              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            {!isSelf && (
                              <button
                                onClick={() => setStatusUser(admin)}
                                title={admin.status === 'ACTIVE' ? 'Deactivate account' : 'Activate account'}
                                className={cn(
                                  'p-1.5 rounded-lg transition-colors',
                                  admin.status === 'ACTIVE'
                                    ? 'text-muted hover:text-danger hover:bg-red-50'
                                    : 'text-muted hover:text-emerald-600 hover:bg-emerald-50',
                                )}
                              >
                                {admin.status === 'ACTIVE'
                                  ? <UserX className="w-3.5 h-3.5" aria-hidden="true" />
                                  : <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        )}
      </div>

      {!isLoading && !isError && (
        <p className="mt-2 text-xs text-muted text-right">
          {admins.length} department admin{admins.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>

    {/* ── Modals — outside animated div so fixed positioning uses the viewport ── */}
    {showAddModal && (
      <CreateAdminModal
        onClose={() => setShowAddModal(false)}
        onCreated={(name) => {
          queryClient.invalidateQueries({ queryKey: ['users'] });
          toast.success(`Admin account for ${name} created successfully.`);
        }}
      />
    )}
    {editingUser && (
      <EditModal
        user={editingUser}
        onClose={() => setEditingUser(null)}
        onSave={(id, data) => updateMutation.mutateAsync({ id, data })}
      />
    )}
    {resetPwdUser && (
      <ResetPasswordModal
        user={resetPwdUser}
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
