import { lazy, Suspense, useEffect, useState } from 'react';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { CertificationReviewDialog } from './certifications/CertificationReviewDialog';
import type { CertificationPage, CertificationRecord } from './certifications/types';
import { toast } from './toast';
import { ArrowRight, Award, Clock3, Search, ShieldCheck, X } from 'lucide-react';
import { CertificationRecommendations } from './certifications/CertificationRecommendations';
import './capability-workspace.css';
import { CapabilitySubmissions } from './capabilities/CapabilitySubmissions';
import './review-workbench.css';
import './certifications/certifications.css';
const SkillReviews = lazy(() => import('./SkillReviews').then(m => ({ default: m.SkillReviews })));

export function ReviewWorkspace({
  certificationsAllowed = false,
}: {
  certificationsAllowed?: boolean;
}) {
  return (
    <Suspense fallback={<p role="status">Loading review workspace…</p>}>
      <SkillReviews
        unified
        queueContent={
          <>
            <CapabilitySubmissions review showEmpty />
            {certificationsAllowed && <CertificationReviewPanel view="queue" />}
          </>
        }
        teamContent={
          certificationsAllowed ? <CertificationReviewPanel view="analytics" /> : undefined
        }
        recommendationContent={
          certificationsAllowed ? <CertificationReviewPanel view="recommendations" /> : undefined
        }
      />
    </Suspense>
  );
}
function CertificationReviewPanel({ view }: { view: 'queue' | 'analytics' | 'recommendations' }) {
  const [data, setData] = useState<CertificationPage>();
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState('');
  const [analytics, setAnalytics] = useState<{
    pending: number;
    expired: number;
    expiresSoon: number;
    noExpiry: number;
    canRecommend: boolean;
    categories: { category: string; count: number }[];
  }>();
  const certificationTab = view;
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
  useEffect(() => {
    const refresh = () => {
      if (!credential && !opening) setAttempt(n => n + 1);
    };
    window.addEventListener('notifications-remote-updated', refresh);
    return () => window.removeEventListener('notifications-remote-updated', refresh);
  }, [credential, opening]);
  useEffect(() => {
    if (view !== 'queue') return;
    const controller = new AbortController();
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
        if (!controller.signal.aborted) {
          setData(undefined);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, query, attempt, view]);
  useEffect(() => {
    if (view === 'queue') return;
    const controller = new AbortController();
    setAnalyticsLoading(true);
    setAnalyticsError('');
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
        if (!controller.signal.aborted) {
          setAnalytics(undefined);
          setAnalyticsError(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAnalyticsLoading(false);
      });
    return () => controller.abort();
  }, [attempt, view]);

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
  const showLegacyQueue = loading || Boolean(error) || Boolean(data?.records.length);
  const hasNext = Boolean(data && page * data.pageSize < data.total);
  if (view === 'queue' && !showLegacyQueue) return null;

  return (
    <>
      <section
        className="assigned-review-workspace review-shell"
        aria-busy={view === 'queue' ? loading : analyticsLoading}
      >
        {analyticsError && certificationTab !== 'queue' && (
          <div className="assigned-review-error" role="alert">
            <span>{analyticsError}</span>
            <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
              Retry
            </button>
          </div>
        )}
        {certificationTab === 'queue' && showLegacyQueue && (
          <>
            <div className="assigned-review-summary" aria-label="Certification review summary">
              <article className="assigned-review-total">
                <span>
                  <Award size={17} /> Earlier individual credential reviews
                </span>
                <strong>{data?.total ?? '—'}</strong>
                <small>Ready for your review</small>
              </article>
            </div>
            <div className="assigned-review-toolbar">
              <div className="assigned-review-search-wrap">
                <Search size={18} aria-hidden="true" className="assigned-review-search-icon" />
                <input
                  type="search"
                  aria-label="Search employee or certification"
                  value={search}
                  maxLength={100}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search employee or certification…"
                />
                {search && (
                  <button
                    type="button"
                    className="assigned-review-clear-search-btn"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearch('');
                      setQuery('');
                      setPage(1);
                    }}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
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
              <div className="assigned-review-skeleton" role="status">
                <span className="sr-only">Loading certification review queue…</span>
                <div aria-hidden="true" />
                <div aria-hidden="true" />
              </div>
            )}
            {data && !loading && (
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
            className="team-certificates-summary"
            aria-label="Supporting certificate analytics"
            aria-busy={analyticsLoading}
          >
            <h3>Supporting certificates awaiting review</h3>
            <div className="team-certificate-metrics">
              <span>
                <strong>{analytics?.pending ?? '—'}</strong> Assigned certificates
              </span>
              <span>
                <strong>{analytics?.expired ?? '—'}</strong> Expired
              </span>
              <span>
                <strong>{analytics?.expiresSoon ?? '—'}</strong> Expiring within 90 days
              </span>
              <span>
                <strong>{analytics?.noExpiry ?? '—'}</strong> No expiry
              </span>
            </div>
            <small>Current direct reports · assigned pending certificates only</small>
            {!!analytics?.categories.length && (
              <details>
                <summary>Certificate categories</summary>
                {analytics.categories.map(item => (
                  <p key={item.category}>
                    {item.category} <strong>{item.count}</strong>
                  </p>
                ))}
              </details>
            )}
          </section>
        )}
        {certificationTab === 'recommendations' && analytics?.canRecommend && (
          <CertificationRecommendations sentOnly />
        )}
        {certificationTab === 'recommendations' && !analytics && analyticsLoading && (
          <p role="status">Checking recommendation access…</p>
        )}
        {certificationTab === 'recommendations' && analytics && !analytics.canRecommend && (
          <p role="status">
            Certification recommendations are not available with your current access.
          </p>
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
    </>
  );
}
