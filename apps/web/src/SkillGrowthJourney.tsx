import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Sparkles,
  Target,
} from 'lucide-react';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import type { Claim } from './MySkills';
import type { Plan, Task } from './Learning';
import type { Recommendation } from './Recommendations';
import { growthJourneyNextStep, latestClaimForSkill } from './growth-journey';
import './learning-home.css';

interface Props {
  plans: Plan[];
  canManage: boolean;
  onContinue: (plan: Plan, task: Task) => void;
  onResume: (plan: Plan) => void;
}
interface RecommendationPage {
  items: Recommendation[];
  total: number;
  pageSize: number;
}
interface ClaimPage {
  claims: Claim[];
  total: number;
  pageSize: number;
  canClaim: boolean;
}
interface JourneySources {
  recommendations: Recommendation[];
  claims: Claim[];
  canClaim: boolean;
}
const statuses: Record<Recommendation['status'], string> = {
  PENDING: 'Awaiting your response',
  DISCUSSION: 'Discussion requested',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
};

async function loadPages<T>(
  first: T[],
  total: number,
  pageSize: number,
  load: (page: number) => Promise<T[]>,
): Promise<T[]> {
  if (
    !Number.isSafeInteger(total) ||
    total < first.length ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1
  )
    throw Error('Growth journey data could not be read. Refresh to try again.');
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount > 1000)
    throw Error(
      'There are too many records to display in one growth journey. Open the source page to review them.',
    );
  const items = [...first];
  for (let page = 2; page <= pageCount; page += 4) {
    const pages = await Promise.all(
      Array.from({ length: Math.min(4, pageCount - page + 1) }, (_, index) => load(page + index)),
    );
    items.push(...pages.flat());
  }
  return items;
}

