import { Award, ArrowRight, Clock3, ShieldCheck, TrendingUp, Users, Eye } from 'lucide-react';
import { businessCoverageRows, type BusinessDashboard } from './business-model';
import { BusinessRecordDate } from './BusinessRecordDate';

const colours = ['#098b8c', '#61bdb5', '#829ade', '#b5a0e5', '#d19c58', '#a4bdc9'];
const percent = (value: number, total: number) =>
  total > 0 ? Math.round((100 * value) / total) : 0;

export function AnalyticsDonut({
  items,
  onFilter,
  label,
  disabled = false,
}: {
  items: { label: string; value: number }[];
  onFilter: (label: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let stop = 0;
  const segments = items.map((item, index) => {
    const start = stop;
    stop += total ? (100 * item.value) / total : 0;
    return `${colours[index % colours.length]} ${start}% ${stop}%`;
  });
  return total ? (
    <div className="an-donut-layout">
      <div
        className="an-donut"
        role="img"
        aria-label={`${label}: ${total} records in shown groups`}
        style={{ background: `conic-gradient(${segments.join(',')})` }}
      >
        <span>
          <strong>{total.toLocaleString()}</strong>
          <small>Shown records</small>
        </span>
      </div>
      <div className="an-donut-legend">
        {items.map((item, i) => (
          <button
            key={item.label}
            disabled={disabled}
            onClick={() => onFilter(item.label)}
            aria-label={`${item.label}: ${item.value} records; view records`}
          >
            <i style={{ background: colours[i % colours.length] }} aria-hidden="true" />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </button>
        ))}
      </div>
    </div>
  ) : (
    <p className="an-empty">No reviewed credentials in this scope.</p>
  );
}

function Activity({ items }: { items: BusinessDashboard['activity'] }) {
  const months = items.slice(-6);
  const max = Math.max(1, ...months.flatMap(i => [i.submissions, i.decisions]));
  return (
    <>
      <div className="an-chart-legend">
        <span>
          <i className="sub" />
          Submissions
        </span>
        <span>
          <i className="dec" />
          Review decisions
        </span>
      </div>
      {months.length ? (
        <div
          className="an-activity-chart"
          role="img"
          aria-label={months
            .map(i => `${i.label}: ${i.submissions} submissions, ${i.decisions} review decisions`)
            .join('; ')}
        >
          {months.map(i => (
            <div className="an-activity-month" key={i.label}>
              <div className="an-activity-bars">
                <span
                  className="sub"
                  style={{ height: `${(100 * i.submissions) / max}%` }}
                  title={`${i.submissions} submissions`}
                />
                <span
                  className="dec"
                  style={{ height: `${(100 * i.decisions) / max}%` }}
                  title={`${i.decisions} review decisions`}
                />
              </div>
              <small>{i.label}</small>
              <strong>
                {i.submissions} / {i.decisions}
              </strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="an-empty">No submission or review activity in this period.</p>
      )}
    </>
  );
}

export function AnalyticsOverview({
  data,
  pending,
  dataset,
  onChange,
  onView,
  onExport,
  exporting,
  onOpenFiles,
}: {
  data: BusinessDashboard;
  pending: boolean;
  dataset: string;
  onChange: (patch: Record<string, string>) => void;
  onView: (view: 'skills' | 'certifications' | 'records') => void;
  onExport: (format: string) => void;
  exporting: boolean;
  onOpenFiles: (row: BusinessDashboard['rows'][number]) => void;
}) {
  const coverage = businessCoverageRows(data.coverage)
    .map(row => ({
      ...row,
      holders: [1, 2, 3, 4].reduce((sum, rank) => sum + (row.cells.get(rank)?.holders ?? 0), 0),
    }))
    .sort((a, b) => b.holders - a.holders);
  const rows = data.rows.slice(0, 5);
  const clear = {
    category: '',
    issuer: '',
    skillId: '',
    minRank: '',
    maxRank: '',
    status: '',
    validity: '',
    sort: '',
  };
  const labels: Record<string, string> = {
    APPROVED: 'Manager reviewed',
    SUBMITTED: 'Awaiting review',
    CHANGES_REQUESTED: 'Changes requested',
    REJECTED: 'Not approved',
  };
  return (
    <div className="an-overview" aria-busy={pending}>
      <section className="bo-panel an-activity-panel">
        <div className="an-panel-heading">
          <h2>
            <TrendingUp size={18} />
            Submission & review activity
          </h2>
          <span>Last 6 active months</span>
        </div>
        <Activity items={data.activity} />
      </section>
      <section className="bo-panel an-skill-panel">
        <div className="an-panel-heading">
          <h2>
            <Award size={18} />
            Skill coverage
          </h2>
          <button onClick={() => onView('skills')}>
            View all <ArrowRight size={14} />
          </button>
        </div>
        <p className="an-caption">Top skills · reviewed holders in the four-level framework</p>
        <div className="an-skill-bars">
          {coverage.slice(0, 5).map(row => (
            <button
              key={row.id}
              disabled={pending}
              onClick={() =>
                onChange({ ...clear, dataset: 'skills', skillId: row.id, status: 'APPROVED' })
              }
            >
              <span title={row.label}>{row.label}</span>
              <i>
                <b
                  style={{
                    width: `${Math.min(100, percent(row.holders, data.summary.employees))}%`,
                  }}
                />
              </i>
              <strong>
                {row.holders} <small>({percent(row.holders, data.summary.employees)}%)</small>
              </strong>
            </button>
          ))}
        </div>
        {!coverage.length && <p className="an-empty">No reviewed four-level skill claims yet.</p>}
        {!!coverage.length && (
          <div className="an-mini-matrix">
            <table>
              <caption>Proficiency matrix</caption>
              <thead>
                <tr>
                  <th>Skill</th>
                  {['Foundation', 'Autonomous', 'Experienced', 'Expert'].map(label => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coverage.slice(0, 3).map(row => (
                  <tr key={row.id}>
                    <th>{row.label}</th>
                    {[1, 2, 3, 4].map(rank => (
                      <td key={rank}>
                        <button
                          disabled={pending || !row.cells.get(rank)?.holders}
                          onClick={() =>
                            onChange({
                              ...clear,
                              dataset: 'skills',
                              skillId: row.id,
                              status: 'APPROVED',
                              minRank: String(rank),
                              maxRank: String(rank),
                            })
                          }
                          aria-label={`${row.label}, level ${rank}: ${row.cells.get(rank)?.holders ?? 0} reviewed holders`}
                        >
                          {row.cells.get(rank)?.holders ?? 0}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="bo-panel an-certificate-panel">
        <div className="an-panel-heading">
          <h2>
            <ShieldCheck size={18} />
            Certificates & renewals
          </h2>
          <button onClick={() => onView('certifications')}>
            View all <ArrowRight size={14} />
          </button>
        </div>
        <div className="an-renewal-stats">
          <button
            disabled={pending}
            onClick={() => onChange({ ...clear, dataset: 'certifications', validity: 'EXPIRED' })}
          >
            <span>Expired credentials</span>
            <strong>{data.summary.expired}</strong>
          </button>
          <button
            disabled={pending}
            onClick={() => onChange({ ...clear, dataset: 'certifications', validity: '30' })}
          >
            <span>Expiring in 30 days</span>
            <strong>{data.summary.expiring}</strong>
          </button>
        </div>
        <h3 className="an-caption">Reviewed credentials by issuer</h3>
        <AnalyticsDonut
          disabled={pending}
          items={data.distribution}
          label="Reviewed credentials by issuer"
          onFilter={issuer =>
            onChange({ ...clear, dataset: 'certifications', issuer, status: 'APPROVED' })
          }
        />
        <div className="an-renewal-list">
          <h3>
            <Clock3 size={15} />
            Renewal windows
          </h3>
          {data.expiry.map(item => (
            <button
              disabled={pending}
              key={item.label}
              onClick={() =>
                onChange({
                  ...clear,
                  dataset: 'certifications',
                  validity:
                    (
                      {
                        Expired: 'EXPIRED',
                        'No expiry': 'NO_EXPIRY',
                        '14 days': '14',
                        '30 days': '15_30',
                        '60 days': '31_60',
                        '90 days': '61_90',
                        Later: 'LATER',
                      } as Record<string, string>
                    )[item.label] ?? '',
                })
              }
            >
              <span>
                {item.label === '14 days'
                  ? 'Within 14 days'
                  : item.label === '30 days'
                    ? '15–30 days'
                    : item.label === '60 days'
                      ? '31–60 days'
                      : item.label === '90 days'
                        ? '61–90 days'
                        : item.label}
              </span>
              <strong>{item.value}</strong>
            </button>
          ))}
        </div>
      </section>
      <section className="bo-panel an-record-panel">
        <div className="an-panel-heading">
          <h2>
            <Users size={18} />
            People & records
          </h2>
          <button onClick={() => onView('records')}>
            View all <ArrowRight size={14} />
          </button>
        </div>
        <div className="an-record-toolbar">
          <span>
            {dataset === 'people' ? 'Employees' : 'Records'} · {data.total.toLocaleString()}{' '}
            matching
          </span>
          <div>
            <button
              disabled={pending || exporting || !data.context.canExport}
              onClick={() => onExport('csv')}
            >
              CSV
            </button>
            <button
              disabled={pending || exporting || !data.context.canExport}
              onClick={() => onExport('xlsx')}
            >
              Excel
            </button>
          </div>
        </div>
        <div className="bo-table-wrap" style={{ visibility: pending ? 'hidden' : undefined }}>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                {dataset === 'people' ? (
                  <>
                    <th>Reviewed skills</th>
                    <th>Current certificates</th>
                  </>
                ) : (
                  <>
                    <th>Record</th>
                    <th>Review status</th>
                    <th>Submitted / reviewed</th>
                    <th>Files</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={String(row.id)}>
                  <td>
                    <strong>{String(row.employee)}</strong>
                    <small>{String(row.employeeCode)}</small>
                  </td>
                  {dataset === 'people' ? (
                    <>
                      <td>{Number(row.reviewedSkills) || 0}</td>
                      <td>{Number(row.currentCertifications) || 0}</td>
                    </>
                  ) : (
                    <>
                      <td>{String(row.name)}</td>
                      <td>
                        <span className={`cap-status-pill ${String(row.status).toLowerCase()}`}>
                          {labels[String(row.status)] ?? String(row.status)}
                        </span>
                      </td>
                      <td>
                        <small>Submitted on</small>
                        <BusinessRecordDate value={row.submittedAt} by={row.submittedBy} />
                        <small>Reviewed on</small>
                        <BusinessRecordDate value={row.reviewedAt} by={row.reviewedBy} />
                      </td>
                      <td>
                        {row.canViewFiles === true ? (
                          <button
                            type="button"
                            className="secondary-button bo-btn-sm"
                            disabled={pending}
                            aria-label={`View submitted files for ${row.name}`}
                            onClick={() => onOpenFiles(row)}
                          >
                            <Eye size={15} />
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p className="an-empty">No matching records. Try clearing filters.</p>}
        <p className="an-caption">
          Showing up to 5 from the current page. View all to filter, paginate or open evidence.
        </p>
      </section>
    </div>
  );
}
