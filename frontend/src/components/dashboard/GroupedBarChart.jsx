import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--color-text-1)', color: '#fff', boxShadow: 'var(--shadow-md)' }}>
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: '#fff' }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
}

export default function GroupedBarChart({ data, xKey, series, height = 220, layout = 'horizontal', barSize = 16 }) {
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={layout}
        margin={vertical ? { top: 4, right: 16, bottom: 0, left: 8 } : { top: 4, right: 8, bottom: 0, left: -20 }}
        barGap={2}
        barCategoryGap={vertical ? '25%' : '20%'}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={!vertical} vertical={vertical} />
        {vertical ? (
          <>
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey={xKey} width={150} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} axisLine={false} tickLine={false} />
          </>
        )}
        <Tooltip content={<Tip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} barSize={barSize} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
