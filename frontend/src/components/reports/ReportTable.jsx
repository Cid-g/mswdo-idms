export default function ReportTable({ columns, columnGroups, rows, totals }) {
  const flatCols = columns || (columnGroups ? columnGroups.flatMap((g) => g.columns) : []);
  const alignCls = (c) => (c.align === 'right' ? 'text-right' : 'text-left');
  // 'TOTAL' label goes in the last leading column before the first totalled column.
  let labelIdx = 0;
  if (totals) {
    for (let i = 0; i < flatCols.length; i += 1) {
      if (flatCols[i].key in totals) break;
      labelIdx = i;
    }
  }

  const thBase = 'px-3 py-2 font-semibold whitespace-nowrap';
  const thStyle = { color: 'var(--color-text-1)', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' };

  return (
    <div className="overflow-x-auto rounded-xl bg-white" style={{ boxShadow: 'var(--shadow-card)' }}>
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          {columnGroups ? (
            <>
              <tr>
                {columnGroups.map((g, gi) =>
                  g.label == null
                    ? g.columns.map((c) => (
                        <th key={c.key} rowSpan={2} className={`${thBase} ${alignCls(c)}`} style={thStyle}>{c.label}</th>
                      ))
                    : (
                        <th key={`g${gi}`} colSpan={g.columns.length} className={`${thBase} text-center`} style={{ ...thStyle, borderLeft: '1px solid var(--color-border)' }}>
                          {g.label}
                        </th>
                      ),
                )}
              </tr>
              <tr>
                {columnGroups.filter((g) => g.label != null).flatMap((g) =>
                  g.columns.map((c) => (
                    <th key={c.key} className={`${thBase} ${alignCls(c)}`} style={thStyle}>{c.label}</th>
                  )),
                )}
              </tr>
            </>
          ) : (
            <tr>
              {flatCols.map((c) => (
                <th key={c.key} className={`${thBase} ${alignCls(c)}`} style={thStyle}>{c.label}</th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {flatCols.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 whitespace-nowrap ${alignCls(c)}`}
                  style={{ color: 'var(--color-text-1)', borderBottom: '1px solid var(--color-border)' }}
                >
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              {flatCols.map((c, i) => {
                const val = c.key in totals ? totals[c.key] : (i === labelIdx ? 'TOTAL' : '');
                return (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5 font-semibold whitespace-nowrap ${alignCls(c)}`}
                    style={{ color: 'var(--color-text-1)', background: 'var(--color-surface)', borderTop: '2px solid var(--color-border)' }}
                  >
                    {val}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
