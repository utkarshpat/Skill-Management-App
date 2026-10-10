import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  ArrowDownToLine,
  BarChart3,
  Users,
  ShieldCheck,
  Clock3,
  AlertCircle,
  Sparkles,
  X,
} from 'lucide-react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { BusinessAdministration } from './BusinessAdministration';
import { BusinessWorkflows } from './BusinessWorkflows';
import {
  businessFilters,
  updateBusinessFilters,
  type BusinessContext,
  type BusinessDashboard,
} from './business-model';
import './business.css';
export function BusinessOperations() {
  const [params, setParams] = useSearchParams(),
    [context, setContext] = useState<BusinessContext>(),
    [error, setError] = useState('');
  const tab = params.get('tab') ?? 'insights';
  useEffect(() => {
    const abort = new AbortController();
    authenticatedFetch('/api/business/context', { signal: abort.signal })
      .then(r => readApiResponse<BusinessContext>(r, 'Business Operations is unavailable.'))
      .then(v => {
        if (!abort.signal.aborted) setContext(v);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);
  const tabs = context
    ? [
        ...(context.canView
          ? [
              ['insights', 'Analytics'],
              ...(context.canDemandView ? [['demand', 'Demand & matching']] : []),
            ]
          : []),
        ...(context.canAmend || context.canApprove ? [['amendments', 'Amendments']] : []),
        ...(context.canManage ? [['administration', 'Projects & access']] : []),
      ]
    : [];
  const selected = tabs.some(([id]) => id === tab) ? tab : tabs[0]?.[0];
  return (
    <div className="bo-page">
      <header className="bo-heading">
        <div>
          <span className="bo-eyebrow">BUSINESS OPERATIONS</span>
          <h1>
            {context && !context.canView
              ? 'Master amendments & administration'
              : 'Workforce intelligence'}
          </h1>
          <p>
            {context && !context.canView
              ? 'Propose and review changes using your current permissions.'
              : 'Skills, credentials and renewal priorities across your authorized scope.'}
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('assistant-context-request', {
                detail: {
                  prompt:
                    'Use my current authorized Business Operations tools to summarize skill coverage, credential expiry and the most urgent actions. State scope, as-of time and any missing data.',
                },
              }),
            )
          }
        >
          <Sparkles size={17} /> Ask AI
        </button>
      </header>
      {error && (
        <p className="bo-error" role="alert">
          {error}
        </p>
      )}
      <nav className="bo-tabs" aria-label="Business Operations sections">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            aria-current={selected === id ? 'page' : undefined}
            onClick={() => setParams(updateBusinessFilters(params, { tab: id }))}
          >
            {label}
          </button>
        ))}
      </nav>
      {!context && !error && (
        <div className="bo-skeleton" aria-label="Loading authorized workspace" />
      )}
      {context && selected === 'insights' && <Insights context={context} />}
      {context && selected === 'administration' && <BusinessAdministration onSaved={setContext} />}
      {context && (selected === 'amendments' || selected === 'demand') && (
        <BusinessWorkflows key={selected} context={context} view={selected} />
      )}
    </div>
  );
}
function Bars({
  title,
  items,
  onFilter,
  description,
}: {
  title: string;
  items: { label: string; value: number }[];
  onFilter?: (label: string) => void;
  description: string;
}) {
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <section className="bo-panel">
      <h2>{title}</h2>
      <p className="bo-note">{description}</p>
      <div className="bo-bars">
        {items.map(item => (
          <button
            key={item.label}
            disabled={!onFilter}
            onClick={() => onFilter?.(item.label)}
            aria-label={`${item.label}: ${item.value}${onFilter ? ', filter records' : ''}`}
          >
            <span>{item.label}</span>
            <i>
              <b style={{ width: (100 * item.value) / max + '%' }} />
            </i>
            <strong>{item.value}</strong>
          </button>
        ))}
        {!items.length && <p>No matching records.</p>}
      </div>
    </section>
  );
}
function Insights({ context }: { context: BusinessContext }) {
  const [params, setParams] = useSearchParams(),
    filters = businessFilters(params),
    key = filters.toString(),
    [loaded, setLoaded] = useState<{ key: string; data: BusinessDashboard }>(),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [exporting, setExporting] = useState(false),
    exportGuard = useRef(false);
  const data = loaded?.key === key ? loaded.data : undefined;
  const [search, setSearch] = useState(params.get('search') ?? '');
  useEffect(() => setSearch(params.get('search') ?? ''), [params.get('search')]);
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    authenticatedFetch('/api/business/dashboard?' + key, { signal: abort.signal })
      .then(r => readApiResponse<BusinessDashboard>(r, 'Analytics could not be loaded.'))
      .then(v => {
        if (!abort.signal.aborted) setLoaded({ key, data: v });
      })
      .catch(e => {
        if (!abort.signal.aborted) {
          setLoaded(undefined);
          setError(e.message);
        }
      });
    return () => abort.abort();
  }, [key, attempt]);
  const change = (patch: Record<string, string>) => setParams(updateBusinessFilters(params, patch));
  const exportAbort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    exportAbort.current?.abort();
    exportGuard.current = false;
    setExporting(false);
    return () => exportAbort.current?.abort();
  }, [key]);
  const download = async (format: string) => {
    if (exportGuard.current) return;
    exportGuard.current = true;
    setExporting(true);
    setError('');
    const abort = new AbortController();
    exportAbort.current = abort;
    try {
      const q = new URLSearchParams(key);
      q.set('format', format);
      const response = await authenticatedFetch('/api/business/export?' + q, {
        signal: abort.signal,
      });
      if (!response.ok) await readApiResponse(response, 'Export could not be generated.');
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `business-${filters.get('dataset')}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    } finally {
      if (exportAbort.current === abort) {
        exportGuard.current = false;
        setExporting(false);
      }
    }
  };
  const scopes = (data?.context ?? context).scopes.filter(s => s.effect === 'ALLOW');
  const cleared = {
    category: '',
    issuer: '',
    skillId: '',
    minRank: '',
    maxRank: '',
    status: '',
    validity: '',
    sort: '',
  };
  const cards = [
    [
      'employees',
      'Authorized employees',
      Users,
      {
        dataset: 'people',
        validity: '',
        issuer: '',
        skillId: '',
        minRank: '',
        maxRank: '',
        status: '',
      },
    ],
    [
      'certified',
      'Currently certified',
      ShieldCheck,
      { dataset: 'certifications', validity: 'CURRENT', status: 'APPROVED' },
    ],
    [
      'skilled',
      'Reviewed skill holders',
      BarChart3,
      { dataset: 'skills', status: 'APPROVED', validity: '', issuer: '' },
    ],
    [
      'pending',
      'Awaiting review',
      Clock3,
      { dataset: 'submissions', status: 'SUBMITTED', validity: '' },
    ],
    [
      'expired',
      'Expired credentials',
      AlertCircle,
      { dataset: 'certifications', validity: 'EXPIRED', status: '' },
    ],
    [
      'expiring',
      'Expiring in 30 days',
      Clock3,
      { dataset: 'certifications', validity: '30', status: '' },
    ],
  ] as const;
  return (
    <>
      <section className="bo-scopebar" aria-label="Analytics filters">
        <label>
          Scope
          <select
            value={params.get('scopeId') ?? ''}
            onChange={e => change({ scopeId: e.target.value })}
          >
            <option value="">All authorized scopes</option>
            {scopes.map(s => (
              <option key={s.id} value={s.id}>
                {s.kind.replaceAll('_', ' ')} · {s.label}
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={e => {
            e.preventDefault();
            change({ search });
          }}
        >
          <label>
            Employee or code
            <input
              value={search}
              maxLength={100}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search employee…"
            />
          </label>
          <button className="secondary-button">Search</button>
        </form>
        <label>
          Activity from
          <input
            type="date"
            value={params.get('from') ?? ''}
            onChange={e => change({ from: e.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={params.get('to') ?? ''}
            onChange={e => change({ to: e.target.value })}
          />
        </label>
        <button className="secondary-button" onClick={() => setParams(new URLSearchParams())}>
          Reset
        </button>
      </section>
      <div className="bo-chips">
        {[...filters]
          .filter(([k, v]) => !['dataset', 'page', 'minRank'].includes(k) && v)
          .map(([k, v]) => (
            <button
              key={k}
              onClick={() => change(k === 'maxRank' ? { minRank: '', maxRank: '' } : { [k]: '' })}
            >
              {(
                {
                  scopeId: 'Scope',
                  skillId: 'Skill',
                  maxRank: 'Proficiency',
                  status: 'Review status',
                  validity: 'Validity',
                  from: 'Activity from',
                  to: 'Activity to',
                  sort: 'Sort',
                  search: 'Employee search',
                  issuer: 'Issuer',
                  category: 'Category',
                } as Record<string, string>
              )[k] ?? k}
              :{' '}
              {k === 'scopeId'
                ? (scopes.find(s => s.id === v)?.label ?? 'Selected scope')
                : k === 'skillId'
                  ? (loaded?.data.coverage.find(c => c.id === v)?.label ?? 'Selected skill')
                  : k === 'maxRank'
                    ? `L${params.get('minRank') ?? '1'}–L${v}`
                    : v.replaceAll('_', ' ')}
              <X size={13} />
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
      </div>
      {error && (
        <p className="bo-error" role="alert">
          {error} <button onClick={() => setAttempt(n => n + 1)}>Retry</button>
        </p>
      )}
      <div className="bo-metrics" aria-busy={!data && !error}>
        {cards.map(([id, label, Icon, patch]) => (
          <button
            key={id}
            className={'bo-metric bo-' + id}
            onClick={() => change({ ...cleared, ...patch })}
            disabled={!data}
          >
            <Icon size={22} />
            <span>{label}</span>
            <strong>{data ? data.summary[id] : <span className="bo-loading-number" />}</strong>
          </button>
        ))}
      </div>
      <p className="bo-note">
        Current coverage as of{' '}
        {data ? new Date(data.context.asOf).toLocaleString() + ' (local time)' : '…'}. Combined
        scopes count each person once. Activity dates affect the trend only. Review status filters
        the record table; snapshots retain separate reviewed and pending totals.
      </p>
      {!data && !error && (
        <>
          <div className="bo-chart-grid" aria-label="Loading analytics panels">
            {['Skill coverage', 'Issuers', 'Categories', 'Renewal priorities', 'Activity'].map(
              label => (
                <section className="bo-panel" key={label}>
                  <h2>{label}</h2>
                  <div className="bo-skeleton" />
                </section>
              ),
            )}
          </div>
          <section className="bo-panel">
            <h2>Compare authorized scopes</h2>
            <div className="bo-skeleton" />
          </section>
          <section className="bo-panel">
            <h2>Explore records</h2>
            <div className="bo-skeleton" />
          </section>
        </>
      )}
      {data && (
        <>
          <div className="bo-chart-grid">
            <section className="bo-panel bo-coverage">
              <h2>Reviewed skill coverage</h2>
              <p className="bo-note">
                Top 10 skills. Holders by proficiency, out of {data.summary.employees} authorized
                employees. Historical ranks above five are grouped as L5+; this does not establish
                framework equivalence. Select a cell to inspect claims.
              </p>
              <div className="bo-heatmap">
                {[...new Set(data.coverage.map(c => c.label))].map(label => (
                  <div key={label}>
                    <strong>{label}</strong>
                    {[1, 2, 3, 4, 5].map(rank => {
                      const cell = data.coverage.find(c => c.label === label && c.rank === rank);
                      return (
                        <button
                          key={rank}
                          disabled={!cell}
                          style={{
                            background: cell
                              ? 'color-mix(in srgb, var(--bo-accent) ' +
                                Math.max(
                                  12,
                                  Math.min(
                                    80,
                                    (100 * cell.holders) / Math.max(1, data.summary.employees),
                                  ),
                                ) +
                                '%, var(--surface))'
                              : undefined,
                          }}
                          onClick={() =>
                            change({
                              dataset: 'skills',
                              skillId: cell!.id,
                              minRank: String(rank),
                              maxRank: String(rank),
                              status: 'APPROVED',
                              validity: '',
                              issuer: '',
                            })
                          }
                          aria-label={`${label}, level ${rank}: ${cell?.holders ?? 0} reviewed holders; show level ${rank}`}
                        >
                          <small>
                            L{rank}
                            {rank === 5 ? '+' : ''}
                          </small>
                          {cell?.holders ?? 0}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              {!data.coverage.length && <p>No reviewed skills in this scope.</p>}
            </section>
            <Bars
              title="Certification issuers (top 15)"
              items={data.distribution}
              description="Manager-reviewed credential records; validity is tracked independently."
              onFilter={issuer => change({ dataset: 'certifications', issuer, status: 'APPROVED' })}
            />
            <Bars
              title="Credential categories (top 15)"
              items={data.categories ?? []}
              description="Reviewed credential records, grouped by declared category."
              onFilter={category =>
                change({
                  dataset: 'certifications',
                  category,
                  status: 'APPROVED',
                  skillId: '',
                  minRank: '',
                  maxRank: '',
                })
              }
            />
            <Bars
              title="Renewal priorities"
              items={data.expiry}
              description="Credential counts by expiry date, including reviewed and unresolved submissions."
              onFilter={label =>
                change({
                  dataset: 'certifications',
                  validity: (
                    {
                      Expired: 'EXPIRED',
                      'No expiry': 'NO_EXPIRY',
                      '14 days': '14',
                      '30 days': '15_30',
                      '60 days': '31_60',
                      '90 days': '61_90',
                      Later: 'LATER',
                    } as Record<string, string>
                  )[label],
                  status: '',
                })
              }
            />
            <section className="bo-panel">
              <h2>Submission and review activity</h2>
              <p className="bo-note">
                Current authorized people. Submission and manager-decision timestamps.
              </p>
              <div className="bo-trend">
                {data.activity.slice(-12).map(item => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <i
                      aria-label={`${item.submissions} submissions`}
                      style={{
                        height:
                          Math.max(
                            3,
                            (100 * item.submissions) /
                              Math.max(
                                1,
                                ...data.activity.map(i => Math.max(i.submissions, i.decisions)),
                              ),
                          ) + 'px',
                      }}
                    />
                    <b
                      aria-label={`${item.decisions} decisions`}
                      style={{
                        height:
                          Math.max(
                            3,
                            (100 * item.decisions) /
                              Math.max(
                                1,
                                ...data.activity.map(i => Math.max(i.submissions, i.decisions)),
                              ),
                          ) + 'px',
                      }}
                    />
                    <small>
                      {item.submissions} / {item.decisions}
                    </small>
                  </div>
                ))}
              </div>
              <details>
                <summary>View activity table</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Submissions</th>
                      <th>Decisions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activity.map(i => (
                      <tr key={i.label}>
                        <td>{i.label}</td>
                        <td>{i.submissions}</td>
                        <td>{i.decisions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </section>
          </div>
          {!!data.comparisons?.length && (
            <section className="bo-panel">
              <h2>Compare authorized scopes</h2>
              <p className="bo-note">
                Current filtered holdings within each allowed binding (up to 30). Project
                memberships can overlap; these totals must not be added together.
              </p>
              <div className="bo-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Scope</th>
                      <th>Employees</th>
                      <th>Currently certified</th>
                      <th>Reviewed skill holders</th>
                      <th>Explore</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.comparisons.map(c => (
                      <tr key={c.id}>
                        <td>
                          {c.label}
                          <small> · {c.kind.replaceAll('_', ' ')}</small>
                        </td>
                        <td>{c.employees}</td>
                        <td>{c.certified}</td>
                        <td>{c.skilled}</td>
                        <td>
                          <button
                            className="secondary-button"
                            onClick={() => change({ scopeId: c.id, dataset: 'people' })}
                          >
                            View scope
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section className="bo-panel bo-records">
            <div className="bo-record-heading">
              <div>
                <h2>Explore records</h2>
                <p className="bo-note">
                  {data.total.toLocaleString()} matching records · private drafts and files excluded
                </p>
              </div>
              <div className="bo-export">
                <button
                  disabled={exporting || !data.context.canExport}
                  className="secondary-button"
                  onClick={() => download('csv')}
                >
                  <ArrowDownToLine size={16} /> CSV
                </button>
                <button
                  disabled={exporting || !data.context.canExport}
                  className="secondary-button"
                  onClick={() => download('xlsx')}
                >
                  <ArrowDownToLine size={16} /> Excel
                </button>
              </div>
            </div>
            <div className="bo-record-filters">
              <label>
                Sort
                <select
                  value={
                    filters.get('sort') ??
                    (filters.get('dataset') === 'people' ? 'employee_asc' : 'updated_desc')
                  }
                  onChange={e => change({ sort: e.target.value })}
                >
                  <option value="employee_asc">Employee A–Z</option>
                  <option value="employee_desc">Employee Z–A</option>
                  {filters.get('dataset') !== 'people' && (
                    <>
                      <option value="name_asc">Record A–Z</option>
                      <option value="updated_desc">Recently updated</option>
                      {filters.get('dataset') === 'certifications' && (
                        <option value="expiry_asc">Earliest expiry</option>
                      )}
                    </>
                  )}
                </select>
              </label>
              <label>
                Dataset
                <select
                  value={filters.get('dataset') ?? 'people'}
                  onChange={e =>
                    change({
                      dataset: e.target.value,
                      sort: '',
                      validity: '',
                      issuer: '',
                      skillId: '',
                      minRank: '',
                      maxRank: '',
                      category: '',
                      status: '',
                    })
                  }
                >
                  <option value="people">People</option>
                  <option value="skills">Skills</option>
                  <option value="certifications">Certifications</option>
                  <option value="submissions">All submissions</option>
                </select>
              </label>
              <label>
                Review status
                <select
                  disabled={filters.get('dataset') === 'people'}
                  value={filters.get('status') ?? ''}
                  onChange={e => change({ status: e.target.value })}
                >
                  <option value="">All submitted states</option>
                  <option value="SUBMITTED">Awaiting review</option>
                  <option value="APPROVED">Manager reviewed</option>
                  <option value="CHANGES_REQUESTED">Changes requested</option>
                  <option value="REJECTED">Not approved</option>
                </select>
              </label>
              <label>
                Validity
                <select
                  disabled={filters.get('dataset') === 'skills'}
                  value={filters.get('validity') ?? ''}
                  onChange={e => change({ validity: e.target.value })}
                >
                  <option value="">All validity states</option>
                  <option value="CURRENT">Current</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="NO_EXPIRY">No expiry</option>
                  <option value="LATER">Beyond 90 days</option>
                  {[
                    ['15_30', '15–30 days'],
                    ['31_60', '31–60 days'],
                    ['61_90', '61–90 days'],
                  ].map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                  {[14, 30, 60, 90].map(n => (
                    <option key={n} value={String(n)}>
                      Expires in {n} days
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="bo-table-wrap">
              <table>
                <thead>
                  <tr>
                    {Object.keys(data.rows[0] ?? { employee: '', employeeCode: '' })
                      .filter(k => k !== 'id')
                      .map(k => (
                        <th key={k}>{k.replace(/([A-Z])/g, ' $1')}</th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, index) => (
                    <tr key={String(row.id ?? index)}>
                      {Object.entries(row)
                        .filter(([k]) => k !== 'id')
                        .map(([k, v]) => (
                          <td key={k}>
                            <span className={v === 'EXPIRED' ? 'bo-danger' : undefined}>
                              {v === null ? '—' : String(v).replaceAll('_', ' ')}
                            </span>
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.rows.length && (
                <p className="bo-empty">
                  No matching records. Adjust the filters to explore your scope.
                </p>
              )}
            </div>
            <footer className="bo-pagination">
              <span>
                Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))} · exports
                include every matching row, up to 50,000
              </span>
              <button
                className="secondary-button"
                disabled={data.page <= 1}
                onClick={() => change({ page: String(data.page - 1) })}
              >
                Previous
              </button>
              <button
                className="secondary-button"
                disabled={data.page * data.pageSize >= data.total}
                onClick={() => change({ page: String(data.page + 1) })}
              >
                Next
              </button>
            </footer>
          </section>
        </>
      )}
    </>
  );
}
