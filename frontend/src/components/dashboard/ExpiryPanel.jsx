import { AlertTriangle, Clock, CalendarClock, ShieldCheck } from 'lucide-react';

const TILES = [
  { key: 'expired', label: 'Expired',     Icon: AlertTriangle, color: '#DC2626' },
  { key: 'days30',  label: '≤ 30 days',   Icon: Clock,         color: '#D97706' },
  { key: 'days90',  label: '≤ 90 days',   Icon: CalendarClock, color: '#CA8A04' },
  { key: 'valid',   label: 'Valid',       Icon: ShieldCheck,   color: '#059669' },
];

const STATUS_STYLE = {
  expired: { bg: '#FEE2E2', fg: '#DC2626' },
  days30:  { bg: '#FEF3C7', fg: '#D97706' },
  days90:  { bg: '#FEF9C3', fg: '#CA8A04' },
};

function badgeText(r) {
  if (r.daysLeft < 0) return `${Math.abs(r.daysLeft)}d overdue`;
  return `${r.daysLeft}d left`;
}

export default function ExpiryPanel({ buckets, soon, maxHeight = 240 }) {
  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-2 gap-2 mb-4">
        {TILES.map(({ key, label, Icon, color }) => (
          <div key={key} className="rounded-lg p-3" style={{ background: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
              <Icon className="w-3.5 h-3.5" style={{ color }} strokeWidth={2} />
            </div>
            <span className="font-serif text-xl" style={{ color: 'var(--color-text-1)' }}>{buckets[key] ?? 0}</span>
          </div>
        ))}
      </div>

      <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text-1)' }}>For renewal</p>
      {soon.length === 0 ? (
        <div className="flex-1 flex items-center justify-center rounded-lg" style={{ background: 'var(--color-surface)', minHeight: 80 }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No IDs expiring soon</p>
        </div>
      ) : (
        <div className="overflow-y-auto pr-1 space-y-2" style={{ maxHeight }}>
          {soon.map((r, idx) => {
            const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.days90;
            return (
              <div key={`${r.spicNumber ?? 'na'}-${idx}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs truncate" style={{ color: 'var(--color-text-1)' }}>{r.name}</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{r.spicNumber ?? 'No SPIC #'}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0 font-medium" style={{ background: s.bg, color: s.fg }}>
                  {badgeText(r)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
