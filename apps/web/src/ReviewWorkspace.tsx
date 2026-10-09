import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import type { Claim } from './MySkills';
import type { ClaimReviewDecision } from './ClaimReviewAccess';
import { SkillClaimDialog } from './SkillClaimDialog';
import { CertificationReviewDialog } from './certifications/CertificationReviewDialog';
import type { CertificationPage, CertificationRecord } from './certifications/types';
import { toast } from './toast';
import './capability-workspace.css';
import './certifications/certifications.css';
const SkillReviews = lazy(() => import('./SkillReviews').then(m => ({ default: m.SkillReviews })));
type SkillPage = { claims: Claim[]; total: number; pageSize: number };
export function ReviewWorkspace({
  certificationsAllowed = false,
}: {
  certificationsAllowed?: boolean;
}) {
  const [params] = useSearchParams();
  const advanced =
    params.has('claim') ||
    params.get('tab') === 'recommendations' ||
    params.get('tab') === 'skills';
  const type =
    params.get('type') === 'skills'
      ? 'skills'
      : certificationsAllowed && params.get('type') === 'certifications'
        ? 'certifications'
        : 'all';
  const [data, setData] = useState<{ skills: SkillPage; certifications: CertificationPage }>();
  const [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [opening, setOpening] = useState(false);
  const [claim, setClaim] = useState<Claim>(),
    [credential, setCredential] = useState<CertificationRecord>();
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setQuery(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setPage(1);
  }, [type]);
  useEffect(() => {
    const refresh = () => {
      if (claim || credential || opening) return;
      setAttempt(n => n + 1);
    };
    window.addEventListener('notifications-remote-updated', refresh);
    return () => window.removeEventListener('notifications-remote-updated', refresh);
  }, [claim, credential, opening]);
  useEffect(() => {
    if (advanced) return;
    const controller = new AbortController();
    setData(undefined);
    setError('');
    setLoading(true);
    setClaim(undefined);
    setCredential(undefined);
    const read = <T,>(url: string) =>
      authenticatedFetch(url, { signal: controller.signal }).then(r =>
        readApiResponse<T>(r, 'Review queue could not be loaded.'),
      );
    // Both counts come from the existing independently authorized pending queues.
    Promise.all([
      read<SkillPage>(
        '/api/skill-reviews?' +
          new URLSearchParams({ status: 'SUBMITTED', page: String(page), search: query }),
      ),
      certificationsAllowed
        ? read<CertificationPage>(
            '/api/certifications?' +
              new URLSearchParams({ view: 'queue', page: String(page), search: query }),
          )
        : Promise.resolve<CertificationPage>({
            records: [],
            total: 0,
            page,
            pageSize: 25,
            canManage: false,
            canSubmitNew: false,
            canReview: false,
          }),
    ])
      .then(([skills, certifications]) => {
        if (!controller.signal.aborted) setData({ skills, certifications });
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, query, attempt, advanced, certificationsAllowed]);
  const saved = () => {
    setClaim(undefined);
    setCredential(undefined);
    setAttempt(n => n + 1);
    toast.success('Review saved.');
    window.dispatchEvent(new Event('notifications-updated'));
  };
  async function openSkill(id: string) {
    if (opening) return;
    setOpening(true);
    setError('');
    try {
      const detail = await readApiResponse<{ claim: Claim; reviewAccess: ClaimReviewDecision }>(
        await authenticatedFetch('/api/skill-reviews/' + encodeURIComponent(id)),
        'Review unavailable.',
      );
      setClaim({ ...detail.claim, reviewAccess: detail.reviewAccess });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review unavailable.');
    } finally {
      setOpening(false);
    }
  }
  const skills = type === 'certifications' ? [] : (data?.skills.claims ?? []);
  const certifications = type === 'skills' ? [] : (data?.certifications.records ?? []);
  const rows = [
    ...skills.map(item => ({
      key: 'skill-' + item.id,
      kind: 'Skill',
      title: item.skillName,
      person: item.personName,
      date: item.updatedAt,
      detail: item.levelName,
      open: () => void openSkill(item.id),
    })),
    ...certifications.map(item => ({
      key: 'certification-' + item.id,
      kind: 'Certification',
      title: item.certificationName,
      person: item.name,
      date: item.submittedAt ?? '',
      detail: item.provider,
      open: () => setCredential(item),
    })),
  ];
  const total = data
    ? (type === 'certifications' ? 0 : data.skills.total) +
      (type === 'skills' ? 0 : data.certifications.total)
    : undefined;
  const hasNext = Boolean(
    data &&
    ((type !== 'certifications' && page * data.skills.pageSize < data.skills.total) ||
      (type !== 'skills' && page * data.certifications.pageSize < data.certifications.total)),
  );
  return (
    <>
      <nav className="capability-tabs" aria-label="Review types">
        {(['all', 'skills', 'certifications'] as const)
          .filter(t => certificationsAllowed || t !== 'certifications')
          .map(t => (
            <Link
              key={t}
              to={'/skill-reviews?type=' + t}
              aria-current={!advanced && type === t ? 'page' : undefined}
            >
              {t === 'all' ? 'All' : t === 'skills' ? 'Skills' : 'Certifications'}
              {!advanced && data
                ? ` (${t === 'all' ? data.skills.total + data.certifications.total : t === 'skills' ? data.skills.total : data.certifications.total})`
                : ''}
            </Link>
          ))}
        <Link to="/skill-reviews?tab=skills" aria-current={advanced ? 'page' : undefined}>
          Skill history & team
        </Link>
      </nav>
      {advanced ? (
        <Suspense fallback={<p role="status">Loading skill workbench…</p>}>
          <SkillReviews />
        </Suspense>
      ) : (
        <section>
          <h2>Assigned reviews</h2>
          <p>
            Review skill proficiency and credential details separately. Only pending submissions
            assigned to you by current direct reports appear here.
          </p>
          <div className="combined-review-tools">
            <input
              aria-label="Search employee, skill or certification"
              value={search}
              maxLength={100}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search employee or submission"
            />
          </div>
          {error && <p role="alert">{error}</p>}
          {loading && <p role="status">Loading assigned reviews…</p>}
          {opening && <p role="status">Checking current skill review access…</p>}
          {data && (
            <>
              <p>
                {total} pending {query && 'matching'} submissions. Batch {page} shows up to{' '}
                {type === 'all' && certificationsAllowed
                  ? `${data.skills.pageSize} skills and ${data.certifications.pageSize} certifications`
                  : type === 'skills' || !certificationsAllowed
                    ? `${data.skills.pageSize} skills`
                    : `${data.certifications.pageSize} certifications`}
                .
              </p>
              <div className="combined-review-list">
                {rows.map(row => (
                  <article className="combined-review-item" key={row.key}>
                    <div>
                      <span className="combined-review-type">{row.kind}</span>
                      <h3>{row.title}</h3>
                      <p>
                        {row.person} · {row.detail}
                      </p>
                      <p>
                        {row.kind === 'Skill' ? 'Last updated' : 'Submitted'}:{' '}
                        {row.date ? new Date(row.date).toLocaleDateString() : 'Unavailable'}
                      </p>
                    </div>
                    <button className="primary-button" disabled={opening} onClick={row.open}>
                      Review {row.kind.toLowerCase()}
                    </button>
                  </article>
                ))}
              </div>
              {!rows.length && (
                <p>
                  No pending submissions in this batch.{' '}
                  {total === 0 ? 'You’re all caught up.' : 'Choose another batch.'}
                </p>
              )}
              <div className="combined-review-tools">
                <button
                  className="secondary-button"
                  disabled={page === 1}
                  onClick={() => setPage(n => n - 1)}
                >
                  Previous batch
                </button>
                <button
                  className="secondary-button"
                  disabled={!hasNext}
                  onClick={() => setPage(n => n + 1)}
                >
                  Next batch
                </button>
              </div>
            </>
          )}
          {claim && (
            <SkillClaimDialog
              claim={claim}
              mode={claim.status === 'SUBMITTED' && claim.reviewAccess?.allowed ? 'review' : 'view'}
              history
              onClose={() => setClaim(undefined)}
              onSaved={saved}
            />
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
