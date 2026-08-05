import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet } from 'lucide-react';
import { reportsService } from '../../services/reportsService';
import ReportTable from '../../components/reports/ReportTable';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function ReportsPage() {
  const { data: reports } = useQuery({ queryKey: ['reports-list'], queryFn: reportsService.listReports, staleTime: 5 * 60_000 });
  const [selectedIdOverride, setSelectedIdOverride] = useState(null);
  const selectedId = reports?.some((item) => item.id === selectedIdOverride)
    ? selectedIdOverride
    : (reports?.[0]?.id ?? null);

  const { data: report, isLoading } = useQuery({
    queryKey: ['report', selectedId],
    queryFn: () => reportsService.getReport(selectedId),
    enabled: Boolean(selectedId),
    staleTime: 60_000,
  });

  const [downloading, setDownloading] = useState(false);
  const handleExport = async () => {
    if (!selectedId) return;
    setDownloading(true);
    try { await reportsService.downloadReport(selectedId); }
    finally { setDownloading(false); }
  };

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-2xl" style={{ color: 'var(--color-text-1)' }}>Reports</h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Official statistical reports · export to Excel</p>
        </div>
        <button
          onClick={handleExport}
          disabled={!report || downloading}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          style={{ background: 'var(--color-text-1)' }}
        >
          <Download className="w-4 h-4" />
          {downloading ? 'Exporting…' : 'Export to Excel'}
        </button>
      </div>

      {reports?.length > 1 && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedIdOverride(r.id)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              style={selectedId === r.id
                ? { background: 'var(--color-text-1)', color: '#fff' }
                : { background: 'var(--color-surface)', color: 'var(--color-muted)' }}
            >
              {r.title}
            </button>
          ))}
        </div>
      )}

      {isLoading || !report ? (
        <div className="rounded-xl bg-white p-10 text-center" style={{ boxShadow: 'var(--shadow-card)' }}>
          <FileSpreadsheet className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--color-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading report…</p>
        </div>
      ) : (
        <>
          <div className="mb-3">
            <h2 className="font-serif text-lg" style={{ color: 'var(--color-text-1)' }}>{report.title}</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>As of {formatDate(report.asOf)}</p>
          </div>
          <ReportTable columns={report.columns} columnGroups={report.columnGroups} rows={report.rows} totals={report.totals} />
        </>
      )}
    </div>
  );
}