export function SkillGrowthJourney({ plans, canManage, onContinue, onResume }: Props) {
  const [sources, setSources] = useState<JourneySources>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setSources(undefined);
    const request = async () => {
      try {
        const [recommendationResponse, claimResponse] = await Promise.all([
          authenticatedFetch('/api/recommendations?view=received&page=1', {
            signal: controller.signal,
          }).then(response =>
            readApiResponse<RecommendationPage>(response, 'Recommendations could not be loaded.'),
          ),
          authenticatedFetch('/api/my-skills?page=1', { signal: controller.signal }).then(
            response =>
              readApiResponse<ClaimPage>(response, 'Your skill claims could not be loaded.'),
          ),
        ]);
        const [recommendations, claims] = await Promise.all([
          loadPages(
            recommendationResponse.items,
            recommendationResponse.total,
            recommendationResponse.pageSize,
            page =>
              authenticatedFetch('/api/recommendations?view=received&page=' + page, {
                signal: controller.signal,
              })
                .then(response =>
                  readApiResponse<RecommendationPage>(
                    response,
                    'Recommendations could not be loaded.',
                  ),
                )
                .then(value => value.items),
          ),
          loadPages(claimResponse.claims, claimResponse.total, claimResponse.pageSize, page =>
            authenticatedFetch('/api/my-skills?page=' + page, { signal: controller.signal })
              .then(response =>
                readApiResponse<ClaimPage>(response, 'Your skill claims could not be loaded.'),
              )
              .then(value => value.claims),
          ),
        ]);
        if (!controller.signal.aborted)
          setSources({ recommendations, claims, canClaim: claimResponse.canClaim });
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : 'Your growth journey could not be loaded.',
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void request();
    return () => controller.abort();
  }, [attempt]);

  const journeys = plans.filter(plan => plan.skillId && plan.status !== 'ARCHIVED');
  const activeRecommendations = (sources?.recommendations ?? []).filter(
    item => item.status === 'PENDING' || item.status === 'DISCUSSION',
  );
  const accepted = sources?.recommendations.filter(item => item.status === 'ACCEPTED') ?? [];

  return (
    <section className="growth-journey" aria-labelledby="growth-journey-title" aria-busy={loading}>
      <header className="growth-journey-heading">
        <div>
          <h2 id="growth-journey-title">Your skill growth journey</h2>
          <p>
            Connect a development goal to real learning, your own evidence and the existing review
            process.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => setAttempt(value => value + 1)}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </header>
      {error && (
        <p className="growth-journey-message" role="alert">
          {error}{' '}
          <button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>
            Retry
          </button>
        </p>
      )}
      {loading && <p role="status">Connecting recommendations, learning plans and skill claims…</p>}
      {!loading && sources && (
        <>
          {activeRecommendations.length > 0 && (
            <section
              className="growth-recommendations"
              aria-labelledby="growth-recommendations-title"
            >
              <h3 id="growth-recommendations-title">Recommendations to review</h3>
              {activeRecommendations.map(item => (
                <article key={item.id}>
                  <span className="growth-step-icon">
                    <Sparkles size={17} />
                  </span>
                  <div>
                    <strong>{item.skillName}</strong>
                    <p>
                      {statuses[item.status]} · {item.senderName} · Target L{item.rank}
                    </p>
                  </div>
                  <Link
                    className="secondary-button"
                    to={
                      '/learning?tab=recommendations&recommendation=' + encodeURIComponent(item.id)
                    }
                  >
                    Review recommendation
                    <ArrowRight size={15} />
                  </Link>
                </article>
              ))}
            </section>
          )}
          {journeys.length ? (
            journeys.map(plan => {
              const claim = plan.skillId
                ? latestClaimForSkill(sources.claims, plan.skillId)
                : undefined;
              const recommendation = accepted.find(
                item => item.planId?.toLowerCase() === plan.id.toLowerCase(),
              );
              const completed = plan.tasks.filter(task => task.completedAt).length,
                percent = plan.tasks.length ? Math.round((completed / plan.tasks.length) * 100) : 0;
              const next = growthJourneyNextStep(plan, claim, sources.canClaim, canManage);
              const action = () => {
                if (next.kind === 'CONTINUE_TASK') onContinue(plan, next.task);
                else if (next.kind === 'RESUME_PLAN') onResume(plan);
              };
              const href =
                next.kind === 'CREATE_CLAIM'
                  ? '/my-skills?action=add&skill=' + encodeURIComponent(plan.skillName ?? '')
                  : next.kind === 'EDIT_CLAIM'
                    ? '/my-skills?editClaim=' + encodeURIComponent(next.claim.id)
                    : next.kind === 'SUBMIT_CLAIM'
                      ? '/my-skills?submitClaim=' + encodeURIComponent(next.claim.id)
                      : next.kind === 'VIEW_CLAIM'
                        ? '/my-skills?claim=' + encodeURIComponent(next.claim.id)
                        : undefined;
              const label =
                next.kind === 'CONTINUE_TASK'
                  ? 'Continue learning'
                  : next.kind === 'RESUME_PLAN'
                    ? 'Resume learning plan'
                    : next.kind === 'OPEN_PLAN'
                      ? 'View paused plan'
                      : next.kind === 'CREATE_CLAIM'
                        ? 'Prepare your skill claim'
                        : next.kind === 'CLAIM_ACCESS_REQUIRED'
                          ? 'Skill-claim access is not assigned'
                          : next.kind === 'EDIT_CLAIM'
                            ? 'Review feedback and update claim'
                            : next.kind === 'SUBMIT_CLAIM'
                              ? 'Review and submit your claim'
                              : next.kind === 'VIEW_CLAIM'
                                ? claim?.status === 'SUBMITTED'
                                  ? 'Await assigned review'
                                  : 'View reviewed claim'
                                : 'No learning tasks in this plan';
              const blocked = next.kind === 'CLAIM_ACCESS_REQUIRED' || next.kind === 'NO_TASKS';
              return (
                <article className="growth-journey-card" key={plan.id}>
                  <div className="growth-journey-card-head">
                    <div>
                      <span className="growth-skill-category">
                        {plan.skillName ?? 'Published skill'}
                      </span>
                      <h3>{plan.title}</h3>
                    </div>
                    <span className="claim-status">
                      {plan.status === 'PAUSED'
                        ? 'Paused'
                        : completed === plan.tasks.length && plan.tasks.length > 0
                          ? 'Learning complete'
                          : 'In progress'}
                    </span>
                  </div>
                  <p className="growth-journey-goal">{plan.goal}</p>
                  <div className="growth-journey-progress">
                    <div>
                      <span>Learning tasks</span>
                      <strong>
                        {completed} of {plan.tasks.length} complete
                      </strong>
                    </div>
                    <progress
                      value={percent}
                      max={100}
                      aria-label={`${plan.title}: ${percent}% learning complete`}
                    />
                  </div>
                  <ol className="growth-journey-steps">
                    <li className={recommendation ? 'complete' : ''}>
                      <span className="growth-step-icon">
                        <Sparkles size={17} />
                      </span>
                      <div>
                        <strong>Development focus</strong>
                        <small>
                          {recommendation
                            ? 'Manager recommendation accepted'
                            : 'Personal learning plan'}
                        </small>
                      </div>
                    </li>
                    <li
                      className={
                        completed === plan.tasks.length && plan.tasks.length > 0 ? 'complete' : ''
                      }
                    >
                      <span className="growth-step-icon">
                        {completed === plan.tasks.length && plan.tasks.length > 0 ? (
                          <CheckCircle2 size={17} />
                        ) : (
                          <BookOpen size={17} />
                        )}
                      </span>
                      <div>
                        <strong>Learn and practise</strong>
                        <small>
                          {completed === plan.tasks.length && plan.tasks.length > 0
                            ? 'Plan tasks complete'
                            : plan.tasks.length - completed + ' learning tasks remaining'}
                        </small>
                      </div>
                    </li>
                    <li className={claim ? 'complete' : ''}>
                      <span className="growth-step-icon">
                        <Target size={17} />
                      </span>
                      <div>
                        <strong>Your skill claim</strong>
                        <small>
                          {claim
                            ? claim.status.replaceAll('_', ' ').toLowerCase()
                            : completed === plan.tasks.length && plan.tasks.length > 0
                              ? 'Not started · uses your experience and evidence'
                              : 'After learning · not created automatically'}
                        </small>
                      </div>
                    </li>
                    <li className={claim?.status === 'APPROVED' ? 'complete' : ''}>
                      <span className="growth-step-icon">
                        {claim?.status === 'APPROVED' ? (
                          <CheckCircle2 size={17} />
                        ) : (
                          <Clock3 size={17} />
                        )}
                      </span>
                      <div>
                        <strong>Assigned review</strong>
                        <small>
                          {claim?.status === 'APPROVED'
                            ? 'Manager-reviewed proficiency'
                            : claim?.status === 'SUBMITTED'
                              ? 'Awaiting your assigned reviewer'
                              : claim?.status === 'DRAFT'
                                ? 'Only after you submit this draft'
                                : claim?.status === 'CHANGES_REQUESTED'
                                  ? 'Revise the claim before resubmitting'
                                  : claim?.status === 'REJECTED'
                                    ? 'Not approved · review feedback'
                                    : 'Only after you submit a claim'}
                        </small>
                      </div>
                    </li>
                  </ol>
                  <div className="growth-journey-next">
                    {next.kind === 'CONTINUE_TASK' && (
                      <p>
                        Next task: <strong>{next.task.title}</strong>
                      </p>
                    )}
                    {next.kind === 'EDIT_CLAIM' && (
                      <p>Use your reviewer’s feedback to update the claim before resubmitting.</p>
                    )}
                    {next.kind === 'CREATE_CLAIM' && (
                      <p>
                        Learning is complete. Add only experience and evidence that are genuinely
                        yours; completion does not verify proficiency.
                      </p>
                    )}
                    {next.kind === 'CLAIM_ACCESS_REQUIRED' && (
                      <p>Your current access does not include creating or editing skill claims.</p>
                    )}
                    {next.kind === 'NO_TASKS' && (
                      <p>
                        This plan has no tasks to complete. Review it or create a plan with a
                        published skill focus.
                      </p>
                    )}
                    {href && !blocked ? (
                      <Link className="admin-primary" to={href}>
                        {label}
                        <ArrowRight size={16} />
                      </Link>
                    ) : next.kind === 'OPEN_PLAN' ? (
                      <Link
                        className="admin-primary"
                        to={'/learning?tab=paths&openPlan=' + encodeURIComponent(plan.id)}
                      >
                        {label}
                        <ArrowRight size={16} />
                      </Link>
                    ) : (
                      <button className="admin-primary" disabled={blocked} onClick={action}>
                        {label}
                        {!blocked && <ArrowRight size={16} />}
                      </button>
                    )}
                    <Link
                      className="growth-plan-link"
                      to={'/learning?tab=paths&openPlan=' + encodeURIComponent(plan.id)}
                    >
                      View full learning plan
                    </Link>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="growth-journey-empty">
              <Target size={28} />
              <h3>Start a skill-focused journey</h3>
              <p>
                Accept a recommendation or create a learning plan linked to a published skill. Your
                plan progress will stay separate from assessed proficiency.
              </p>
              <div>
                <Link className="secondary-button" to="/learning?tab=recommendations">
                  View recommendations
                </Link>
                {canManage && (
                  <Link className="admin-primary" to="/learning?action=create">
                    Create a skill-focused plan
                  </Link>
                )}
              </div>
            </div>
          )}
          {accepted.some(
            item =>
              item.planId &&
              !plans.some(plan => plan.id.toLowerCase() === item.planId?.toLowerCase()),
          ) && (
            <p className="growth-journey-message">
              An accepted recommendation’s plan is not available in your current learning plans.
              Refresh your plans before continuing.
            </p>
          )}
        </>
      )}
    </section>
  );
}
