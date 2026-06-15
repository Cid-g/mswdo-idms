export default function RankedBarList({ items, maleColor, femaleColor, maxHeight = 360 }) {
  const max = Math.max(1, ...items.map((i) => i.total));
  return (
    <div className="overflow-y-auto pr-1" style={{ maxHeight }}>
      <div className="flex items-center gap-3 mb-3">
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: maleColor }} /> Male
        </span>
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: femaleColor }} /> Female
        </span>
      </div>
      <div className="space-y-2.5">
        {items.map((i) => (
          <div key={i.barangay} className="flex items-center gap-3">
            <span className="text-xs w-28 flex-shrink-0 truncate" style={{ color: 'var(--color-text-1)' }} title={i.barangay}>
              {i.barangay}
            </span>
            <div className="flex-1 h-5 rounded-full overflow-hidden flex" style={{ background: 'var(--color-surface)' }}>
              <div style={{ width: `${(i.male / max) * 100}%`, background: maleColor }} className="h-full transition-all" />
              <div style={{ width: `${(i.female / max) * 100}%`, background: femaleColor }} className="h-full transition-all" />
            </div>
            <span className="text-xs w-8 text-right flex-shrink-0 font-medium" style={{ color: 'var(--color-text-1)' }}>{i.total}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
