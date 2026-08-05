import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { createUserSchema } from '../../lib/validations/createUserSchema';
import { userService } from '../../services/userService';
import useAuthStore from '../../stores/authStore';

const DEPT_GRADIENT = {
  PWD:            'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 60%, #2563EB 100%)',
  SOLO_PARENT:    'linear-gradient(135deg, #881337 0%, #9F1239 60%, #BE123C 100%)',
  SENIOR_CITIZEN: 'linear-gradient(135deg, #78350F 0%, #92400E 60%, #B45309 100%)',
};
const DEPT_LABEL = {
  PWD: 'Persons with Disability', SOLO_PARENT: 'Solo Parent', SENIOR_CITIZEN: 'Senior Citizen',
};

function buildUsername(firstName, lastName) {
  const first = firstName.toLowerCase().replace(/\s+/g, '');
  const last = lastName.toLowerCase().replace(/\s+/g, '');
  return first || last ? `${first}.${last}` : '';
}

// ─── Password strength ─────────────────────────────────────────────────────
function getStrength(pwd) {
  if (!pwd) return null;
  let score = 0;
  if (pwd.length >= 8)  score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^a-zA-Z0-9]/.test(pwd)) score++;
  if (score <= 1) return { label: 'Weak',   color: 'bg-red-400',    width: 'w-1/4' };
  if (score === 2) return { label: 'Fair',   color: 'bg-orange-400', width: 'w-2/4' };
  if (score === 3) return { label: 'Good',   color: 'bg-yellow-400', width: 'w-3/4' };
  return            { label: 'Strong', color: 'bg-emerald-400', width: 'w-full' };
}

