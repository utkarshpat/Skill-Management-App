import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  ArrowRight,
  Search,
  FileText,
  Clock3,
  XCircle,
  AlertCircle,
  Inbox,
  ChevronLeft,
  ChevronRight,
  Send,
} from 'lucide-react';
import { authenticatedFetch } from './auth';
import {
  requestRead,
  requestStatusLabel,
  categoryLabel,
  requestCategories,
  type RequestRecord,
} from './request-model';
interface Summary {
  total: number;
  submitted: number;
  cancelled: number;
  inProgress: number;
  resolved: number;
  incidents: number;
  highPriority: number;
  myTotal: number;
  assignedTotal: number;
}
interface List {
  items: RequestRecord[];
  total: number;
  page: number;
  pageSize: number;
  summary: Summary;
}
export function RequestList({
  active,
  refresh,
  onOpen,
}: {
  active: boolean;
  refresh: number;
  onOpen: (id: string) => void;
}) {
  const [params] = useSearchParams();
  const [list, setList] = useState<List>(),
    [inbox, setInbox] = useState(false),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [kind, setKind] = useState(''),
    [status, setStatus] = useState(''),
    [priority, setPriority] = useState(''),
    [category, setCategory] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const value = params.get('status') ?? '',
      type = params.get('kind') ?? '';
    setStatus(['SUBMITTED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'].includes(value) ? value : '');
    setKind(['REQUEST', 'INCIDENT'].includes(type) ? type : '');
    setInbox(params.get('inbox') === 'true');
    setPage(1);
  }, [params]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!active) return;
    const c = new AbortController();
    setBusy(true);
    setError('');
    const params = new URLSearchParams({
      page: String(page),
      inbox: String(inbox),
      q: query,
      kind,
      status,
      priority,
      category,
    });
    authenticatedFetch('/api/workflows?' + params, { signal: c.signal })
      .then(requestRead<List>)
      .then(l => {
        if (!c.signal.aborted) {
          setList(l);
          setBusy(false);
        }
      })
      .catch(e => {
        if (!c.signal.aborted) {
          if ([401, 403].includes(e.status)) setList(undefined);
          setError(e.message);
          setBusy(false);
        }
      });
    return () => c.abort();
  }, [active, refresh, page, inbox, query, kind, status, priority, category, attempt]);
  function clear() {
    setSearch('');
    setQuery('');
    setKind('');
    setStatus('');
    setPriority('');
    setCategory('');
    setPage(1);
  }
  function chooseCard(value: string) {
    clear();
    if (value === 'INCIDENT') setKind('INCIDENT');
    else if (value === 'HIGH') setPriority('HIGH');
    else setStatus(value);
  }
  function view(value: boolean) {
    setInbox(value);
    setList(undefined);
    clear();
  }
  const s = list?.summary,
    filters = Boolean(search || kind || status || priority || category),
    cards = [
      {
        key: '',
        label: inbox ? 'Assigned to me' : 'Total requests',
        value: s?.total,
        Icon: FileText,
        tone: 'blue',
      },
      { key: 'SUBMITTED', label: 'Submitted', value: s?.submitted, Icon: Clock3, tone: 'amber' },
      {
        key: 'IN_PROGRESS',
        label: 'In progress',
        value: s?.inProgress,
        Icon: Clock3,
        tone: 'amber',
      },
      { key: 'RESOLVED', label: 'Resolved', value: s?.resolved, Icon: FileText, tone: 'teal' },
    ];
  const selectedCard = (key: string) =>
    key === ''
      ? !filters
      : key === 'INCIDENT'
        ? kind === 'INCIDENT' && !status && !priority && !category && !search
        : key === 'HIGH'
          ? priority === 'HIGH' && !status && !kind && !category && !search
          : status === key && !kind && !priority && !category && !search;
  return (
    <div hidden={!active} className="request-workbench">
      <nav className="request-tabs" aria-label="Request views">
        <button aria-current={!inbox ? 'page' : undefined} onClick={() => view(false)}>
          <Send size={17} aria-hidden="true" />
          <span>My requests</span>
          {s !== undefined && <span className="request-tab-count">({s.myTotal})</span>}
        </button>
        <button aria-current={inbox ? 'page' : undefined} onClick={() => view(true)}>
          <Inbox size={17} aria-hidden="true" />
          <span>Assigned to me</span>
          {s !== undefined && <span className="request-tab-count">({s.assignedTotal})</span>}
        </button>
      </nav>
      <section className="request-summary" aria-label="Filter requests by summary">
        {cards.map(({ key, label, value, Icon, tone }) => (
          <button
            key={key}
            className={'request-summary-card ' + tone}
            aria-label={label + (value !== undefined ? ', ' + value : '')}
            aria-pressed={selectedCard(key)}
            disabled={!s}
            onClick={() => chooseCard(key)}
          >
            <span className="request-summary-icon">
              <Icon size={24} />
            </span>
            <span>
              <strong>{value ?? '—'}</strong>
              <small>{label}</small>
            </span>
            <ArrowRight size={18} />
          </button>
        ))}
      </section>
      <section
        className="request-list profile-panel"
        aria-label={inbox ? 'Assigned requests' : 'Your requests'}
        aria-busy={busy}
      >
        <div className="request-filters">
          <label className="request-search">
            <Search size={19} />
            <span className="sr-only">Search requests</span>
            <input
              type="search"
              value={search}
              maxLength={80}
              placeholder="Search subject, ID or description…"
              onChange={e => setSearch(e.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Type filter</span>
            <select
              aria-label="Type filter"
              value={kind}
              onChange={e => {
                setKind(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All types</option>
              <option value="REQUEST">Requests</option>
              <option value="INCIDENT">Incidents</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Category filter</span>
            <select
              aria-label="Category filter"
              value={category}
              onChange={e => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {requestCategories.map(c => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Status filter</span>
            <select
              aria-label="Status filter"
              value={status}
              onChange={e => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Priority filter</span>
            <select
              aria-label="Priority filter"
              value={priority}
              onChange={e => {
                setPriority(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All priorities</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
            </select>
          </label>
          <button className="secondary-button" disabled={!filters} onClick={clear}>
            Clear
          </button>
        </div>
        {error && (
          <p className="request-load-error" role="alert">
            {error}{' '}
            <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
              Retry
            </button>
          </p>
        )}
        {busy && (
          <p className="request-loading" role="status">
            Updating requests…
          </p>
        )}
        {list?.items.length ? (
          <>
            <div className="request-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Subject</th>
                    <th>Type / category</th>
                    <th>{inbox ? 'From' : 'Recipient'}</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map(r => (
                    <tr key={r.id}>
                      <td>
                        <button
                          className="request-reference"
                          disabled={busy}
                          onClick={() => onOpen(r.id)}
                          aria-label={'Open ' + r.reference}
                        >
                          {r.reference}
                        </button>
                      </td>
                      <td className="request-subject">
                        <strong>{r.title}</strong>
                      </td>
                      <td>
                        <span className={'request-topic ' + r.category.toLowerCase()}>
                          {categoryLabel(r.category)}
                        </span>
                        <small className="request-row-kind">
                          {r.kind === 'REQUEST' ? 'Request' : 'Incident'}
                        </small>
                      </td>
                      <td>{inbox ? r.requesterName : r.recipientName}</td>
                      <td>
                        <span className={'request-priority ' + r.priority.toLowerCase()}>
                          {r.priority === 'HIGH' ? 'High' : 'Normal'}
                        </span>
                      </td>
                      <td>
                        <span className={'request-status ' + r.status.toLowerCase()}>
                          {requestStatusLabel(r.status)}
                        </span>
                      </td>
                      <td>
                        <time dateTime={r.updatedAt}>
                          {new Date(r.updatedAt).toLocaleDateString(undefined, {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </time>
                      </td>
                      <td>
                        <button
                          disabled={busy}
                          className="secondary-button request-view"
                          aria-label={'View ' + r.title}
                          onClick={() => onOpen(r.id)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="request-list-footer">
              <span>
                Showing {(list.page - 1) * list.pageSize + 1}–
                {Math.min(list.page * list.pageSize, list.total)} of {list.total}{' '}
                {inbox ? 'assigned records' : 'records'}
              </span>
              <div className="request-pagination">
                <button
                  className="secondary-button"
                  aria-label="Previous request page"
                  disabled={busy || list.page === 1}
                  onClick={() => setPage(list.page - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span className="request-current-page" aria-label={'Request page ' + list.page}>
                  {list.page}
                </span>
                <span className="workspace-muted">
                  of {Math.max(1, Math.ceil(list.total / list.pageSize))}
                </span>
                <button
                  className="secondary-button"
                  aria-label="Next request page"
                  disabled={busy || list.page * list.pageSize >= list.total}
                  onClick={() => setPage(list.page + 1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </footer>
          </>
        ) : (
          !busy &&
          !error && (
            <div className="request-empty">
              <Inbox size={34} />
              <h3>
                {filters
                  ? 'No matching records'
                  : inbox
                    ? 'Nothing assigned yet'
                    : 'What can we help you with?'}
              </h3>
              <p>
                {filters
                  ? 'Try another search or clear the filters.'
                  : inbox
                    ? 'Requests addressed to you will appear here.'
                    : 'Use New request to ask for help or report an issue.'}
              </p>
              {filters && (
                <button className="secondary-button" onClick={clear}>
                  Clear filters
                </button>
              )}
            </div>
          )
        )}
      </section>
    </div>
  );
}
