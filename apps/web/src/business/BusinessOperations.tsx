import { useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import {
  ArrowDownToLine,
  BarChart3,
  Users,
  ShieldCheck,
  Clock3,
  AlertCircle,
  Sparkles,
  X,
  Eye,
  Award,
  TrendingUp,
  Layers,
  Search,
  RotateCcw,
  Info,
  Calendar,
  Building2,
  ChevronRight,
  Home,
  CheckCircle2,
  ArrowRight,
  PieChart,
  UserCheck,
  UserX,
  Trophy,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { BusinessWorkflows } from './BusinessWorkflows';
import {
  businessFilters,
  businessScopeChoices,
  businessScopeLabel,
  businessCoverageRows,
  businessPeriod,
  updateBusinessFilters,
  type BusinessContext,
  type BusinessDashboard,
} from './business-model';
import './business.css';
import { BusinessRecordDate } from './BusinessRecordDate';
import { BusinessRecordFiles } from './BusinessRecordFiles';
import { AnalyticsOverview } from './AnalyticsOverview';

export function BusinessOperations() {
  const [params, setParams] = useSearchParams(),
    [context, setContext] = useState<BusinessContext>(),
    [error, setError] = useState('');
  const tab = params.get('tab') ?? 'insights';

  useEffect(() => {
    const abort = new AbortController();
    authenticatedFetch('/api/business/context', { signal: abort.signal })
      .then(r => readApiResponse<BusinessContext>(r, 'Analytics is unavailable.'))
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
      ]
    : [];
  const selected = tabs.some(([id]) => id === tab) ? tab : tabs[0]?.[0];

  if (context && tab === 'amendments' && (context.canAmend || context.canApprove)) {
    const next = new URLSearchParams({ tab: 'amendments' });
    const ticket = params.get('draftTicket');
    if (ticket) next.set('draftTicket', ticket);
    return <Navigate replace to={'/skills?' + next} />;
  }

  if (context && tab === 'administration' && context.canManage)
    return <Navigate replace to="/access?view=profiles" />;
  if (context && !context.canView)
    return <p role="status">Business analytics access is not assigned.</p>;

  return (
    <div className="bo-page">
      {selected === 'demand' && (
        <header className="bo-heading bo-heading-compact">
          <h2 className="sr-only">Business analytics</h2>
          {/* Main Section Navigation Tabs */}
          <nav className="bo-tabs" aria-label="Analytics sections">
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

          {context?.canView && (
            <button
              className="secondary-button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('assistant-context-request', {
                    detail: {
                      prompt:
                        'Summarize my current authorized business analytics: skill coverage, credential renewals and gaps. State scope and as-of time.',
                    },
                  }),
                )
              }
            >
              <Sparkles size={16} /> Ask AI
            </button>
          )}
        </header>
      )}
      {error && (
        <p className="bo-error" role="alert">
          {error}
        </p>
      )}

      {!context && !error && (
        <div className="bo-skeleton" aria-label="Loading authorized workspace" />
      )}

      {context && selected === 'insights' && <Insights context={context} />}
      {context && selected === 'demand' && (
        <BusinessWorkflows key={selected} context={context} view="demand" />
      )}
    </div>
  );
}

function MetricTooltip({ text }: { text: string }) {
  return (
    <span className="bo-info-tooltip" title={text} aria-label={text} tabIndex={0}>
      <Info size={13} aria-hidden="true" />
    </span>
  );
}

