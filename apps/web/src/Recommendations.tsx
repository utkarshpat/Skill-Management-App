import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router';
import {
  Plus,
  Search,
  Send,
  BookOpen,
  MessageSquare,
  Check,
  ArrowRight,
  RefreshCw,
  UserRound,
  Sparkles,
} from 'lucide-react';
import { authenticatedFetch } from './auth';
import { FormDialog } from './FormDialog';
import { recommendationQuery } from './learning-navigation';
import { dateInZone, shiftDay } from './learning-calendar';
import { toast } from './toast';
import './recommendations.css';
import { LearningPlanner } from './LearningPlanner';
export interface Recommendation {
  id: string;
  revision: number;
  personId: string;
  personName: string;
  employeeCode: string;
  senderId: string;
  senderName: string;
  skillId: string;
  skillName: string;
  category: string;
  rank: number;
  levelName: string;
  reason: string;
  resource: string;
  targetDate?: string;
  status: 'PENDING' | 'DISCUSSION' | 'ACCEPTED' | 'DECLINED';
  response: string;
  planId?: string;
  canRespond: boolean;
  updatedAt: string;
}
interface Feed {
  items: Recommendation[];
  total: number;
  pageSize: number;
  canSend: boolean;
}
async function read<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => undefined);
  if (!response.ok)
    throw Error(data?.error?.message ?? 'This action could not finish. Reload before retrying.');
  return data;
}
const statusName = {
  PENDING: 'Awaiting response',
  DISCUSSION: 'Discussion requested',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
};
export function Recommendations({
  sentOnly = false,
  onAccepted,
}: {
  sentOnly?: boolean;
  onAccepted?: () => void;
}) {
  const [params, setParams] = useSearchParams(),
    [view, setView] = useState<'received' | 'sent'>(
      sentOnly || params.get('direction') === 'sent' ? 'sent' : 'received',
    ),
    [page, setPage] = useState(1),
    [feed, setFeed] = useState<Feed>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0),
    [sending, setSending] = useState(false),
    [detail, setDetail] = useState<Recommendation>();
  const focused = params.get('recommendation') ?? '';
  const direction = params.get('direction');
  useEffect(() => {
    if (focused) setPage(1);
  }, [focused]);
  useEffect(() => {
    setView(sentOnly || direction === 'sent' ? 'sent' : 'received');
    setPage(1);
  }, [sentOnly, direction]);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError('');
    setFeed(undefined);
    setDetail(undefined);
    const q = recommendationQuery(view, page, focused);
    authenticatedFetch('/api/recommendations?' + q, { signal: c.signal })
      .then(read<Feed>)
      .then(value => {
        if (!c.signal.aborted) {
          setFeed(value);
          if (focused) {
            if (value.items.length === 1) setDetail(value.items[0]);
            else setError('This recommendation is unavailable under your current access.');
          }
        }
      })
      .catch(e => {
        if (!c.signal.aborted) {
          setError(e.message);
          setDetail(undefined);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [view, page, attempt, focused]);
  function all(nextView = view) {
    const q = new URLSearchParams(params);
    q.delete('recommendation');
    if (nextView === 'sent') q.set('direction', 'sent');
    else q.delete('direction');
    setParams(q, { replace: true });
    setDetail(undefined);
    setPage(1);
  }
  function updated() {
    setDetail(undefined);
    setAttempt(n => n + 1);
    window.dispatchEvent(new Event('notifications-updated'));
    onAccepted?.();
  }
  return (
    <section className="recommendation-workspace" aria-label="Learning recommendations">
      <header>
        <div>
          <h3>{view === 'sent' ? 'Recommendations you sent' : 'Recommended by your manager'}</h3>
          <p>
            {view === 'sent'
              ? 'Support your current direct reports with a clear next step.'
              : 'Choose what fits your development goal. Your skill profile changes only through a separate review.'}
          </p>
        </div>
        <div className="recommendation-actions">
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => setAttempt(n => n + 1)}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          {feed?.canSend && (
            <button className="admin-primary" onClick={() => setSending(true)}>
              <Plus size={17} />
              Recommend a skill
            </button>
          )}
        </div>
      </header>
      {!sentOnly && feed?.canSend && (
        <nav aria-label="Recommendation direction" className="recommendation-tabs">
          {(['received', 'sent'] as const).map(v => (
            <button
              className="secondary-button"
              key={v}
              aria-pressed={view === v}
              onClick={() => {
                all(v);
                setView(v);
              }}
            >
              {v === 'received' ? 'Received' : 'Sent'}
            </button>
          ))}
        </nav>
      )}
      {focused && (
        <button className="review-text-action" onClick={() => all()}>
          Show all recommendations
        </button>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
            Retry
          </button>
        </p>
      )}
      {loading && <p role="status">Loading authorized recommendations…</p>}
      {!loading && feed && !feed.items.length && (
        <div className="recommendation-empty">
          <BookOpen size={30} />
          <h3>{focused ? 'This recommendation is unavailable' : 'No recommendations yet'}</h3>
          <p>
            {view === 'sent'
              ? 'Choose a published skill and explain how it will help an employee.'
              : 'New manager recommendations will appear here and in your notifications.'}
          </p>
          {view === 'sent' && feed.canSend && (
            <button className="admin-primary" onClick={() => setSending(true)}>
              Recommend a skill
            </button>
          )}
        </div>
      )}
      <div className="recommendation-list">
        {feed?.items.map(item => (
          <article className="recommendation-card" key={item.id}>
            <div className="recommendation-card-icon">
              <BookOpen size={23} />
            </div>
            <div className="recommendation-card-copy">
              <span className="recommendation-category">{item.category}</span>
              <h4>
                {item.skillName}
                <span className="recommendation-level">
                  L{item.rank} · {item.levelName}
                </span>
              </h4>
              <p>
                {view === 'sent'
                  ? `For ${item.personName} · ${item.employeeCode}`
                  : `From ${item.senderName}`}
              </p>
              <p className="recommendation-reason">{item.reason}</p>
              <small>
                {item.targetDate ? 'Suggested target: ' + item.targetDate + ' · ' : ''}Updated{' '}
                {new Date(item.updatedAt).toLocaleDateString()}
              </small>
            </div>
            <div className="recommendation-card-end">
              <span className={'recommendation-status ' + item.status.toLowerCase()}>
                {statusName[item.status]}
              </span>
              <button className="secondary-button" onClick={() => setDetail(item)}>
                {item.canRespond ? 'Review recommendation' : 'View details'}
                <ArrowRight size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {feed && feed.total > 0 && (
        <footer>
          <span>
            {(page - 1) * feed.pageSize + 1}–{Math.min(page * feed.pageSize, feed.total)} of{' '}
            {feed.total}
          </span>
          <div className="recommendation-actions">
            <button
              className="secondary-button"
              disabled={page === 1}
              onClick={() => setPage(n => n - 1)}
            >
              Previous
            </button>
            <button
              className="secondary-button"
              disabled={page * feed.pageSize >= feed.total}
              onClick={() => setPage(n => n + 1)}
            >
              Next
            </button>
          </div>
        </footer>
      )}
      {sending && (
        <RecommendSkill
          onClose={() => setSending(false)}
          onSaved={() => {
            setSending(false);
            toast.success('Recommendation sent. The employee has been notified.');
            if (!sentOnly) setView('sent');
            setAttempt(n => n + 1);
            window.dispatchEvent(new Event('notifications-updated'));
          }}
        />
      )}
      {focused && !detail && (loading || error) && (
        <FormDialog
          title="Skill recommendation"
          onClose={() => all()}
          footer={
            <button className="secondary-button" onClick={() => all()}>
              Back to recommendations
            </button>
          }
        >
          <div className="notification-destination-loading" role={error ? 'alert' : 'status'}>
            {loading ? (
              <>
                <RefreshCw size={26} className="notification-spin" />
                <strong>Opening recommendation…</strong>
                <p>Loading the current details and available actions.</p>
              </>
            ) : (
              <>
                <p>{error}</p>
                <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
                  Retry
                </button>
              </>
            )}
          </div>
        </FormDialog>
      )}
      {detail && (
        <RecommendationDetail
          key={detail.id + '-' + detail.revision}
          item={detail}
          received={view === 'received'}
          onClose={() => (focused ? all() : setDetail(undefined))}
          onSaved={updated}
        />
      )}
    </section>
  );
}
interface Person {
  id: string;
  name: string;
  employeeCode: string;
}
interface Skill {
  id: string;
  name: string;
  category: string;
  levels: { rank: number; name: string }[];
}
function RecommendSkill({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [people, setPeople] = useState<Person[]>([]),
    [skills, setSkills] = useState<Skill[]>([]),
    [person, setPerson] = useState<Person>(),
    [skill, setSkill] = useState<Skill>(),
    [rank, setRank] = useState(1),
    [search, setSearch] = useState(''),
    [skillSearch, setSkillSearch] = useState(''),
    [reason, setReason] = useState(''),
    [resource, setResource] = useState(''),
    [target, setTarget] = useState(''),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [personError, setPersonError] = useState(''),
    [skillError, setSkillError] = useState(''),
    [finding, setFinding] = useState(false),
    [findingSkills, setFindingSkills] = useState(false),
    [attempt, setAttempt] = useState(0),
    [id] = useState(() => crypto.randomUUID());
  useEffect(() => {
    const c = new AbortController();
    setFinding(true);
    setPeople([]);
    const timer = setTimeout(() => {
      authenticatedFetch('/api/recommendations/people?search=' + encodeURIComponent(search), {
        signal: c.signal,
      })
        .then(read<{ people: Person[] }>)
        .then(v => {
          if (!c.signal.aborted) {
            setPeople(v.people);
            setPersonError('');
          }
        })
        .catch(e => {
          if (!c.signal.aborted) setPersonError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setFinding(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [search, attempt]);
  useEffect(() => {
    const c = new AbortController();
    setFindingSkills(true);
    setSkills([]);
    const timer = setTimeout(() => {
      authenticatedFetch(
        '/api/skills?status=PUBLISHED&page=1&search=' + encodeURIComponent(skillSearch),
        { signal: c.signal },
      )
        .then(read<{ skills: Skill[] }>)
        .then(v => {
          if (!c.signal.aborted) {
            setSkills(v.skills);
            setSkillError('');
          }
        })
        .catch(e => {
          if (!c.signal.aborted) setSkillError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setFindingSkills(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [skillSearch, attempt]);
  const valid =
    page === 0
      ? Boolean(person)
      : page === 1
        ? Boolean(skill && skill.levels.some(l => l.rank === rank))
        : Boolean(
            reason.trim() &&
            reason.trim().length <= 2000 &&
            (!resource || /^https:\/\//i.test(resource)),
          );
  async function send() {
    if (!person || !skill || busy) return;
    setBusy(true);
    setError('');
    try {
      await read(
        await authenticatedFetch('/api/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            personId: person.id,
            skillId: skill.id,
            rank,
            reason,
            resource,
            ...(target ? { targetDate: target } : {}),
          }),
        }),
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recommendation could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog
      title="Recommend a skill"
      subtitle="A recommendation guides learning. It does not edit or verify the employee’s skills."
      busy={busy}
      onClose={onClose}
      page={page}
      onPageChange={setPage}
      stepNavigation
      message={error && <p role="alert">{error}</p>}
      pages={[
        {
          label: 'Employee',
          content: (
            <div className="recommendation-form">
              <h3>Who would you like to support?</h3>
              <p>Your current active direct reports with personal learning access.</p>
              <label className="recommendation-search">
                <Search size={18} />
                <input
                  aria-label="Search recommendation recipient"
                  value={search}
                  maxLength={100}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search name or employee code"
                />
              </label>
              {finding ? (
                <p role="status">Finding direct reports…</p>
              ) : (
                <div className="recommendation-choices">
                  {people.map(p => (
                    <button
                      key={p.id}
                      aria-pressed={person?.id === p.id}
                      onClick={() => setPerson(p)}
                    >
                      <UserRound size={20} />
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.employeeCode}</small>
                      </span>
                      {person?.id === p.id && <Check size={18} />}
                    </button>
                  ))}
                  {!people.length && !personError && (
                    <p>No eligible direct reports match this search.</p>
                  )}
                </div>
              )}
            </div>
          ),
        },
        {
          label: 'Skill & target',
          content: (
            <div className="recommendation-form">
              <h3>Choose a development focus</h3>
              <label className="recommendation-search">
                <Search size={18} />
                <input
                  aria-label="Search recommendation skill"
                  value={skillSearch}
                  maxLength={100}
                  onChange={e => setSkillSearch(e.target.value)}
                  placeholder="Search published skills"
                />
              </label>
              {findingSkills ? (
                <p role="status">Finding published skills…</p>
              ) : (
                <div className="recommendation-choices">
                  {skills.map(s => (
                    <button
                      key={s.id}
                      aria-pressed={skill?.id === s.id}
                      onClick={() => {
                        setSkill(s);
                        setRank(s.levels[0]?.rank ?? 1);
                      }}
                    >
                      <BookOpen size={20} />
                      <span>
                        <strong>{s.name}</strong>
                        <small>{s.category}</small>
                      </span>
                      {skill?.id === s.id && <Check size={18} />}
                    </button>
                  ))}
                  {!skills.length && !skillError && (
                    <p>No published skills match. Try another search.</p>
                  )}
                </div>
              )}
              {skill && (
                <label>
                  Target proficiency
                  <select value={rank} onChange={e => setRank(Number(e.target.value))}>
                    {skill.levels.map(l => (
                      <option key={l.rank} value={l.rank}>
                        L{l.rank} · {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ),
        },
        {
          label: 'Reason & resource',
          content: (
            <div className="recommendation-form">
              <label>
                Why are you recommending this?
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Explain the project need or development opportunity."
                />
              </label>
              <label>
                Learning resource (optional)
                <input
                  type="url"
                  maxLength={1000}
                  value={resource}
                  onChange={e => setResource(e.target.value)}
                  placeholder="https://…"
                />
              </label>
              <label>
                Suggested target date (optional)
                <input type="date" value={target} onChange={e => setTarget(e.target.value)} />
              </label>
            </div>
          ),
        },
        {
          label: 'Review & send',
          content: (
            <div className="recommendation-form">
              <h3>{skill?.name}</h3>
              <p>
                For <strong>{person?.name}</strong> · {person?.employeeCode}
              </p>
              <p>
                Target: L{rank} · {skill?.levels.find(l => l.rank === rank)?.name}
              </p>
              <p className="recommendation-reason">{reason}</p>
              {resource && (
                <a href={resource} target="_blank" rel="noopener noreferrer">
                  Suggested learning resource
                </a>
              )}
              {target && <p>Suggested date: {target}</p>}
              <p>
                The employee can accept, decline or request discussion. Acceptance requires their
                own reviewed learning schedule.
              </p>
            </div>
          ),
        },
      ]}
      footer={
        <>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => (page ? setPage(page - 1) : onClose())}
          >
            {page ? 'Back' : 'Cancel'}
          </button>
          <button
            className="admin-primary"
            disabled={busy || !person || (!skill && page > 0) || !valid}
            onClick={() => (page < 3 ? setPage(page + 1) : void send())}
          >
            {busy ? 'Sending…' : page < 3 ? 'Next' : 'Send recommendation'}
            <Send size={16} />
          </button>
        </>
      }
    >
      {(personError || skillError) && (
        <p role="alert">
          {personError || skillError}
          <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
            Retry lookup
          </button>
        </p>
      )}
    </FormDialog>
  );
}
function RecommendationDetail({
  item,
  received,
  onClose,
  onSaved,
}: {
  item: Recommendation;
  received: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [action, setAction] = useState<'ACCEPT' | 'DECLINE' | 'DISCUSS'>(),
    [message, setMessage] = useState(''),
    [start, setStart] = useState(() => dateInZone(new Date(), zone)),
    [minutes, setMinutes] = useState(30),
    [tasks, setTasks] = useState(
      `Review ${item.skillName} fundamentals\nPractice ${item.skillName} with a small exercise\nBuild and document a ${item.skillName} example`,
    ),
    [goal, setGoal] = useState(
      `Develop ${item.skillName} toward ${item.levelName} (L${item.rank}). ${item.reason}`.slice(
        0,
        2000,
      ),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [planId] = useState(() => crypto.randomUUID()),
    [taskIds] = useState(() => Array.from({ length: 60 }, () => crypto.randomUUID()));
  const [planning, setPlanning] = useState(false),
    [planTitle, setPlanTitle] = useState(('Develop ' + item.skillName).slice(0, 160));
  const names = tasks
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean),
    target = shiftDay(start, Math.max(0, names.length - 1));
  async function respond() {
    if (busy || !action) return;
    setError('');
    if (
      action === 'ACCEPT' &&
      (!target ||
        !planTitle.trim() ||
        !goal.trim() ||
        !names.length ||
        names.length > 60 ||
        names.some(n => n.length > 160) ||
        !Number.isInteger(minutes) ||
        minutes < 5 ||
        minutes > 480)
    ) {
      setError(
        'Enter a plan name, valid start date, a goal, 1–60 tasks and 5–480 minutes per day.',
      );
      return;
    }
    if (action === 'DISCUSS' && !message.trim()) {
      setError('Tell your manager what you would like to discuss.');
      return;
    }
    setBusy(true);
    try {
      await read(
        await authenticatedFetch('/api/recommendations/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.id,
            revision: item.revision,
            action,
            message,
            ...(action === 'ACCEPT'
              ? {
                  plan: {
                    action: 'CREATE',
                    id: planId,
                    revision: 0,
                    title: planTitle,
                    goal,
                    timezone: zone,
                    dailyMinutes: minutes,
                    targetDate: target,
                    focus: 'General',
                    skillId: item.skillId,
                    tasks: names.map((title, i) => ({
                      id: taskIds[i],
                      title,
                      plannedDate: shiftDay(start, i),
                      estimatedMinutes: minutes,
                    })),
                  },
                }
              : {}),
          }),
        }),
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your response.');
    } finally {
      setBusy(false);
    }
  }
  if (planning)
    return (
      <LearningPlanner
        today={start}
        initialGoal={goal.slice(0, 300)}
        initialExperience={`Recommendation context only, not my experience: ${item.reason}`.slice(
          0,
          500,
        )}
        onClose={() => {
          setPlanning(false);
          setAction(undefined);
        }}
        onManual={() => setPlanning(false)}
        onReview={draft => {
          setPlanTitle(draft.title);
          setGoal(draft.goal);
          setMinutes(draft.dailyMinutes);
          setStart(draft.startDate);
          setTasks(draft.steps.join('\n'));
          setPlanning(false);
        }}
      />
    );
  return (
    <FormDialog
      title={action === 'ACCEPT' ? 'Accept & create learning plan' : 'Skill recommendation'}
      busy={busy}
      onClose={onClose}
      message={error && <p role="alert">{error}</p>}
      footer={
        <>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => (action ? setAction(undefined) : onClose())}
          >
            {action ? 'Back' : 'Close'}
          </button>
          {action && (
            <button className="admin-primary" disabled={busy} onClick={() => void respond()}>
              {busy
                ? 'Saving…'
                : action === 'ACCEPT'
                  ? 'Accept & create plan'
                  : action === 'DECLINE'
                    ? 'Confirm decline'
                    : 'Send discussion request'}
            </button>
          )}
        </>
      }
    >
      <div className="recommendation-form">
        <span className={'recommendation-status ' + item.status.toLowerCase()}>
          {statusName[item.status]}
        </span>
        <h3>
          {item.skillName} · L{item.rank} {item.levelName}
        </h3>
        <p>
          {item.senderName} recommended this for {item.personName}.
        </p>
        <p className="recommendation-reason">{item.reason}</p>
        {item.resource && (
          <a href={item.resource} target="_blank" rel="noopener noreferrer">
            Open suggested learning resource ↗
          </a>
        )}
        {item.targetDate && <p>Suggested target: {item.targetDate}</p>}
        {item.response && (
          <p>
            <strong>Employee response:</strong> {item.response}
          </p>
        )}
        {received && item.planId && (
          <Link
            className="secondary-button"
            to={'/learning?tab=paths&openPlan=' + item.planId}
            onClick={onClose}
          >
            View learning plan
            <ArrowRight size={16} />
          </Link>
        )}
        {item.canRespond && !action && (
          <div className="recommendation-response-actions">
            <button
              className="admin-primary"
              onClick={() => {
                setAction('ACCEPT');
                setPlanning(true);
              }}
            >
              <Check size={17} />
              Accept & build plan
            </button>
            <button className="secondary-button" onClick={() => setAction('DISCUSS')}>
              <MessageSquare size={17} />
              Ask for discussion
            </button>
            <button className="secondary-button" onClick={() => setAction('DECLINE')}>
              Decline
            </button>
          </div>
        )}
        {action === 'ACCEPT' && (
          <>
            <h3>Review your personal learning schedule</h3>
            <button className="secondary-button" onClick={() => setPlanning(true)}>
              <Sparkles size={17} />
              Plan with AI
            </button>
            <label>
              Plan name
              <input
                maxLength={160}
                value={planTitle}
                onChange={e => setPlanTitle(e.target.value)}
              />
            </label>
            <label>
              Your goal
              <textarea
                rows={3}
                maxLength={2000}
                value={goal}
                onChange={e => setGoal(e.target.value)}
              />
            </label>
            <div className="recommendation-form-row">
              <label>
                Start date
                <input type="date" value={start} onChange={e => setStart(e.target.value)} />
              </label>
              <label>
                Minutes per day
                <input
                  type="number"
                  min={5}
                  max={480}
                  value={minutes}
                  onChange={e => setMinutes(Number(e.target.value))}
                />
              </label>
            </div>
            <label>
              Daily tasks — one per line
              <textarea
                rows={5}
                maxLength={9660}
                value={tasks}
                onChange={e => setTasks(e.target.value)}
              />
            </label>
            <p>
              {names.length} tasks · {minutes} minutes each · {start} to {target} · {zone}
            </p>
            {item.targetDate && target > item.targetDate && (
              <p>
                Your schedule ends after the suggested target. You can change the start date or
                tasks before accepting.
              </p>
            )}
            <p>Accept creates this plan in Learn & Grow. It does not verify proficiency.</p>
          </>
        )}
        {action && (
          <label>
            {action === 'DISCUSS' ? 'What would you like to discuss?' : 'Response note (optional)'}
            <textarea
              rows={3}
              maxLength={2000}
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
          </label>
        )}
        {!item.canRespond && ['PENDING', 'DISCUSSION'].includes(item.status) && (
          <p>
            Response actions are unavailable under your current access or reporting relationship.
          </p>
        )}
      </div>
    </FormDialog>
  );
}
