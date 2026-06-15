import { cn, computeAge } from '../../lib/utils';
import BarangayCombobox from '../ui/BarangayCombobox';

// Base input class — no w-full so individual fields can override with flex-1
const inputBase =
  'border border-border rounded-xl px-3.5 py-2.5 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-muted/60';

const inputCls = 'w-full ' + inputBase;
const selectCls = cn(inputCls, 'cursor-pointer');

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-2 mb-1.5">
        {label}
        {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * Senior Citizen Quick Encode — Step 1 fields (6 fields, simplest).
 * Shows age chip next to birthdate (auto-computed, never stored).
 * No sex, no emergency contact — both collected in Phase 2.
 */
export default function SeniorCitizenQuickEncodeFields({ form, setField, errors, isSubmitting }) {
  function err(field) {
    return errors[field]
      ? <p className="mt-1 text-xs text-danger">{errors[field]}</p>
      : null;
  }
  function cls(field) {
    return cn(inputCls, errors[field] && 'border-danger');
  }

  const age = form.birthdate ? computeAge(form.birthdate) : null;

  return (
    <>
      {/* Row 1: Last Name (col-span-2), Extension */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Last Name" required>
            <input
              value={form.lastName}
              onChange={(e) => setField('lastName', e.target.value)}
              placeholder="e.g. Dela Cruz"
              className={cls('lastName')}
              disabled={isSubmitting}
            />
            {err('lastName')}
          </Field>
        </div>
        <Field label="Ext. (Jr./Sr.)">
          <select
            value={form.extensionName}
            onChange={(e) => setField('extensionName', e.target.value)}
            className={selectCls}
            disabled={isSubmitting}
          >
            <option value="">None</option>
            {['Jr.', 'Sr.', 'II', 'III'].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Row 2: First Name, Middle Name */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="First Name" required>
          <input
            value={form.firstName}
            onChange={(e) => setField('firstName', e.target.value)}
            placeholder="e.g. Juan"
            className={cls('firstName')}
            disabled={isSubmitting}
          />
          {err('firstName')}
        </Field>
        <Field label="Middle Name">
          <input
            value={form.middleName}
            onChange={(e) => setField('middleName', e.target.value)}
            placeholder="Optional"
            className={inputCls}
            disabled={isSubmitting}
          />
        </Field>
      </div>

      {/* Row 3: Birthdate (+ age chip), Barangay */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date of Birth" required>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={form.birthdate}
              onChange={(e) => setField('birthdate', e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className={cn(
                inputBase,
                'flex-1 min-w-0',
                errors.birthdate && 'border-danger',
              )}
              disabled={isSubmitting}
            />
            {age !== null && (
              <span className="flex-shrink-0 text-xs text-muted bg-surface px-2 py-1 rounded-md whitespace-nowrap">
                Age: {age}
              </span>
            )}
          </div>
          {err('birthdate')}
        </Field>
        <Field label="Barangay" required>
          <BarangayCombobox
            value={form.barangay}
            onChange={(v) => setField('barangay', v)}
            disabled={isSubmitting}
            hasError={!!errors.barangay}
          />
          {err('barangay')}
        </Field>
      </div>
    </>
  );
}
