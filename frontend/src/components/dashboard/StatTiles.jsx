export default function StatTiles({ tiles, columns = 2 }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {tiles.map(({ key, label, value, color, Icon }) => (
        <div key={key} className="rounded-lg p-3" style={{ background: 'var(--color-surface)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
            {Icon && <Icon className="w-3.5 h-3.5" style={{ color: color || 'var(--color-muted)' }} strokeWidth={2} />}
          </div>
          <span className="font-serif text-xl" style={{ color: 'var(--color-text-1)' }}>{(value ?? 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
