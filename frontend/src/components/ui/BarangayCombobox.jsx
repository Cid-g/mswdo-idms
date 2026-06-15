import { useState, useRef, useEffect } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { BARANGAYS } from '../../lib/constants';

/**
 * Searchable combobox for the 44 Gerona barangays.
 * Props: value, onChange, disabled, hasError, placeholder
 */
export default function BarangayCombobox({
  value,
  onChange,
  disabled = false,
  hasError = false,
  placeholder = 'Select barangay…',
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);
  const searchRef = useRef(null);

  const filtered = search.trim()
    ? BARANGAYS.filter((b) => b.toLowerCase().includes(search.toLowerCase()))
    : BARANGAYS;

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => searchRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    } else {
      setSearch('');
    }
  }, [open]);

  useEffect(() => {
    function onOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  function handleKeyDown(e) {
    if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
        disabled={disabled}
        className={cn(
          'w-full flex items-center justify-between border rounded-xl px-3.5 py-2.5 text-sm bg-white',
          'focus:outline-none focus:ring-2 focus:ring-slate-300 transition-colors',
          hasError ? 'border-danger' : 'border-border',
          disabled && 'opacity-60 cursor-not-allowed',
        )}
      >
        <span className={value ? 'text-text-1' : 'text-muted/60'}>
          {value || placeholder}
        </span>
        <ChevronsUpDown className="w-4 h-4 text-muted flex-shrink-0 ml-2" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full mt-1.5 left-0 right-0 z-50 bg-white border border-border rounded-xl shadow-lg overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-border">
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type to filter…"
              className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
            />
          </div>

          {/* Options */}
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-muted text-center">No barangay found</p>
            ) : (
              filtered.map((b) => (
                <button
                  key={b}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(b);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-3.5 py-2 text-sm text-left',
                    'hover:bg-surface transition-colors',
                    value === b && 'bg-surface font-medium',
                  )}
                >
                  {b}
                  {value === b && <Check className="w-3.5 h-3.5 text-muted" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