function Bars({
  title,
  items,
  onFilter,
  description,
  icon: Icon = BarChart3,
  tooltip,
}: {
  title: string;
  items: { label: string; value: number }[];
  onFilter?: (label: string) => void;
  description: string;
  icon?: any;
  tooltip?: string;
}) {
  const max = Math.max(1, ...items.map(i => i.value));
  const total = items.reduce((acc, curr) => acc + curr.value, 0);

  return (
    <section className="bo-panel bo-card-elevated">
      <div className="bo-panel-header">
        <div className="bo-panel-title-group">
          <div className="bo-panel-icon-badge">
            <Icon size={18} aria-hidden="true" />
          </div>
          <div>
            <h2 className="bo-panel-title">
              {title}
              {tooltip && <MetricTooltip text={tooltip} />}
            </h2>
            <p className="bo-note">{description}</p>
          </div>
        </div>
        {total > 0 && <span className="bo-count-pill">{total.toLocaleString()} total</span>}
      </div>

      <div className="bo-bars">
        {items.map(item => {
          const pct = Math.round((item.value / max) * 100);
          return (
            <button
              key={item.label}
              disabled={!onFilter}
              onClick={() => onFilter?.(item.label)}
              className="bo-bar-row"
              aria-label={`${item.label}: ${item.value}${onFilter ? ', filter records' : ''}`}
            >
              <span className="bo-bar-label" title={item.label}>
                {item.label}
              </span>
              <div className="bo-bar-track">
                <b className="bo-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <strong className="bo-bar-val">{item.value.toLocaleString()}</strong>
            </button>
          );
        })}
        {!items.length && <p className="bo-empty-chart">No matching records found.</p>}
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

  const [fileRecord, setFileRecord] = useState<{ kind: string; id: string; name: string }>();
  const analyticalView = ['community', 'skills', 'certifications', 'records'].includes(
    params.get('view') ?? '',
  )
    ? params.get('view')!
    : params.get('dataset')
      ? 'records'
      : 'community';
  const setAnalyticalView = (view: string) =>
    setParams(current => updateBusinessFilters(current, { view }));
  const resetFilters = () =>
    setParams(new URLSearchParams({ tab: 'insights', view: analyticalView }));

  useEffect(() => setFileRecord(undefined), [key]);

  const data = loaded?.data;
  const pending = loaded ? loaded.key !== key : !error;
  const [search, setSearch] = useState(params.get('search') ?? '');

  useEffect(() => setSearch(params.get('search') ?? ''), [params.get('search')]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleOutsideClick = (e: MouseEvent) => {
      const details = document.querySelector<HTMLDetailsElement>('.bo-toolbar-dropdown[open]');
      if (details && !details.contains(e.target as Node)) {
        details.removeAttribute('open');
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const details = document.querySelector<HTMLDetailsElement>('.bo-toolbar-dropdown[open]');
      if (!details) return;
      details.removeAttribute('open');
      details.querySelector<HTMLElement>('summary')?.focus();
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

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

  const change = (patch: Record<string, string>) => {
    setParams(current =>
      updateBusinessFilters(current, {
        ...patch,
        ...(patch.dataset || patch.skillId || patch.validity || patch.minRank
          ? { view: 'records' }
          : {}),
      }),
    );
  };

  const exportAbort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    exportAbort.current?.abort();
    exportGuard.current = false;
    setExporting(false);
    return () => exportAbort.current?.abort();
  }, [key]);

  const download = async (format: string) => {
    if (exportGuard.current || pending || !data?.context.canExport) return;
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

  const scopes = businessScopeChoices(
    (data?.context ?? context).scopes,
    params.get('scopeId') ?? '',
  );

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

  // Quick period helper
  const setQuickPeriod = (preset: 'all' | '30' | '90' | 'ytd') => {
    change(businessPeriod(preset));
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
      'Total active employees across all authorized organizational scopes.',
      'Active Scope',
    ],
    [
      'certified',
      'Currently certified',
      ShieldCheck,
      { dataset: 'certifications', validity: 'CURRENT', status: 'APPROVED' },
      'Employees holding at least one manager-approved, currently active certification.',
      'Active Credentials',
    ],
    [
      'skilled',
      'Reviewed skill holders',
      BarChart3,
      { dataset: 'skills', status: 'APPROVED', validity: '', issuer: '' },
      'Employees with at least one manager-reviewed skill. Saved definition versions remain unchanged.',
      'Manager reviewed',
    ],
    [
      'pending',
      'Pending records',
      Clock3,
      { dataset: 'submissions', status: 'SUBMITTED', validity: '' },
      'Individual skill and credential records awaiting manager review; a combined request may contain several records.',
      'Needs Action',
    ],
    [
      'expired',
      'Expired credentials',
      AlertCircle,
      { dataset: 'certifications', validity: 'EXPIRED', status: '' },
      'Credentials that have passed their expiration date.',
      'Expired',
    ],
    [
      'expiring',
      'Expiring in 30 days',
      Clock3,
      { dataset: 'certifications', validity: '30', status: '' },
      'Credentials requiring renewal attention within the next 30 days.',
      'Due Soon',
    ],
  ] as const;

  // Compute Population Metrics
  const totalEmployees = data?.summary.employees ?? 0;

  // Active filter count (excluding dataset and page)
  const activeFilterList = [...filters].filter(
    ([k, v]) =>
      !['dataset', 'page'].includes(k) && !(k === 'minRank' && filters.has('maxRank')) && v,
  );
  const secondaryFilterCount = activeFilterList.filter(
    ([k]) => !['scopeId', 'search'].includes(k),
  ).length;

  return (
    <>
      {/* Analytical Sub-Tab Views for Drill-through & Organization */}
      <div className="bo-perspective-bar">
        <nav className="bo-perspective-tabs" aria-label="Analytics views">
          <button
            className={`bo-perspective-btn ${analyticalView === 'community' ? 'active' : ''}`}
            aria-current={analyticalView === 'community' ? 'page' : undefined}
            onClick={() => setAnalyticalView('community')}
          >
            <BarChart3 size={15} /> Overview
          </button>
          <button
            className={`bo-perspective-btn ${analyticalView === 'skills' ? 'active' : ''}`}
            aria-current={analyticalView === 'skills' ? 'page' : undefined}
            onClick={() => setAnalyticalView('skills')}
          >
            <Award size={15} /> Skill coverage
          </button>
          <button
            className={`bo-perspective-btn ${analyticalView === 'certifications' ? 'active' : ''}`}
            aria-current={analyticalView === 'certifications' ? 'page' : undefined}
            onClick={() => setAnalyticalView('certifications')}
          >
            <ShieldCheck size={15} /> Certificates & renewals
          </button>

          <button
            className={`bo-perspective-btn ${analyticalView === 'records' ? 'active' : ''}`}
            aria-current={analyticalView === 'records' ? 'page' : undefined}
            onClick={() => {
              setAnalyticalView('records');
            }}
          >
            <Layers size={15} /> People & records
          </button>
        </nav>
        <div className="an-navigation-actions">
          {context.canDemandView && (
            <button
              className="secondary-button"
              onClick={() =>
                setParams(current => updateBusinessFilters(current, { tab: 'demand' }))
              }
            >
              Demand & matching <ArrowRight size={14} />
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            aria-label="Ask AI about analytics"
            title="Ask AI about analytics"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent('assistant-context-request', {
                  detail: {
                    prompt:
                      'Summarize my current authorized analytics: skill coverage, credential renewals and gaps. State scope and as-of time.',
                  },
                }),
              )
            }
          >
            <Sparkles size={16} />
          </button>
        </div>
      </div>

      {/* Sleek Horizontal Filter Toolbar */}
      <section
        className="bo-filter-toolbar bo-filter-center"
        aria-label="Workforce Analytics Filters"
      >
        <div className="bo-toolbar-primary-row">
          {/* Scope Selector */}
          <div className="bo-toolbar-scope-wrap">
            <Building2 size={15} className="bo-toolbar-scope-icon" aria-hidden="true" />
            <select
              value={params.get('scopeId') ?? ''}
              onChange={e => change({ scopeId: e.target.value })}
              className="bo-select bo-toolbar-scope-select"
              aria-label="Scope filter"
              title="Filter by assigned organizational scope"
            >
              <option value="">All my scopes</option>
              {scopes.map(s => (
                <option key={s.id} value={s.id}>
                  {businessScopeLabel(s)}
                </option>
              ))}
            </select>
            <MetricTooltip text="Select an assigned organization, Delivery Unit, Department or Project responsibility. This does not add access." />
          </div>

          {/* Employee Search */}
          <form
            className="bo-toolbar-search-form"
            onSubmit={e => {
              e.preventDefault();
              change({ search });
            }}
          >
            <div className="bo-search-input-wrap">
              <Search size={14} className="bo-search-icon" aria-hidden="true" />
              <input
                value={search}
                maxLength={100}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search employee or code…"
                className="bo-input bo-search-input"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    change({ search: '' });
                  }}
                  className="bo-search-clear-btn"
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button type="submit" className="bo-toolbar-search-btn">
              Search
            </button>
          </form>

          {/* More Filters Popover Trigger */}
          <details className="bo-extra-filters bo-toolbar-dropdown">
            <summary className="bo-toolbar-filter-btn">
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span>More filters</span>
              {secondaryFilterCount > 0 && (
                <span className="bo-secondary-badge">{secondaryFilterCount}</span>
              )}
              <ChevronDown size={13} className="bo-chevron-icon" aria-hidden="true" />
            </summary>

            {/* Floating Popover Container */}
            <div className="bo-dropdown-popover">
              <div className="bo-popover-header">
                <div className="bo-popover-title-group">
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  <strong>Additional Filters</strong>
                </div>
                {secondaryFilterCount > 0 && (
                  <button
                    type="button"
                    className="bo-popover-reset-btn"
                    onClick={() =>
                      change({
                        category: '',
                        issuer: '',
                        skillId: '',
                        minRank: '',
                        maxRank: '',
                        status: '',
                        validity: '',
                        from: '',
                        to: '',
                      })
                    }
                  >
                    Reset filters
                  </button>
                )}
              </div>

              <div className="bo-filter-secondary-row">
                {/* Quick Period & Date Range */}
                <div className="bo-period-group">
                  <span className="bo-field-title">
                    Activity period (UTC)
                    <MetricTooltip text="Filters submission and decision activity. Coverage and current validity remain as-of-now metrics." />
                  </span>
                  <div className="bo-period-quick-bar">
                    <button
                      type="button"
                      className={`bo-period-pill ${!params.get('from') && !params.get('to') ? 'active' : ''}`}
                      onClick={() => setQuickPeriod('all')}
                    >
                      All time
                    </button>
                    <button
                      type="button"
                      className="bo-period-pill"
                      onClick={() => setQuickPeriod('30')}
                    >
                      Last 30d
                    </button>
                    <button
                      type="button"
                      className="bo-period-pill"
                      onClick={() => setQuickPeriod('90')}
                    >
                      Last 90d
                    </button>
                    <button
                      type="button"
                      className="bo-period-pill"
                      onClick={() => setQuickPeriod('ytd')}
                    >
                      YTD
                    </button>
                  </div>
                  <div className="bo-date-inputs-row">
                    <input
                      type="date"
                      value={params.get('from') ?? ''}
                      onChange={e => change({ from: e.target.value })}
                      aria-label="Activity from date"
                      className="bo-input bo-date-input"
                    />
                    <span className="bo-date-sep">to</span>
                    <input
                      type="date"
                      value={params.get('to') ?? ''}
                      onChange={e => change({ to: e.target.value })}
                      aria-label="Activity to date"
                      className="bo-input bo-date-input"
                    />
                  </div>
                </div>

                {/* Associated Skill */}
                {!!data?.coverage.length && (
                  <label className="bo-field-label">
                    <span className="bo-field-title">Associated skill</span>
                    <select
                      value={params.get('skillId') ?? ''}
                      onChange={e => change({ skillId: e.target.value })}
                      className="bo-select"
                    >
                      <option value="">All skills</option>
                      {Array.from(
                        new Set(
                          data.coverage.map(c => JSON.stringify({ id: c.id, label: c.label })),
                        ),
                      )
                        .map(jsonStr => JSON.parse(jsonStr))
                        .map(item => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                    </select>
                  </label>
                )}

                {/* Proficiency Level */}
                <label className="bo-field-label">
                  <span className="bo-field-title">Proficiency level</span>
                  <select
                    value={
                      params.get('minRank') || params.get('maxRank')
                        ? `${params.get('minRank') ?? '1'}_${params.get('maxRank') ?? '4'}`
                        : ''
                    }
                    onChange={e => {
                      const val = e.target.value;
                      if (!val) change({ minRank: '', maxRank: '' });
                      else {
                        const [min, max] = val.split('_');
                        change({ minRank: min, maxRank: max });
                      }
                    }}
                    className="bo-select"
                  >
                    <option value="">All supported ranks (L1–L4)</option>
                    <option value="1_1">L1</option>
                    <option value="2_2">L2</option>
                    <option value="3_3">L3</option>
                    <option value="4_4">L4</option>
                    {(params.has('minRank') || params.has('maxRank')) &&
                      params.get('minRank') !== params.get('maxRank') && (
                        <option
                          value={`${params.get('minRank') ?? '1'}_${params.get('maxRank') ?? '4'}`}
                        >
                          Ranks L{params.get('minRank') ?? '1'}–L{params.get('maxRank') ?? '4'}
                        </option>
                      )}
                  </select>
                </label>

                {/* Pillar / Category */}
                {!!data?.categories?.length && (
                  <label className="bo-field-label">
                    <span className="bo-field-title">Credential category</span>
                    <select
                      value={params.get('category') ?? ''}
                      onChange={e => change({ category: e.target.value })}
                      className="bo-select"
                    >
                      <option value="">All credential categories</option>
                      {data.categories.map(c => (
                        <option key={c.label} value={c.label}>
                          {c.label} ({c.value})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {/* Certification Issuer */}
                {!!data?.distribution?.length && (
                  <label className="bo-field-label">
                    <span className="bo-field-title">Issuer / Provider</span>
                    <select
                      value={params.get('issuer') ?? ''}
                      onChange={e => change({ issuer: e.target.value })}
                      className="bo-select"
                    >
                      <option value="">All issuers</option>
                      {data.distribution.map(d => (
                        <option key={d.label} value={d.label}>
                          {d.label} ({d.value})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {/* Review Status */}
                <label className="bo-field-label">
                  <span className="bo-field-title">Record review status</span>
                  <select
                    value={params.get('status') ?? ''}
                    onChange={e => change({ status: e.target.value })}
                    className="bo-select"
                  >
                    <option value="">All review statuses</option>
                    <option value="SUBMITTED">Awaiting review</option>
                    <option value="APPROVED">Manager reviewed</option>
                    <option value="CHANGES_REQUESTED">Changes requested</option>
                    <option value="REJECTED">Not approved</option>
                  </select>
                </label>

                {/* Validity Filter */}
                <label className="bo-field-label">
                  <span className="bo-field-title">Validity window</span>
                  <select
                    value={params.get('validity') ?? ''}
                    onChange={e => change({ validity: e.target.value })}
                    className="bo-select"
                  >
                    <option value="">All validity states</option>
                    <option value="CURRENT">Current & active</option>
                    <option value="EXPIRED">Expired</option>
                    <option value="14">Expires in 14 days</option>
                    <option value="30">Expires in 30 days</option>
                    <option value="60">Expires in 60 days</option>
                    <option value="90">Expires in 90 days</option>
                    <option value="15_30">15–30 days</option>
                    <option value="31_60">31–60 days</option>
                    <option value="61_90">61–90 days</option>
                    <option value="NO_EXPIRY">No expiration</option>
                    <option value="LATER">Beyond 90 days</option>
                  </select>
                </label>
              </div>
            </div>
          </details>

          {/* Reset button if any filters active */}
          {activeFilterList.length > 0 && (
            <button
              type="button"
              className="bo-toolbar-clear-btn"
              onClick={resetFilters}
              title="Reset all filters to default"
            >
              <RotateCcw size={12} aria-hidden="true" />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* Active Selections Chips Row */}
        {activeFilterList.length > 0 && (
          <div className="bo-chips-bar">
            <span className="bo-chips-label">Active filters:</span>
            <div className="bo-chips">
              {activeFilterList.map(([k, v]) => (
                <button
                  key={k}
                  className="bo-chip-btn"
                  onClick={() =>
                    change(
                      k === 'maxRank' || k === 'minRank'
                        ? { minRank: '', maxRank: '' }
                        : { [k]: '' },
                    )
                  }
                  title={`Remove ${k} filter`}
                >
                  <span className="bo-chip-key">
                    {(
                      {
                        scopeId: 'Scope',
                        skillId: 'Skill',
                        maxRank: 'Proficiency',
                        minRank: 'Minimum rank',
                        status: 'Status',
                        validity: 'Validity',
                        from: 'From',
                        to: 'To',
                        sort: 'Sort',
                        search: 'Search',
                        issuer: 'Issuer',
                        category: 'Category',
                      } as Record<string, string>
                    )[k] ?? k}
                    :
                  </span>
                  <span className="bo-chip-val">
                    {k === 'scopeId'
                      ? (scopes.find(s => s.id === v)?.label ?? 'Selected scope')
                      : k === 'skillId'
                        ? (loaded?.data.coverage.find(c => c.id === v)?.label ?? 'Selected skill')
                        : k === 'maxRank'
                          ? `L${params.get('minRank') ?? '1'}–L${v}`
                          : v.replaceAll('_', ' ')}
                  </span>
                  <X size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
            <button type="button" className="bo-clear-all-text-btn" onClick={resetFilters}>
              Clear all
            </button>
          </div>
        )}
      </section>

      {error && (
        <p className="bo-error" role="alert">
          {error} <button onClick={() => setAttempt(n => n + 1)}>Retry query</button>
        </p>
      )}

      {/* Executive KPI Ribbon */}
      <div className="bo-metrics" aria-busy={pending}>
        {cards
          .filter(
            ([id]) => !['expired', 'expiring'].includes(id) || analyticalView === 'certifications',
          )
          .map(([id, label, Icon, patch, tooltip, tag]) => {
            const isCardActive =
              analyticalView === 'records' &&
              Object.entries({ ...cleared, ...patch }).every(
                ([field, value]) => field === 'sort' || (filters.get(field) ?? '') === value,
              );

            return (
              <button
                key={id}
                className={`bo-metric bo-${id} ${isCardActive ? 'bo-metric-active' : ''}`}
                onClick={() => change({ ...cleared, ...patch })}
                disabled={!data || pending}
                title={`Filter by ${label}`}
              >
                <div className="bo-metric-top">
                  <div className="bo-metric-icon-badge">
                    <Icon size={16} aria-hidden="true" />
                  </div>
                  <MetricTooltip text={tooltip} />
                </div>
                <div className="bo-metric-content">
                  <span className="bo-metric-label">{label}</span>
                  <div className="bo-metric-val-row">
                    <strong className="bo-metric-number">
                      {data ? (
                        data.summary[id].toLocaleString()
                      ) : (
                        <span className="bo-loading-number" />
                      )}
                    </strong>
                    {tag && (
                      <span className={`bo-metric-tag bo-tag-${id}`}>
                        {data && ['certified', 'skilled'].includes(id)
                          ? `${data.summary.employees ? Math.round((100 * data.summary[id]) / data.summary.employees) : 0}% of scope`
                          : tag}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
      </div>

      {data && pending && (
        <p className="bo-note bo-updating-notice" role="status">
          Updating results… Charts show the previous snapshot until selected filters finish loading.
        </p>
      )}

      <p className="bo-note bo-context-asof">
        Updated {data ? new Date(data.context.asOf).toLocaleString() : '…'}
        <span>
          {' '}
          ·{' '}
          {params.get('scopeId')
            ? scopes.find(s => s.id === params.get('scopeId'))?.label
            : [...new Set(scopes.map(s => s.label))].join(', ') || 'Your authorized scope'}
        </span>
      </p>
      {!data && !error && (
        <div className="bo-chart-grid" aria-label="Loading analytics panels">
          {['Skill-wise headcount', 'Issuers', 'Pillars', 'Renewal priorities', 'Activity'].map(
            label => (
              <section className="bo-panel bo-card-elevated" key={label}>
                <h2>{label}</h2>
                <div className="bo-skeleton" />
              </section>
            ),
          )}
        </div>
      )}

      {data && (
        <>
          {analyticalView === 'community' && (
            <AnalyticsOverview
              data={data}
              pending={pending}
              dataset={filters.get('dataset') ?? 'people'}
              onChange={change}
              onView={setAnalyticalView}
              onExport={download}
              exporting={exporting}
              onOpenFiles={row =>
                setFileRecord({
                  kind:
                    filters.get('dataset') === 'submissions'
                      ? row.type === 'SKILL'
                        ? 'skills'
                        : 'certifications'
                      : filters.get('dataset')!,
                  id: String(row.id).replace(/^(skill|certification)-/, ''),
                  name: String(row.name ?? 'record'),
                })
              }
            />
          )}
          {/* SECTION 1: SKILL-WISE HEADCOUNT & 4-LEVEL MATRIX */}
          {(analyticalView === 'all' || analyticalView === 'skills') && (
            <section className="bo-panel bo-coverage bo-card-elevated">
              <div className="bo-panel-header">
                <div className="bo-panel-title-group">
                  <div className="bo-panel-icon-badge">
                    <Award size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="bo-panel-title">
                      Skill coverage
                      <MetricTooltip text="Reviewed holders by saved proficiency rank. Definitions can differ by version; matching ranks do not establish equivalent proficiency." />
                    </h2>
                    <p className="bo-note">
                      Holders by proficiency rank, evaluated against {data.summary.employees}{' '}
                      authorized workforce members. Historical snapshots remain intact. Click any
                      cell to inspect employee claims.
                    </p>
                  </div>
                </div>
                <div className="bo-level-legend">
                  <span>
                    <i className="bo-l-dot l1" /> L1
                  </span>
                  <span>
                    <i className="bo-l-dot l2" /> L2
                  </span>
                  <span>
                    <i className="bo-l-dot l3" /> L3
                  </span>
                  <span>
                    <i className="bo-l-dot l4" /> L4
                  </span>
                </div>
              </div>

              <div className="bo-heatmap">
                {businessCoverageRows(data.coverage).map(({ id, label, cells }) => {
                  const rowTotal = [1, 2, 3, 4].reduce(
                    (sum, r) => sum + (cells.get(r)?.holders ?? 0),
                    0,
                  );
                  const coveragePct =
                    totalEmployees > 0
                      ? Math.min(100, Math.round((rowTotal / totalEmployees) * 100))
                      : 0;
                  return (
                    <div key={id} className="bo-heatmap-row">
                      <div className="bo-heatmap-skill-label">
                        <strong title={label}>{label}</strong>
                        <small className="bo-skill-coverage-meta">
                          {rowTotal} holders ({coveragePct}%)
                        </small>
                      </div>
                      <div className="bo-heatmap-cells">
                        {[1, 2, 3, 4].map(rank => {
                          const cell = cells.get(rank);
                          const holders = cell?.holders ?? 0;
                          return (
                            <button
                              key={rank}
                              disabled={!cell || holders === 0}
                              className={`bo-heatmap-cell rank-${rank} ${holders > 0 ? 'has-holders' : 'empty'}`}
                              style={{
                                background:
                                  holders > 0
                                    ? 'color-mix(in srgb, var(--bo-accent) ' +
                                      Math.max(
                                        15,
                                        Math.min(
                                          85,
                                          (100 * holders) / Math.max(1, data.summary.employees),
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
                              aria-label={`${label}, level ${rank}: ${holders} reviewed holders; drill-through level ${rank}`}
                            >
                              <span className="bo-cell-rank-tag">L{rank}</span>
                              <strong className="bo-cell-val">{holders}</strong>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!data.coverage.length && (
                <p className="bo-empty-chart">No reviewed skill claims recorded in this scope.</p>
              )}
            </section>
          )}

          {/* SECTION 2: CERTIFICATIONS, PILLARS & ISSUERS */}
          {(analyticalView === 'all' || analyticalView === 'certifications') && (
            <div className="bo-chart-grid">
              {/* Certification-wise headcount / Top Issuers (Requirement H: Certification-wise headcount) */}
              <Bars
                title="Certificates by issuer"
                items={data.distribution}
                description="Manager-reviewed credential records by issuing body (e.g., Microsoft, AWS, Cisco)."
                icon={ShieldCheck}
                tooltip="Credential record counts, not distinct employee headcount, grouped by issuer. Expired reviewed records are included unless validity is filtered."
                onFilter={issuer =>
                  change({ dataset: 'certifications', issuer, status: 'APPROVED' })
                }
              />

              {/* Pillar-wise certification summary (Requirement H: Pillar-wise certification summary) */}
              <Bars
                title="Certificates by category"
                items={data.categories ?? []}
                description="Reviewed credentials categorized by architectural & practice domain."
                icon={Layers}
                tooltip="Stored credential categories. These are not an approved Pillar or Practice mapping."
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

              {/* Renewal Priorities & Validity Status */}
              <Bars
                title="Renewal priorities"
                items={data.expiry}
                description="Credential counts categorized by upcoming expiry windows and compliance status."
                icon={Clock3}
                tooltip="Proactive compliance monitoring for expiring and expired certifications."
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

              {/* Month-wise certification growth (Requirement H: Month-wise certification growth) */}
              <section className="bo-panel bo-card-elevated">
                <div className="bo-panel-header">
                  <div className="bo-panel-title-group">
                    <div className="bo-panel-icon-badge">
                      <TrendingUp size={18} aria-hidden="true" />
                    </div>
                    <div>
                      <h2 className="bo-panel-title">
                        Submission and review activity
                        <MetricTooltip text="Monthly trend comparing employee submissions against manager review decisions." />
                      </h2>
                      <p className="bo-note">
                        Skill and credential submissions and review decisions over the last 12
                        active months. Decisions include approval, changes requested and rejection.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bo-trend-legend">
                  <span>
                    <i className="bo-trend-dot sub" /> Submissions
                  </span>
                  <span>
                    <i className="bo-trend-dot dec" /> Manager Decisions
                  </span>
                </div>

                <div className="bo-trend">
                  {data.activity.slice(-12).map(item => {
                    const maxVal = Math.max(
                      1,
                      ...data.activity.map(i => Math.max(i.submissions, i.decisions)),
                    );
                    const subHeight = Math.max(4, (120 * item.submissions) / maxVal);
                    const decHeight = Math.max(4, (120 * item.decisions) / maxVal);
                    return (
                      <div key={item.label} className="bo-trend-col">
                        <span className="bo-trend-label">{item.label}</span>
                        <div className="bo-trend-bars-pair">
                          <i
                            className="bo-trend-bar sub"
                            title={`${item.label}: ${item.submissions} submissions`}
                            aria-label={`${item.submissions} submissions`}
                            style={{ height: `${subHeight}px` }}
                          />
                          <b
                            className="bo-trend-bar dec"
                            title={`${item.label}: ${item.decisions} decisions`}
                            aria-label={`${item.decisions} decisions`}
                            style={{ height: `${decHeight}px` }}
                          />
                        </div>
                        <small className="bo-trend-counts">
                          {item.submissions} / {item.decisions}
                        </small>
                      </div>
                    );
                  })}
                  {!data.activity.length && <p className="bo-empty-chart">No activity recorded.</p>}
                </div>

                <details className="bo-details-table">
                  <summary>View monthly growth audit table</summary>
                  <table className="bo-sub-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Submissions</th>
                        <th>Manager Decisions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.activity.map(i => (
                        <tr key={i.label}>
                          <td>{i.label}</td>
                          <td>
                            <strong>{i.submissions}</strong>
                          </td>
                          <td>
                            <strong>{i.decisions}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </section>
            </div>
          )}

          {/* SECTION 3: COMMUNITY DASHBOARD & CERTIFICATION LEADERBOARD */}
          {analyticalView === 'community' && !!data.comparisons?.length && (
            <details className="bo-panel an-scope-comparison">
              <summary>Compare authorized scopes</summary>
              <div className="bo-community-leaderboard-grid">
                {/* Workforce by scope (Requirement H: Community capability dashboard) */}
                {!!data.comparisons?.length && (
                  <section className="bo-panel bo-card-elevated">
                    <div className="bo-panel-header">
                      <div className="bo-panel-title-group">
                        <div className="bo-panel-icon-badge">
                          <Building2 size={18} aria-hidden="true" />
                        </div>
                        <div>
                          <h2 className="bo-panel-title">
                            Workforce by scope
                            <MetricTooltip text="Capability benchmark across organizational scopes (Delivery Units, Departments, Projects)." />
                          </h2>
                          <p className="bo-note">
                            Comparison across allowed bindings (up to 30). Project memberships can
                            overlap.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="bo-table-wrap">
                      <table className="bo-comparison-table">
                        <thead>
                          <tr>
                            <th>Scope</th>
                            <th>Headcount</th>
                            <th>Currently Certified</th>
                            <th>Reviewed Skills</th>
                            <th>Drill-through</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.comparisons.map(c => {
                            const certPct =
                              c.employees > 0 ? Math.round((c.certified / c.employees) * 100) : 0;
                            return (
                              <tr key={c.id}>
                                <td>
                                  <strong>{c.label}</strong>
                                  <small className="bo-scope-kind-pill">
                                    {' '}
                                    · {c.kind.replaceAll('_', ' ')}
                                  </small>
                                </td>
                                <td>{c.employees}</td>
                                <td>
                                  <div className="bo-table-progress-cell">
                                    <span>
                                      {c.certified} ({certPct}%)
                                    </span>
                                    <div className="bo-mini-track">
                                      <div
                                        className="bo-mini-fill"
                                        style={{ width: `${certPct}%` }}
                                      />
                                    </div>
                                  </div>
                                </td>
                                <td>{c.skilled}</td>
                                <td>
                                  <button
                                    className="secondary-button bo-btn-sm"
                                    onClick={() => change({ scopeId: c.id, dataset: 'people' })}
                                  >
                                    View scope
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </div>
            </details>
          )}

          {/* SECTION 4: RECORDS EXPLORER (Full Drill-through, CSV/Excel Export & Attachment View) */}
          {analyticalView === 'records' && (
            <section
              id="explore-records-section"
              className="bo-panel bo-records"
              aria-busy={pending}
            >
              <div className="bo-record-heading">
                <div>
                  <h2 className="bo-panel-title">
                    People & records
                    <MetricTooltip text="Browse matching employees, skills, credentials, and full submission history with direct audit files." />
                  </h2>
                  <p className="bo-note">
                    {pending
                      ? 'Updating matching records…'
                      : `${data.total.toLocaleString()} matching records`}{' '}
                    · private drafts excluded; evidence files open separately
                  </p>
                </div>
                <div className="bo-export">
                  <button
                    disabled={pending || exporting || !data.context.canExport}
                    className="secondary-button"
                    onClick={() => download('csv')}
                    title="Export full filtered report to CSV"
                  >
                    <ArrowDownToLine size={16} /> CSV
                  </button>
                  <button
                    disabled={pending || exporting || !data.context.canExport}
                    className="secondary-button"
                    onClick={() => download('xlsx')}
                    title="Export full filtered report to Excel"
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
                    className="bo-select"
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
                    className="bo-select"
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
                    className="bo-select"
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
                    className="bo-select"
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

              <div className="bo-record-results">
                {pending && (
                  <p role="status" className="bo-record-loading">
                    Loading matching records…
                  </p>
                )}
                <div
                  className="bo-table-wrap"
                  aria-hidden={pending || undefined}
                  style={{ visibility: pending ? 'hidden' : undefined }}
                >
                  <table>
                    <thead>
                      <tr>
                        {Object.keys(data.rows[0] ?? { employee: '', employeeCode: '' })
                          .filter(
                            k => !['id', 'submittedBy', 'reviewedBy', 'canViewFiles'].includes(k),
                          )
                          .map(k => (
                            <th key={k}>
                              {k === 'submittedAt'
                                ? 'Submitted on'
                                : k === 'reviewedAt'
                                  ? 'Reviewed on'
                                  : k === 'currentCertifications'
                                    ? 'Current Certifications'
                                    : k === 'reviewedSkills'
                                      ? 'Reviewed Skills'
                                      : k.replace(/([A-Z])/g, ' $1')}
                            </th>
                          ))}
                        {filters.get('dataset') !== 'people' && <th>Files</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, index) => (
                        <tr key={String(row.id ?? index)}>
                          {Object.entries(row)
                            .filter(
                              ([k]) =>
                                !['id', 'submittedBy', 'reviewedBy', 'canViewFiles'].includes(k),
                            )
                            .map(([k, v]) => (
                              <td key={k}>
                                {['submittedAt', 'reviewedAt', 'issued', 'expiry'].includes(k) ? (
                                  <BusinessRecordDate
                                    value={v}
                                    by={
                                      k === 'submittedAt'
                                        ? row.submittedBy
                                        : k === 'reviewedAt'
                                          ? row.reviewedBy
                                          : undefined
                                    }
                                  />
                                ) : k === 'status' ? (
                                  <span className={`cap-status-pill ${String(v).toLowerCase()}`}>
                                    {String(v).replaceAll('_', ' ')}
                                  </span>
                                ) : (
                                  <span className={v === 'EXPIRED' ? 'bo-danger' : undefined}>
                                    {v === null
                                      ? '—'
                                      : ['validity', 'type'].includes(k)
                                        ? String(v).replaceAll('_', ' ')
                                        : String(v)}
                                  </span>
                                )}
                              </td>
                            ))}
                          {filters.get('dataset') !== 'people' && (
                            <td>
                              {row.canViewFiles === true ? (
                                <button
                                  type="button"
                                  className="secondary-button bo-btn-sm"
                                  disabled={pending}
                                  aria-label={`View submitted files for ${row.name}`}
                                  title="View certificate or evidence"
                                  onClick={() =>
                                    setFileRecord({
                                      kind:
                                        filters.get('dataset') === 'submissions'
                                          ? row.type === 'SKILL'
                                            ? 'skills'
                                            : 'certifications'
                                          : filters.get('dataset')!,
                                      id: String(row.id).replace(/^(skill|certification)-/, ''),
                                      name: String(row.name ?? 'record'),
                                    })
                                  }
                                >
                                  <Eye size={15} />
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.rows.length && (
                    <p className="bo-empty">
                      No matching records found. Adjust your active filters to explore your
                      authorized scope.
                    </p>
                  )}
                </div>
              </div>

              <footer className="bo-pagination">
                <span>
                  {pending
                    ? 'Updating page…'
                    : `Page ${data.page} of ${Math.max(1, Math.ceil(data.total / data.pageSize))}`}{' '}
                  · exports include every matching row, up to 50,000
                </span>
                <button
                  className="secondary-button"
                  disabled={pending || data.page <= 1}
                  onClick={() => change({ page: String(data.page - 1) })}
                >
                  Previous
                </button>
                <button
                  className="secondary-button"
                  disabled={pending || data.page * data.pageSize >= data.total}
                  onClick={() => change({ page: String(data.page + 1) })}
                >
                  Next
                </button>
              </footer>
            </section>
          )}
        </>
      )}

      {fileRecord && (
        <BusinessRecordFiles
          key={fileRecord.kind + fileRecord.id}
          {...fileRecord}
          onClose={() => setFileRecord(undefined)}
        />
      )}
    </>
  );
}
