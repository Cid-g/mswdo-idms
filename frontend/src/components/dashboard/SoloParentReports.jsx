import ReportCard from './ReportCard';
import GroupedBarChart from './GroupedBarChart';
import DonutChart from './DonutChart';
import RankedBarList from './RankedBarList';
import ExpiryPanel from './ExpiryPanel';

export default function SoloParentReports({ reports, dept }) {
  const primary = dept.barFill;     // e.g. #E11D48
  const secondary = '#64748B';      // slate — paired neutral for the 2nd series

  const {
    perCategory = [], perBarangay = [], perYear = [],
    sexSplit = { male: 0, female: 0, total: 0 },
    spicExpiry = { buckets: {}, soon: [] },
  } = reports;

  const yearData = perYear.map((r) => ({ ...r, label: String(r.year) }));
  const categoryData = perCategory.map((r) => ({ ...r, label: r.code }));

  return (
    <div className="mt-5 space-y-5 animate-fade-up">
      {/* Row 1: Per Year (wide) + Sex split (narrow) */}
      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <ReportCard title="Solo Parents per Year of Registration" subtitle="By SPIC issuance year · Male vs Female">
          {yearData.length === 0 ? (
            <EmptyBox text="No records with an issued SPIC date yet" />
          ) : (
            <GroupedBarChart
              data={yearData}
              xKey="label"
              series={[{ key: 'male', name: 'Male', color: primary }, { key: 'female', name: 'Female', color: secondary }]}
            />
          )}
        </ReportCard>

        <ReportCard title="Gender Distribution" subtitle="All registered solo parents">
          {sexSplit.total === 0 ? (
            <EmptyBox text="No records yet" />
          ) : (
            <DonutChart
              centerLabel="Solo Parents"
              data={[
                { name: 'Male', value: sexSplit.male, color: primary },
                { name: 'Female', value: sexSplit.female, color: secondary },
              ]}
            />
          )}
        </ReportCard>
      </div>

      {/* Row 2: Per Category (wide) + SPIC expiry (narrow) */}
      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <ReportCard title="Solo Parents per Category" subtitle="New vs Renewal · DILG MC 2023-140 codes">
          {perCategory.every((c) => c.total === 0) ? (
            <EmptyBox text="No records yet" />
          ) : (
            <GroupedBarChart
              data={categoryData}
              xKey="label"
              layout="vertical"
              height={420}
              barSize={9}
              series={[{ key: 'new', name: 'New', color: primary }, { key: 'renew', name: 'Renewal', color: secondary }]}
            />
          )}
        </ReportCard>

        <ReportCard title="SPIC Status" subtitle="ID validity · 1 year from issuance">
          <ExpiryPanel buckets={spicExpiry.buckets} soon={spicExpiry.soon} />
        </ReportCard>
      </div>

      {/* Row 3: Per Barangay (full width) */}
      <ReportCard title="Solo Parents per Barangay" subtitle="44 barangays · sorted by total · Male vs Female">
        {perBarangay.every((b) => b.total === 0) ? (
          <EmptyBox text="No records yet" />
        ) : (
          <RankedBarList items={perBarangay} maleColor={primary} femaleColor={secondary} />
        )}
      </ReportCard>
    </div>
  );
}

function EmptyBox({ text }) {
  return (
    <div className="flex items-center justify-center rounded-lg" style={{ background: 'var(--color-surface)', minHeight: 160 }}>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{text}</p>
    </div>
  );
}
