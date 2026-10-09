import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { CertificationReviewDialog } from './certifications/CertificationReviewDialog';
import type { CertificationPage, CertificationRecord } from './certifications/types';
import { toast } from './toast';
import {
  ArrowRight,
  Award,
  Clock3,
  Search,
  ShieldCheck,
  UsersRound,
  BarChart3,
  MessageSquareMore,
} from 'lucide-react';
import { CertificationRecommendations } from './certifications/CertificationRecommendations';
import './capability-workspace.css';
import './review-workbench.css';
import './certifications/certifications.css';
const SkillReviews = lazy(() => import('./SkillReviews').then(m => ({ default: m.SkillReviews })));

export function ReviewWorkspace({
  certificationsAllowed = false,
}: {
  certificationsAllowed?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const type =
    certificationsAllowed && params.get('type') === 'certifications' ? 'certifications' : 'skills';
  const [data, setData] = useState<CertificationPage>();
  const [analytics, setAnalytics] = useState<{
    pending: number;
    expired: number;
    expiresSoon: number;
    noExpiry: number;
    canRecommend: boolean;
    categories: { category: string; count: number }[];
  }>();
  const [certificationTab, setCertificationTab] = useState<
    'queue' | 'analytics' | 'recommendations'
  >(
    params.get('tab') === 'recommendations'
      ? 'recommendations'
      : params.get('tab') === 'analytics'
        ? 'analytics'
        : 'queue',
  );
  const [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [opening, setOpening] = useState(false);
  const [credential, setCredential] = useState<CertificationRecord>();

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setQuery(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [type]);
  useEffect(() => {
    setCertificationTab(
      params.get('tab') === 'recommendations'
        ? 'recommendations'
        : params.get('tab') === 'analytics'
          ? 'analytics'
          : 'queue',
    );
  }, [params]);
  useEffect(() => {
    const refresh = () => {
      if (!credential && !opening) setAttempt(n => n + 1);
    };
    window.addEventListener('notifications-remote-updated', refresh);
    return () => window.removeEventListener('notifications-remote-updated', refresh);
  }, [credential, opening]);
  useEffect(() => {
    if (type !== 'certifications') return;
    const controller = new AbortController();
    setData(undefined);
    setError('');
    setLoading(true);
    setCredential(undefined);
    const params = new URLSearchParams({ view: 'queue', page: String(page), search: query });
    authenticatedFetch('/api/certifications?' + params, { signal: controller.signal })
      .then(r =>
        readApiResponse<CertificationPage>(r, 'Certification review queue could not be loaded.'),
      )
      .then(value => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, query, attempt, type]);
  useEffect(() => {
    if (type !== 'certifications') return;
    const controller = new AbortController();
    setAnalytics(undefined);
    authenticatedFetch('/api/certification-recommendations/analytics', {
      signal: controller.signal,
    })
      .then(r =>
        readApiResponse<NonNullable<typeof analytics>>(
          r,
          'Certification analytics could not be loaded.',
        ),
      )
      .then(value => {
        if (!controller.signal.aborted) setAnalytics(value);
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [attempt, type]);

  const changeCertificationTab = (tab: 'queue' | 'analytics' | 'recommendations') => {
    setCertificationTab(tab);
    const next = new URLSearchParams(params);
    next.set('type', 'certifications');
    next.set('tab', tab);
    setParams(next, { replace: true });
  };

  const saved = () => {
    setCredential(undefined);
    setAttempt(n => n + 1);
    toast.success('Review saved.');
    window.dispatchEvent(new Event('notifications-updated'));
  };
  const reviewDate = (value: string) => {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
      : 'Date unavailable';
  };
  const hasNext = Boolean(data && page * data.pageSize < data.total);

  return (
    <>
      <nav className="capability-tabs review-type-tabs" aria-label="Review type">
        <Link to="/skill-reviews?type=skills" aria-current={type === 'skills' ? 'page' : undefined}>
          Skills
        </Link>
        {certificationsAllowed && (
          <Link
            to="/skill-reviews?type=certifications"
            aria-current={type === 'certifications' ? 'page' : undefined}
          >
            Certifications
          </Link>
        )}
      </nav>
      {type === 'skills' ? (
        <Suspense fallback={<p role="status">Loading skill review workspace…</p>}>
          <SkillReviews />
        </Suspense>
      ) : (
        <section className="assigned-review-workspace review-shell" aria-busy={loading}>
          <header className="assigned-review-heading">
            <div>
              <span className="assigned-review-eyebrow">Manager workspace</span>
              <h2>Certification reviews</h2>
              <p>Review credentials submitted by your current direct reports.</p>
            </div>
            <span className="assigned-review-scope">
              <UsersRound size={16} /> Current direct reports
            </span>
          </header>
          <nav
            className="review-workspace-tabs certification-review-tabs"
            aria-label="Certification review workspace"
          >
            <button
              aria-pressed={certificationTab === 'queue'}
              onClick={() => changeCertificationTab('queue')}
            >
              <Clock3 size={18} /> Review queue
            </button>
            <button
              aria-pressed={certificationTab === 'analytics'}
              onClick={() => changeCertificationTab('analytics')}
            >
              <BarChart3 size={18} /> Team analytics
            </button>
            {analytics?.canRecommend && (
              <button
                aria-pressed={certificationTab === 'recommendations'}
                onClick={() => changeCertificationTab('recommendations')}
              >
                <MessageSquareMore size={18} /> Recommendations
              </button>
            )}
          </nav>
          {certificationTab === 'queue' && (
            <>
              <div className="assigned-review-summary" aria-label="Certification review summary">
                <article className="assigned-review-total">
                  <span>
                    <Award size={17} /> Pending certifications
                  </span>
                  <strong>{loading ? '—' : (data?.total ?? 0)}</strong>
                  <small>Ready for your review</small>
                </article>
              </div>
              <div className="assigned-review-toolbar">
                <label>
                  <Search size={18} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="Search employee or certification"
                    value={search}
                    maxLength={100}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search employee or certification"
                  />
                </label>
                {query && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setSearch('');
                      setQuery('');
                      setPage(1);
                    }}
                  >
                    Clear search
                  </button>
                )}
              </div>
              {error && (
                <div className="assigned-review-error" role="alert">
                  <span>{error}</span>
                  <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
                    Retry
                  </button>
                </div>
              )}
              {loading && (
                <p className="assigned-review-loading" role="status">
                  Checking current assignments…
                </p>
              )}
              {data && (
                <>
                  <div className="combined-review-list">
                    {data.records.map(record => (
                      <article className="combined-review-item" key={record.id}>
                        <div className="assigned-review-card-main">
                          <div className="assigned-review-card-topline">
                            <span className="combined-review-type">Certification</span>
                            <span className="assigned-review-pending">
                              <Clock3 size={13} /> Pending
                            </span>
                          </div>
                          <h3>{record.certificationName}</h3>
                          <p className="assigned-review-person">
                            {record.name}
                            <span aria-hidden="true"> · </span>
                            {record.provider}
                          </p>
                          <p className="assigned-review-date">
                            Submitted {reviewDate(record.submittedAt ?? '')}
                          </p>
                        </div>
                        <button
                          className="primary-button assigned-review-open"
                          disabled={opening}
                          onClick={() => setCredential(record)}
                        >
                          Review certification <ArrowRight size={16} />
                        </button>
                      </article>
                    ))}
                  </div>
                  {!data.records.length && (
                    <div className="assigned-review-empty">
                      <ShieldCheck size={27} />
                      <h3>{query ? 'No matching certifications' : 'You’re all caught up'}</h3>
                      <p>
                        {query
                          ? 'Try another employee name or certification.'
                          : 'New certification submissions from your current direct reports will appear here.'}
                      </p>
                    </div>
                  )}
                  <div className="assigned-review-pagination">
                    <span>
                      {data.records.length} shown · {data.total} pending
                      {query ? ' matching your search' : ''}
                    </span>
                    <span className="assigned-review-page-number">Page {page}</span>
                    <button
                      className="secondary-button"
                      disabled={page === 1}
                      onClick={() => setPage(n => n - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="secondary-button"
                      disabled={!hasNext}
                      onClick={() => setPage(n => n + 1)}
                    >
                      Next page
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {certificationTab === 'analytics' && (
            <section
              className="cert-review-analytics"
              aria-label="Assigned certification review analytics"
              aria-busy={!analytics}
            >
              <header>
                <div>
                  <h3>Assigned certification analytics</h3>
                  <p>
                    Current direct-report submissions awaiting your review. Approved and unrelated
                    credentials are not included.
                  </p>
                </div>
              </header>
              <div className="assigned-review-summary">
                <article className="assigned-review-total">
                  <span>
                    <Clock3 size={17} /> Pending review
                  </span>
                  <strong>{analytics?.pending ?? '—'}</strong>
                  <small>Assigned to you</small>
                </article>
                <article>
                  <span>Expired</span>
                  <strong>{analytics?.expired ?? '—'}</strong>
                  <small>Submitted credentials</small>
                </article>
                <article>
                  <span>Expires within 90 days</span>
                  <strong>{analytics?.expiresSoon ?? '—'}</strong>
                  <small>Submitted credentials</small>
                </article>
                <article>
                  <span>No expiry date</span>
                  <strong>{analytics?.noExpiry ?? '—'}</strong>
                  <small>Submitted credentials</small>
                </article>
              </div>
              <div className="cert-review-category-list">
                <h3>Pending by category</h3>
                {analytics?.categories.length ? (
                  analytics.categories.map(item => (
                    <div key={item.category}>
                      <span>{item.category}</span>
                      <strong>{item.count}</strong>
                    </div>
                  ))
                ) : (
                  <p>
                    {analytics
                      ? 'No assigned certification categories to summarize.'
                      : 'Loading authorized analytics…'}
                  </p>
                )}
              </div>
            </section>
          )}
          {certificationTab === 'recommendations' && analytics?.canRecommend && (
            <CertificationRecommendations sentOnly />
          )}
          {credential && (
            <CertificationReviewDialog
              certification={credential}
              onClose={() => setCredential(undefined)}
              onDecision={async (record, action, feedback) => {
                await readApiResponse(
                  await authenticatedFetch('/api/certifications', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      id: record.id,
                      revision: record.revision,
                      action,
                      feedback,
                    }),
                  }),
                  'Review failed. Your note is still here.',
                );
                saved();
              }}
            />
          )}
        </section>
      )}
    </>
  );
}
