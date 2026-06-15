import ReportCard from './ReportCard';
import GroupedBarChart from './GroupedBarChart';
import DonutChart from './DonutChart';
import RankedBarList from './RankedBarList';

export default function SeniorCitizenReports({ reports, dept }) {
  const primary = dept.barFill;
  const secondary = '#64748B';
  const {
    perPension = [], perBarangay = [], ageDistribution = [],
    sexSplit = { male: 0, female: 0, total: 0 },
    registration = { walkIn: 0, caravan: 0, unspecified: 0 },
  } = reports;

  return (
    <div className="mt-5 space-y-5 animate-fade-up">
      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <ReportCard title="Senior Citizens per Pension Type" subtitle="By pension type · Male vs Female">
          {perPension.every((p) => p.total === 0) ? <EmptyBox text="No records yet" /> : (
            <GroupedBarChart
              data={perPension.map((r) => ({ ...r, label: r.label }))}
              xKey="label" layout="vertical" height={320} barSize={11}
              series={[{ key: 'male', name: 'Male', color: primary }, { key: 'female', name: 'Female', color: secondary }]}
            />
          )}
        </ReportCard>
        <ReportCard title="Gender Distribution" subtitle="All registered senior citizens">
          {sexSplit.total === 0 ? <EmptyBox text="No records yet" /> : (
            <DonutChart centerLabel="Seniors" data={[
              { name: 'Male', value: sexSplit.male, color: primary },
              { name: 'Female', value: sexSplit.female, color: secondary },
            ]} />
          )}
        </ReportCard>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <ReportCard title="Age Distribution" subtitle="By age range · Male vs Female">
          {ageDistribution.every((b) => b.total === 0) ? <EmptyBox text="No records with a birthdate yet" /> : (
            <GroupedBarChart
              data={ageDistribution.map((r) => ({ ...r, label: r.bracket }))}
              xKey="label" height={220}
              series={[{ key: 'male', name: 'Male', color: primary }, { key: 'female', name: 'Female', color: secondary }]}
            />
          )}
        </ReportCard>
        <ReportCard title="Registration Type" subtitle="How seniors were registered">
          {(registration.walkIn + registration.caravan + registration.unspecified) === 0 ? (
            <EmptyBox text="No records yet" />
          ) : (
            <DonutChart centerLabel="Seniors" data={[
              { name: 'Walk-In', value: registration.walkIn, color: primary },
              { name: 'Caravan', value: registration.caravan, color: secondary },
              { name: 'Unspecified', value: registration.unspecified, color: '#CBD5E1' },
            ]} />
          )}
        </ReportCard>
      </div>

      <ReportCard title="Senior Citizens per Barangay" subtitle="44 barangays · sorted by total · Male vs Female">
        {perBarangay.every((b) => b.total === 0) ? <EmptyBox text="No records yet" /> : (
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