// ─── Field wrapper ─────────────────────────────────────────────────────────
function Field({ label, required, error, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-2 mb-1.5">
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

// ─── Page ──────────────────────────────────────────────────────────────────
export default function CreateStaffPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const gradient = DEPT_GRADIENT[user?.department] ?? 'linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%)';
  const [showPwd,     setShowPwd]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      firstName: '', lastName: '', middleName: '',
      username: '', email: '', role: '',
      password: '', confirmPassword: '',
    },
  });

  const suggestedUsernameRef = useRef('');

  function updateSuggestedUsername(nextFirstName, nextLastName) {
    const suggestion = buildUsername(nextFirstName, nextLastName);
    const currentUsername = getValues('username');
    if (!currentUsername || currentUsername === suggestedUsernameRef.current) {
      setValue('username', suggestion, { shouldValidate: false, shouldDirty: true });
    }
    suggestedUsernameRef.current = suggestion;
  }

  const firstNameRegistration = register('firstName');
  const lastNameRegistration = register('lastName');

  const password = watch('password');
  const strength = getStrength(password);

  async function onSubmit(data) {
    try {
      await userService.createUser({
        firstName:  data.firstName,
        lastName:   data.lastName,
        middleName: data.middleName || undefined,
        username:   data.username,
        email:      data.email,
        role:       data.role,
        password:   data.password,
      });
      toast.success(`Staff account for ${data.firstName} ${data.lastName} created.`);
      navigate('/admin/staff');
    } catch (err) {
      const apiErr = err.response?.data?.error;
      if (apiErr?.code === 'CONFLICT') {
        const field = apiErr.message.includes('username') ? 'username' : 'email';
        setError(field, { message: apiErr.message });
      } else {
        toast.error(apiErr?.message || 'Failed to create staff account.');
      }
    }
  }

  return (
    <div className="max-w-lg">
      {/* ── Dept gradient banner ── */}
      <div
        className="rounded-2xl overflow-hidden mb-6 relative"
        style={{ background: gradient, minHeight: '110px', boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none"
             style={{ background: 'rgba(255,255,255,0.05)', transform: 'translate(30%,-40%)' }} />
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none"
             style={{ background: 'rgba(255,255,255,0.04)', transform: 'translate(-30%,40%)' }} />
        <div className="relative z-10 px-8 py-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-3xl text-white leading-tight">Add Staff Member</h1>
            <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
              {DEPT_LABEL[user?.department] ?? 'Department'} · New Account
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/admin/staff')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.28)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back to Staff
          </button>
        </div>
      </div>

      {/* Form card */}
      <div
        className="bg-white border border-border rounded-2xl p-6"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>

          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name" required error={errors.firstName?.message}>
              <input
                {...firstNameRegistration}
                onChange={(event) => {
                  firstNameRegistration.onChange(event);
                  updateSuggestedUsername(event.target.value, getValues('lastName'));
                }}
                placeholder="e.g. Juan"
                className={cn(inputCls, errors.firstName && 'border-danger focus:ring-red-200')}
                disabled={isSubmitting}
              />
            </Field>
            <Field label="Last Name" required error={errors.lastName?.message}>
              <input
                {...lastNameRegistration}
                onChange={(event) => {
                  lastNameRegistration.onChange(event);
                  updateSuggestedUsername(getValues('firstName'), event.target.value);
                }}
                placeholder="e.g. Dela Cruz"
                className={cn(inputCls, errors.lastName && 'border-danger focus:ring-red-200')}
                disabled={isSubmitting}
              />
            </Field>
          </div>

          {/* Middle Name */}
          <Field label="Middle Name" error={errors.middleName?.message}>
            <input
              {...register('middleName')}
              placeholder="Optional"
              className={inputCls}
              disabled={isSubmitting}
            />
          </Field>

          {/* Username */}
          <Field label="Username" required error={errors.username?.message}>
            <input
              {...register('username')}
              placeholder="e.g. juan.delacruz"
              className={cn(inputCls, errors.username && 'border-danger focus:ring-red-200')}
              disabled={isSubmitting}
              autoComplete="off"
            />
          </Field>

          {/* Email */}
          <Field label="Email Address" required error={errors.email?.message}>
            <input
              {...register('email')}
              type="email"
              placeholder="e.g. juan@mswdo.gov.ph"
              className={cn(inputCls, errors.email && 'border-danger focus:ring-red-200')}
              disabled={isSubmitting}
            />
          </Field>

          {/* Role */}
          <Field label="Role" required error={errors.role?.message}>
            <select
              {...register('role')}
              className={cn(inputCls, 'cursor-pointer', errors.role && 'border-danger focus:ring-red-200')}
              disabled={isSubmitting}
            >
              <option value="">Select a role…</option>
              <option value="ENCODER">Encoder</option>
              <option value="RELEASING_STAFF">Releasing Staff</option>
            </select>
          </Field>

          {/* Divider */}
          <hr className="border-border" />

          {/* Password */}
          <Field label="Password" required error={errors.password?.message}>
            <div className="relative">
              <input
                {...register('password')}
                type={showPwd ? 'text' : 'password'}
                placeholder="At least 8 characters"
                className={cn(inputCls, 'pr-10', errors.password && 'border-danger focus:ring-red-200')}
                disabled={isSubmitting}
                autoComplete="new-password"
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
            {/* Strength bar */}
            {strength && (
              <div className="mt-2">
                <div className="h-1 w-full bg-border rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-300', strength.color, strength.width)}
                  />
                </div>
                <p className={cn('text-xs mt-1', {
                  'text-red-500':    strength.label === 'Weak',
                  'text-orange-500': strength.label === 'Fair',
                  'text-yellow-600': strength.label === 'Good',
                  'text-emerald-600': strength.label === 'Strong',
                })}>
                  {strength.label} password
                </p>
              </div>
            )}
          </Field>

          {/* Confirm Password */}
          <Field label="Confirm Password" required error={errors.confirmPassword?.message}>
            <div className="relative">
              <input
                {...register('confirmPassword')}
                type={showConfirm ? 'text' : 'password'}
                placeholder="Re-enter password"
                className={cn(inputCls, 'pr-10', errors.confirmPassword && 'border-danger focus:ring-red-200')}
                disabled={isSubmitting}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text-2 transition-colors"
                aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Creating Account…
              </>
            ) : (
              'Create Account'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
