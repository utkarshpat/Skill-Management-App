import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { authenticatedFetch } from './auth';
import { FormDialog } from './FormDialog';
import { SkillClaimDialog } from './SkillClaimDialog';
import type { Claim } from './MySkills';
import { Recommendations } from './Recommendations';
import { CapabilitySubmissions } from './capabilities/CapabilitySubmissions';
import { TeamCapability } from './TeamCapability';
import type { ClaimReviewDecision } from './ClaimReviewAccess';
import { toast } from './toast';
import {
  ArrowRight,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  MessageSquareMore,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
  XCircle,
} from 'lucide-react';
import './review-workbench.css';
import { reviewView } from './review-navigation';

async function result<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => undefined);
  if (!response.ok)
    throw Object.assign(
      Error(
        data?.error?.message ??
          'This action could not finish. Reload to check the current state before retrying.',
      ),
      { status: response.status },
    );
  return data;
}
const accessDenied = (reason: unknown) =>
  [401, 403].includes((reason as { status?: number } | undefined)?.status ?? 0);
interface ReviewQueue {
  claims: Claim[];
  total: number;
  pageSize: number;
  canViewTeam?: boolean;
  canAskTeamAi?: boolean;
  canRecommend?: boolean;
  canReadHistory?: boolean;
  categories?: string[];
  summary?: { pending: number; approved: number; changes: number; rejected: number };
}
const reviewLabels: Record<string, string> = {
  SUBMITTED: 'Pending review',
  APPROVED: 'Manager reviewed',
  CHANGES_REQUESTED: 'Changes requested',
  REJECTED: 'Not approved',
  ALL: 'All review states',
};
export function SkillReviews({
  unified = false,
  queueContent,
  includeCombined = false,
  teamContent,
  recommendationContent,
}: {
  unified?: boolean;
  queueContent?: ReactNode;
  includeCombined?: boolean;
  teamContent?: ReactNode;
  recommendationContent?: ReactNode;
} = {}) {
  const [params, setParams] = useSearchParams(),
    [view, setView] = useState<'queue' | 'team' | 'recommendations'>('queue');
  const [data, setData] = useState<ReviewQueue>(),
    [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true),
    [opening, setOpening] = useState(false),
    [error, setError] = useState(''),
    [denied, setDenied] = useState(false),
    [claim, setClaim] = useState<Claim>();
  useEffect(() => setView(reviewView(params)), [params]);
  useEffect(() => {
    const refresh = () => {
      if (!claim && !opening) setAttempt(n => n + 1);
    };
    window.addEventListener('notifications-remote-updated', refresh);
    return () => window.removeEventListener('notifications-remote-updated', refresh);
  }, [claim, opening]);
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [status, setStatus] = useState('SUBMITTED'),
    [person, setPerson] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setClaim(undefined);
    const filters = new URLSearchParams({ page: String(page), search: query, category, status });
    if (person) filters.set('person', person);
    authenticatedFetch('/api/skill-reviews?' + filters, { signal: controller.signal })
      .then(result<ReviewQueue>)
      .then(value => {
        if (!controller.signal.aborted) {
          setDenied(false);
          setData(value);
        }
      })
      .catch(reason => {
        if (!controller.signal.aborted) {
          setDenied(accessDenied(reason));
          setData(undefined);
          setClaim(undefined);
          setError(reason.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, attempt, query, category, status, person]);
  useEffect(() => {
    const id = params.get('claim');
    if (!id || loading || !data) return;
    const next = new URLSearchParams(params);
    next.delete('claim');
    setParams(next, { replace: true });
    void openClaim(id);
  }, [params, loading, data]);
  function displayClaim(item: Claim) {
    if (unified && item.activeSubmissionId) {
      const next = new URLSearchParams(params);
      next.delete('claim');
      next.set('submission', item.activeSubmissionId);
      next.set('tab', 'queue');
      setParams(next, { replace: true });
      setView('queue');
      return;
    }
    setClaim(item);
  }
  async function openClaim(id: string) {
    if (opening) return;
    setOpening(true);
    setError('');
    try {
      if (!data?.canReadHistory) {
        const item = data?.claims.find(c => c.id === id);
        if (!item) throw Error('This claim is unavailable in your current queue.');
        displayClaim(item);
      } else {
        const detail = await result<{ claim: Claim; reviewAccess: ClaimReviewDecision }>(
          await authenticatedFetch('/api/skill-reviews/' + encodeURIComponent(id)),
        );
        displayClaim({ ...detail.claim, reviewAccess: detail.reviewAccess });
      }
    } catch (e) {
      setClaim(undefined);
      setError(e instanceof Error ? e.message : 'Review unavailable.');
    } finally {
      setOpening(false);
    }
  }
  function clear() {
    setSearch('');
    setQuery('');
    setCategory('');
    setStatus('SUBMITTED');
    setPerson(undefined);
    setPage(1);
  }
  const filtered = Boolean(query || category || person || status !== 'SUBMITTED');
  const metrics = [
    {
      key: 'SUBMITTED',
      label: 'Awaiting review',
      hint: 'Ready for your decision',
      value: data?.summary?.pending,
      icon: Clock3,
      tone: 'amber',
    },
    {
      key: 'APPROVED',
      label: 'Manager reviewed',
      hint: 'Approved proficiency claims',
      value: data?.summary?.approved,
      icon: FileCheck2,
      tone: 'teal',
    },
    {
      key: 'CHANGES_REQUESTED',
      label: 'Changes requested',
      hint: 'Feedback shared with employees',
      value: data?.summary?.changes,
      icon: MessageSquareMore,
      tone: 'blue',
    },
    {
      key: 'REJECTED',
      label: 'Not approved',
      hint: 'Claims with a recorded decision',
      value: data?.summary?.rejected,
      icon: XCircle,
      tone: 'rose',
    },
  ];
  const changeView = (nextView: 'queue' | 'team' | 'recommendations') => {
    setView(nextView);
    const next = new URLSearchParams(params);
    next.set('tab', nextView === 'team' ? 'analytics' : nextView);
    next.delete('claim');
    next.delete('submission');
    next.delete('recommendation');
    next.delete('type');
    next.delete('person');
    next.delete('certification');
    setParams(next, { replace: true });
  };
  const linkedPerson = params.get('person')?.toLowerCase();
  const navigation = (
    <nav
      className="review-workspace-tabs"
      aria-label={unified ? 'Review workspace' : 'Skill review workspace'}
    >
      <button
        aria-pressed={view === 'queue'}
        onClick={() => {
          changeView('queue');
          setAttempt(n => n + 1);
        }}
      >
        <ClipboardCheck size={18} />
        Review queue
      </button>
      {data?.canViewTeam && (
        <button aria-pressed={view === 'team'} onClick={() => changeView('team')}>
          <UsersRound size={18} />
          Team analytics
        </button>
      )}
      {data?.canRecommend && (
        <button
          aria-pressed={view === 'recommendations'}
          onClick={() => changeView('recommendations')}
        >
          <MessageSquareMore size={18} />
          Recommendations
        </button>
      )}
    </nav>
  );
  const initialLoading = !data && loading;
  function refreshReviews() {
    setAttempt(n => n + 1);
  }
  function renderQueue(
    combined?: Parameters<
      NonNullable<ComponentProps<typeof CapabilitySubmissions>['renderQueue']>
    >[0],
  ) {
    const matchingSubmissions = (combined?.records ?? []).filter(
      item =>
        (!person || item.personId?.toLowerCase() === person.toLowerCase()) &&
        (!query ||
          [item.name, item.label].some(value =>
            value?.toLowerCase().includes(query.toLowerCase()),
          )),
    );
    const showCombined = status === 'ALL' || status === 'SUBMITTED';
    const submissions = showCombined && page === 1 ? matchingSubmissions : [];
    const combinedIds = new Set(submissions.map(item => item.id.toLowerCase()));
    const claims = (data?.claims ?? []).filter(
      item =>
        item.status !== 'SUBMITTED' ||
        !item.activeSubmissionId ||
        !combinedIds.has(item.activeSubmissionId.toLowerCase()),
    );
    return (
      <>
        {!unified && error && (
          <div className="review-error" role="alert">
            <span>{error}</span>
            <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
              Retry
            </button>
          </div>
        )}
        {!includeCombined && (data?.summary || loading) && (
          <div className="review-metrics" aria-label="Filter reviews by status">
            {metrics.map(item => (
              <button
                className={'review-metric ' + item.tone}
                key={item.key}
                disabled={loading}
                aria-pressed={status === item.key}
                title={`${item.label} (${loading ? '—' : (item.value ?? 0)}): ${item.hint}`}
                onClick={() => {
                  setStatus(item.key);
                  setPage(1);
                }}
              >
                <span className="review-metric-icon">
                  <item.icon size={19} />
                </span>
                <span className="review-metric-label">{item.label}</span>
                <strong className="review-metric-count">{loading ? '—' : (item.value ?? 0)}</strong>
              </button>
            ))}
          </div>
        )}
        <section
          className="review-workbench"
          aria-label={includeCombined ? 'Assigned reviews' : 'Assigned skill reviews'}
          aria-busy={loading}
        >
          <header>
            <div>
              <h3>
                {includeCombined
                  ? 'Assigned reviews'
                  : status === 'ALL'
                    ? 'All assigned reviews'
                    : reviewLabels[status]}
              </h3>
              {!includeCombined && (
                <p>
                  {loading
                    ? 'Checking current assignments…'
                    : data
                      ? `${data.total} ${data.total === 1 ? 'claim' : 'claims'}${filtered ? ' matching your filters' : ' assigned to you'}`
                      : 'Assigned review data is unavailable.'}
                </p>
              )}
            </div>
          </header>
          <form
            className="review-filters"
            onSubmit={e => {
              e.preventDefault();
              setPage(1);
              setQuery(search.trim());
            }}
          >
            <div className="review-search">
              <Search size={18} />
              <input
                type="search"
                aria-label="Search review employee or skill"
                placeholder="Search employee, code, skill or request…"
                maxLength={100}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <button type="submit" disabled={loading}>
                Search
              </button>
            </div>
            <select
              aria-label="Review category"
              value={category}
              onChange={e => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">
                {includeCombined ? 'All skill categories' : 'All categories'}
              </option>
              {data?.categories?.map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Review status"
              value={status}
              onChange={e => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {Object.entries(reviewLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="review-clear"
              disabled={!filtered && !search}
              onClick={clear}
            >
              Clear
            </button>
          </form>
          {person && (
            <div className="review-filter-note">
              Showing one team member’s assigned reviews.
              <button
                onClick={() => {
                  setPerson(undefined);
                  setPage(1);
                }}
              >
                Show all direct reports
              </button>
            </div>
          )}
          {opening && (
            <p className="review-opening" role="status">
              Checking current claim access…
            </p>
          )}
          {includeCombined && category && (
            <p className="review-filter-note">
              Skill category filters apply to individual skill claims.
            </p>
          )}
          {showCombined && page > 1 && matchingSubmissions.length > 0 && (
            <p className="review-filter-note">Combined submissions appear on page 1.</p>
          )}
          {combined?.error && (
            <div className="review-error" role="alert">
              <span>{combined.error}</span>
              <button className="secondary-button" onClick={combined.retry}>
                Retry
              </button>
            </div>
          )}
          {combined?.loading && (
            <p className="review-opening" role="status">
              Loading combined submissions…
            </p>
          )}
          {loading && (
            <div className="review-loading" role="status">
              <span className="review-loading-icon">
                <RefreshCw size={22} className="review-spin" />
              </span>
              <strong>Loading your review queue</strong>
              <p>Checking current assignments and claim status.</p>
            </div>
          )}
          {!loading &&
            data &&
            !claims.length &&
            !submissions.length &&
            !combined?.loading &&
            !combined?.error && (
              <div className="review-empty">
                <span className="review-empty-icon">
                  {filtered ? <Search size={30} /> : <CheckCheck size={32} />}
                </span>
                <h3>
                  {filtered
                    ? 'No matching reviews'
                    : includeCombined
                      ? 'No combined or individual skill reviews on this page'
                      : 'You’re all caught up'}
                </h3>
                <p>
                  {filtered
                    ? 'Try another employee, category or review status.'
                    : 'New requests assigned to you will appear here.'}
                </p>
                <div className="review-empty-actions">
                  {filtered ? (
                    <button className="secondary-button" onClick={clear}>
                      Reset filters
                    </button>
                  ) : (
                    <>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setStatus('ALL');
                          setPage(1);
                        }}
                      >
                        View all review states
                        <ArrowRight size={16} />
                      </button>
                      {data.canViewTeam && (
                        <button className="review-text-action" onClick={() => changeView('team')}>
                          Explore team analytics
                          <ArrowRight size={16} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          {((!loading && claims.length > 0) || submissions.length > 0) && (
            <div className="my-skills-table-wrap">
              <table className="my-skills-table review-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>{includeCombined ? 'Request' : 'Skill / category'}</th>
                    <th>{includeCombined ? 'Details' : 'Claimed proficiency'}</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map(item => (
                    <tr key={'submission-' + item.id}>
                      <td>
                        <strong>{item.name}</strong>
                      </td>
                      <td>
                        <strong>{item.label || 'Capability submission'}</strong>
                        <span className="review-subtext">Combined submission</span>
                      </td>
                      <td>
                        {item.skills} {item.skills === 1 ? 'skill' : 'skills'} ·{' '}
                        {item.certifications}{' '}
                        {item.certifications === 1 ? 'certificate' : 'certificates'}
                      </td>
                      <td>
                        <span className="review-status submitted">Pending review</span>
                      </td>
                      <td>
                        {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        <button className="admin-primary" onClick={() => combined?.open(item.id)}>
                          Review request <ArrowRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading &&
                    claims.map(item => (
                      <tr key={item.id}>
                        <td>
                          <div className="review-person">
                            <span className="review-person-avatar" aria-hidden="true">
                              {(item.personName ?? '')
                                .split(' ')
                                .filter(Boolean)
                                .slice(0, 2)
                                .map(n => n[0])
                                .join('')}
                            </span>
                            <strong>{item.personName}</strong>
                          </div>
                        </td>
                        <td>
                          <strong>{item.skillName}</strong>
                          <span className="review-subtext">
                            {includeCombined ? 'Individual skill · ' : ''}
                            {item.category}
                          </span>
                        </td>
                        <td>
                          <span className="review-level">L{item.rank}</span>
                          <span className="review-subtext">{item.levelName}</span>
                        </td>
                        <td>
                          <span className={'review-status ' + item.status.toLowerCase()}>
                            {reviewLabels[item.status] ?? item.status}
                          </span>
                        </td>
                        <td>{new Date(item.updatedAt).toLocaleDateString()}</td>
                        <td>
                          <button
                            className={
                              item.status === 'SUBMITTED' ? 'admin-primary' : 'secondary-button'
                            }
                            disabled={opening}
                            onClick={() => void openClaim(item.id)}
                          >
                            {item.status === 'SUBMITTED' ? 'Review claim' : 'View history'}
                            <ArrowRight size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && data && data.total > 0 && (
            <footer>
              <span>
                Showing {(page - 1) * data.pageSize + 1}–
                {Math.min(page * data.pageSize, data.total)} of {data.total} individual skill claims
              </span>
              <div className="review-pagination">
                <button
                  aria-label="Previous reviews page"
                  className="secondary-button"
                  disabled={page === 1}
                  onClick={() => setPage(n => n - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>Page {page}</span>
                <button
                  aria-label="Next reviews page"
                  className="secondary-button"
                  disabled={page * data.pageSize >= data.total}
                  onClick={() => setPage(n => n + 1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </footer>
          )}
        </section>
        <p className="review-policy-note">
          <ShieldCheck size={15} />
          Only requests assigned to you from current direct reports appear here.
        </p>
        {!initialLoading && !claim && !error && (opening || Boolean(params.get('claim'))) && (
          <FormDialog
            title="Skill review"
            busy={opening}
            onClose={() => {
              const next = new URLSearchParams(params);
              next.delete('claim');
              setParams(next, { replace: true });
            }}
          >
            <div className="notification-destination-loading" role="status">
              <RefreshCw size={26} className="notification-spin" />
              <strong>Opening skill review…</strong>
              <p>Checking the current claim and your available actions.</p>
            </div>
          </FormDialog>
        )}
      </>
    );
  }
  const workspace = (
    <div
      className="review-shell review-workspace-content"
      hidden={(!unified && initialLoading) || Boolean((!unified || denied) && error && !data)}
    >
      {navigation}
      {view === 'recommendations' && data?.canRecommend ? (
        <>
          <Recommendations sentOnly />
          {recommendationContent}
        </>
      ) : view === 'team' && data?.canViewTeam ? (
        <>
          <TeamCapability
            canAskAi={Boolean(data.canAskTeamAi)}
            supportingContent={teamContent}
            linkedPerson={
              linkedPerson &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(linkedPerson)
                ? linkedPerson
                : undefined
            }
            onLinkedPersonClear={() => {
              if (!params.has('person')) return;
              const next = new URLSearchParams(params);
              next.delete('person');
              setParams(next, { replace: true });
            }}
            onReviews={id => {
              setPerson(id);
              setStatus('SUBMITTED');
              setPage(1);
              setQuery('');
              setSearch('');
              changeView('queue');
            }}
          />
        </>
      ) : (
        <>
          {/* Unmount on denial so nested queues cannot open deep-link dialogs over a denied page. */}

          {unified && error && data && (
            <div className="review-error" role="alert">
              <span>{error}</span>
              <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
                Retry
              </button>
            </div>
          )}
          {!(denied && !data) &&
            (includeCombined ? (
              <CapabilitySubmissions review onUpdated={refreshReviews} renderQueue={renderQueue} />
            ) : (
              renderQueue()
            ))}
          {!(denied && !data) && queueContent}
          {claim && (
            <SkillClaimDialog
              claim={claim}
              mode={claim.status === 'SUBMITTED' && claim.reviewAccess?.allowed ? 'review' : 'view'}
              history={data?.canReadHistory}
              onClose={() => setClaim(undefined)}
              onSaved={() => {
                setClaim(undefined);
                toast.success('Review saved. The employee has been notified.');
                setAttempt(n => n + 1);
                window.dispatchEvent(new Event('notifications-updated'));
              }}
            />
          )}
        </>
      )}
    </div>
  );
  return (
    <>
      {!unified && initialLoading && (
        <section className="review-loading" role="status" aria-busy="true">
          <div className="review-loading-icon" aria-hidden="true">
            <RefreshCw size={24} />
          </div>
          <div>
            <strong>Loading review workspace…</strong>
            <p>Checking your permissions and assigned review queues.</p>
          </div>
        </section>
      )}
      {!initialLoading && error && !data && (
        <div className="review-error" role="alert">
          <span>{error}</span>
          <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {workspace}
    </>
  );
}
