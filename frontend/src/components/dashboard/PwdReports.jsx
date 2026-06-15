import { Send, IdCard, CalendarX, HeartCrack } from 'lucide-react';
import ReportCard from './ReportCard';
import GroupedBarChart from './GroupedBarChart';
import DonutChart from './DonutChart';
import RankedBarList from './RankedBarList';
import StatTiles from './StatTiles';

export default function PwdReports({ reports, dept }) {
  const primary = dept.barFill;
  const secondary = '#64748B';
  const {
    perDisability = [], perBarangay = [], ageDistribution = [],
    sexSplit = { male: 0, female: 0, total: 0 },
    statusSummary = { encodedToDOH: 0, withoutId: 0, expired: 0, deceased: 0 },
  } = reports;

  const tiles = [
    { key: 'doh',      label: 'Encoded to DOH', value: statusSummary.encodedToDOH, color: primary,    Icon: Send },
    { key: 'noid',     label: 'Without ID No.', value: statusSummary.withoutId,    color: '#D97706',  Icon: IdCard },
    { key: 'expired',  label: 'Expired',        value: statusSummary.expired,      color: '#DC2626',  Icon: CalendarX },
    { key: 'deceased', label: 'Deceased',       value: statusSummary.deceased,     color: '#6B7280',  Icon: HeartCrack },
  ];

  return (
    <div className="mt-5 space-y-5 animate-fade-up">
      <div className="grid gap-5" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <ReportCard title="Persons with Disability per Type" subtitle="By disability type · Male vs Female">
          {perDisability.every((d) => d.total === 0) ? (
            <EmptyBox text="No records yet" />
          ) : (
            <GroupedBarChart
              data={perDisability.map((r) => ({ ...r, label: r.label }))}
              xKey="label" layout="vertical" height={360} barSize={10}
              series={[{ key: 'male', name: 'Male', color: primary }, { key: 'female', name: 'Female', color: secondary }]}
            />
          )}
        </ReportCard>
        <ReportCard title="Gender Distribution" subtitle="All registered PWDs">
          {sexSplit.total === 0 ? <EmptyBox text="No records yet" /> : (
            <DonutChart centerLabel="PWDs" data={[
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
        <ReportCard title="ID & Status Summary" subtitle="Record status overview">
          <StatTiles tiles={tiles} />
        </ReportCard>
      </div>

      <ReportCard title="Persons with Disability per Barangay" subtitle="44 barangays · sorted by total · Male vs Female">
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
