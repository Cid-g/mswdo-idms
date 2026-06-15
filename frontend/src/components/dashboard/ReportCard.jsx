export default function ReportCard({ title, subtitle, children, className = '', style }) {
  return (
    <div className={`bg-white rounded-xl p-6 flex flex-col ${className}`} style={{ boxShadow: 'var(--shadow-card)', ...style }}>
      <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-text-1)' }}>{title}</p>
      {subtitle && <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>{subtitle}</p>}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
