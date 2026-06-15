import { cn, computeAge } from '../../lib/utils';
import { SOLO_PARENT_CATEGORIES } from '../../lib/constants';
import BarangayCombobox from '../ui/BarangayCombobox';
import ChildrenForm from '../ChildrenForm';

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

function SectionDivider({ label }) {
  return (
    <div className="flex items-center gap-3 mt-6 mb-4">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

export default function SoloParentQuickEncodeFields({
  form,
  setField,
  setForm,
  errors,
  isSubmitting,
}) {
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
            placeholder="e.g. Maria"
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

      {/* Row 3: Birthdate (+ age chip), Birthplace */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date of Birth" required>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={form.birthdate}
              onChange={(e) => setField('birthdate', e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className={cn(inputBase, 'flex-1 min-w-0', errors.birthdate && 'border-danger')}
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
        <Field label="Place of Birth" required>
          <input
            value={form.birthplace}
            onChange={(e) => setField('birthplace', e.target.value)}
            placeholder="e.g. Gerona, Tarlac"
            className={cls('birthplace')}
            disabled={isSubmitting}
          />
          {err('birthplace')}
        </Field>
      </div>

      {/* Row 4: Barangay, Category Code */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Barangay" required>
          <BarangayCombobox
            value={form.barangay}
            onChange={(v) => setField('barangay', v)}
            disabled={isSubmitting}
            hasError={!!errors.barangay}
          />
          {err('barangay')}
        </Field>
        <Field label="Category Code" required>
          <select
            value={form.soloParent.categoryCode}
            onChange={(e) => setField('soloParent.categoryCode', e.target.value)}
            className={cn(selectCls, errors['soloParent.categoryCode'] && 'border-danger')}
            disabled={isSubmitting}
          >
            <option value="">— Select category —</option>
            {SOLO_PARENT_CATEGORIES.map(({ code, label }) => (
              <option key={code} value={code}>[{code}] {label}</option>
            ))}
          </select>
          {err('soloParent.categoryCode')}
        </Field>
      </div>

      {/* ── Children Information ────────────────────────────── */}
      <SectionDivider label="Children Information" />

      {err('soloParent.children')}

      <ChildrenForm
        value={form.soloParent.children}
        onChange={(children) =>
          setForm((f) => ({ ...f, soloParent: { ...f.soloParent, children } }))
        }
        disabled={isSubmitting}
      />

      {/* ── Emergency Contact ────────────────────────────────── */}
      <SectionDivider label="Emergency Contact" />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact Person" required>
          <input
            value={form.emergencyContactName}
            onChange={(e) => setField('emergencyContactName', e.target.value)}
            placeholder="Full name"
            className={cls('emergencyContactName')}
            disabled={isSubmitting}
          />
          {err('emergencyContactName')}
        </Field>
        <Field label="Contact Number" required>
          <input
            value={form.emergencyContactNumber}
            onChange={(e) => setField('emergencyContactNumber', e.target.value)}
            placeholder="09XXXXXXXXX"
            className={cls('emergencyContactNumber')}
            disabled={isSubmitting}
          />
          {err('emergencyContactNumber')}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact Address" required>
          <input
            value={form.emergencyContactAddress}
            onChange={(e) => setField('emergencyContactAddress', e.target.value)}
            placeholder="Full address"
            className={cls('emergencyContactAddress')}
            disabled={isSubmitting}
          />
          {err('emergencyContactAddress')}
        </Field>
        <Field label="Relationship">
          <input
            value={form.emergencyContactRelation}
            onChange={(e) => setField('emergencyContactRelation', e.target.value)}
            placeholder="e.g. Parent, Sibling"
            className={inputCls}
            disabled={isSubmitting}
          />
        </Field>
      </div>
    </>
  );
}
