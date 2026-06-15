import { Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { computeAge, toDateInput } from '../lib/utils';

const RELATIONSHIPS = ['Son', 'Daughter', 'Ward', 'Adopted Son', 'Adopted Daughter'];

const EMPTY_CHILD = {
  lastName: '', firstName: '', middleName: '',
  birthdate: '', sex: '', relationship: '',
};

const inputCls =
  'w-full border border-border rounded-lg px-3 py-2 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-300 ' +
  'disabled:bg-surface disabled:cursor-not-allowed';

function ChildRow({ child, index, onChange, onRemove, canRemove, disabled }) {
  const age = child.birthdate ? computeAge(child.birthdate) : null;

  function update(field, value) {
    onChange(index, { ...child, [field]: value });
  }

  return (
    <div className="p-4 border border-border rounded-xl bg-white relative">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-muted uppercase tracking-wide">
          Child {index + 1}
          {age !== null && (
            <span className="ml-2 text-text-2 normal-case font-normal">
              ({age} yr{age !== 1 ? 's' : ''} old)
            </span>
          )}
        </span>
        {canRemove && !disabled && (
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="flex items-center gap-1 text-xs text-danger hover:text-red-700 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2">
        <div>
          <label className="block text-xs font-medium text-text-2 mb-1">
            Last Name <span className="text-danger">*</span>
          </label>
          <input
            value={child.lastName}
            onChange={(e) => update('lastName', e.target.value)}
            placeholder="Last name"
            className={inputCls}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-2 mb-1">
            First Name <span className="text-danger">*</span>
          </label>
          <input
            value={child.firstName}
            onChange={(e) => update('firstName', e.target.value)}
            placeholder="First name"
            className={inputCls}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-2 mb-1">Middle Name</label>
          <input
            value={child.middleName}
            onChange={(e) => update('middleName', e.target.value)}
            placeholder="Optional"
            className={inputCls}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs font-medium text-text-2 mb-1">
            Birthdate <span className="text-danger">*</span>
          </label>
          <input
            type="date"
            value={toDateInput(child.birthdate)}
            onChange={(e) => update('birthdate', e.target.value)}
            max={new Date().toISOString().split('T')[0]}
            className={inputCls}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-2 mb-1">Sex</label>
          <select
            value={child.sex}
            onChange={(e) => update('sex', e.target.value)}
            className={cn(inputCls, 'cursor-pointer')}
            disabled={disabled}
          >
            <option value="">— Select —</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-2 mb-1">
            Relationship <span className="text-danger">*</span>
          </label>
          <select
            value={child.relationship}
            onChange={(e) => update('relationship', e.target.value)}
            className={cn(inputCls, 'cursor-pointer')}
            disabled={disabled}
          >
            <option value="">— Select —</option>
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/**
 * ChildrenForm — dynamic list of children for Solo Parent applicants.
 *
 * Props:
 *   value:    Child[]   — array of child objects
 *   onChange: (children: Child[]) => void
 *   disabled: boolean   — read-only when true
 *   max:      number    — max children (default 6 — ID back has 6 rows)
 */
export default function ChildrenForm({ value = [], onChange, disabled = false, max = 6 }) {
  function addChild() {
    if (value.length >= max) return;
    onChange([...value, { ...EMPTY_CHILD }]);
  }

  function removeChild(index) {
    onChange(value.filter((_, i) => i !== index));
  }

  function updateChild(index, updated) {
    const next = [...value];
    next[index] = updated;
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {value.map((child, i) => (
        <ChildRow
          key={i}
          child={child}
          index={i}
          onChange={updateChild}
          onRemove={removeChild}
          canRemove={value.length > 1}
          disabled={disabled}
        />
      ))}

      {!disabled && (
        <button
          type="button"
          onClick={addChild}
          disabled={value.length >= max}
          className="w-full border-2 border-dashed border-border rounded-xl py-3 text-sm text-muted hover:border-sp-500 hover:text-sp-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Add Child ({value.length}/{max})
        </button>
      )}
    </div>
  );
}
