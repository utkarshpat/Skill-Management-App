import { learningDraftHandoff } from './learning-draft-handoff';
import { LearningPlanCreateAttempt } from './learning-plan-create';
import { PublishedSkillPicker, type SkillOption } from './PublishedSkillPicker';
import { createPortal } from 'react-dom';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { learningView, learningTabSearch } from './learning-navigation';
import {
  BookOpen,
  CalendarDays,
  Clock3,
  Plus,
  Check,
  ArrowLeft,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { FormDialog } from './FormDialog';
import './learning.css';
import { Recommendations } from './Recommendations';
import { LearningHome } from './LearningHome';
import { LearningSession } from './LearningSession';
import { LearningPlanner } from './LearningPlanner';
import { LearningRecovery } from './LearningRecovery';
import { SkillGrowthJourney } from './SkillGrowthJourney';
import {
  learningPlanSchedule,
  prefillLearningPlanDraft,
  learningDraftReviewable,
  type LearningPlanDraftInput,
} from './learning-plan-draft';
export interface Task {
  id: string;
  title: string;
  plannedDate: string;
  estimatedMinutes: number;
  actualMinutes?: number;
  notes?: string;
  completedAt?: string;
}
export interface Plan {
  id: string;
  revision: number;
  title: string;
  goal: string;
  timezone: string;
  dailyMinutes: number;
  targetDate: string;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  focus?: string;
  skillId?: string;
  skillName?: string;
  tasks: Task[];
}
interface State {
  actorId: string;
  plans: Plan[];
  canManage: boolean;
}
import { dateInZone, shiftDay, currentStreak } from './learning-calendar';
async function read<T>(response: Response): Promise<T> {
  return readApiResponse<T>(response, 'Learning could not be loaded. Try again.');
}
export function Learning({ actionsContainer }: { actionsContainer?: HTMLElement | null }) {
  const [dashboardParams, setDashboardParams] = useSearchParams();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    today = dateInZone(new Date(), zone);
  const [state, setState] = useState<State>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const tab = learningView(dashboardParams);
  function setTab(name: string) {
    setDashboardParams(learningTabSearch(dashboardParams, name));
  }
  const [selectedDay, setSelectedDay] = useState(today),
    [month, setMonth] = useState(today.slice(0, 7)),
    [creating, setCreating] = useState(false),
    [page, setPage] = useState(0),
    [reviewPage, setReviewPage] = useState(0);

  const [focus, setFocus] = useState('General'),
    [skillId, setSkillId] = useState(''),
    [selectedSkill, setSelectedSkill] = useState<SkillOption>();
  const [plannerGoal, setPlannerGoal] = useState<string>(),
    [recovery, setRecovery] = useState<Plan>();
  const [detail, setDetail] = useState<{ plan: Plan; task: Task }>();
  const [title, setTitle] = useState(''),
    [goal, setGoal] = useState(''),
    [minutes, setMinutes] = useState(30),
    [start, setStart] = useState(today),
    [taskText, setTaskText] = useState(''),
    [draftId, setDraftId] = useState(''),
    [taskIds, setTaskIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<{
      plan: Plan;
      task: Task;
      action: 'LOG' | 'RESCHEDULE';
    }>(),
    [actual, setActual] = useState(30),
    [notes, setNotes] = useState(''),
    [newDay, setNewDay] = useState(today),
    [formError, setFormError] = useState(''),
    [archive, setArchive] = useState<Plan>();
  useEffect(() => {
    const controller = new AbortController();
    authenticatedFetch('/api/learning', { signal: controller.signal })
      .then(read<State>)
      .then(value => {
        if (!controller.signal.aborted) {
          setState(value);
          setError('');
        }
      })
      .catch(e => {
        if (!controller.signal.aborted) {
          if ([401, 403].includes(e.status)) setState(undefined);
          setError(e.message);
        }
      });
    return () => controller.abort();
  }, [attempt]);
  async function change(payload: object): Promise<{ ok: boolean; error?: string }> {
    if (busy) return { ok: false, error: 'Busy' };
    setBusy(true);
    setFormError('');
    try {
      await read(
        await authenticatedFetch('/api/learning', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      );
      setAttempt(n => n + 1);
      setNotice('Learning updated.');
      window.dispatchEvent(new Event('learning-updated'));
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save.';
      setFormError(msg);
      return { ok: false, error: msg };
    } finally {
      setBusy(false);
    }
  }
  const plans = state?.plans ?? [],
    all = plans.flatMap(plan => plan.tasks.map(task => ({ plan, task }))),
    active = all.filter(x => x.plan.status === 'ACTIVE'),
    backlog = active.filter(
      x => !x.task.completedAt && x.task.plannedDate < dateInZone(new Date(), x.plan.timezone),
    );
  const completed = all.filter(x => x.task.completedAt),
    streak = currentStreak(
      completed.map(x => dateInZone(new Date(x.task.completedAt!), zone)),
      today,
    );
  const rows = (
    tab === 'Backlog'
      ? backlog
      : active.filter(
          x =>
            x.task.plannedDate ===
            (tab === 'Calendar' ? selectedDay : dateInZone(new Date(), x.plan.timezone)),
        )
  ).sort((a, b) => a.task.plannedDate.localeCompare(b.task.plannedDate));
  const names = taskText
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean),
    target = shiftDay(start || today, Math.max(0, names.length - 1));
  const schedule = learningPlanSchedule(start || today, names);
  function openCreate(draft?: LearningPlanDraftInput) {
    const prefill = draft ? prefillLearningPlanDraft(draft, today) : undefined;
    setSelectedSkill(undefined);
    setFocus('General');
    setSkillId('');
    setTitle(prefill?.title ?? '');
    setGoal(prefill?.goal ?? '');
    setMinutes(prefill?.dailyMinutes ?? 30);
    setStart(prefill?.startDate ?? today);
    setTaskText(prefill ? prefill.tasks.join('\n') : '');
    setDraftId(crypto.randomUUID());
    setTaskIds(Array.from({ length: 60 }, () => crypto.randomUUID()));
    setPage(prefill && learningDraftReviewable(prefill) ? 3 : 0);
    setReviewPage(0);
    setFormError('');
    setNotice(prefill ? 'Review the draft, then create the plan to add it to your calendar.' : '');
    setCreating(true);
  }
  useEffect(() => {
    if (!state) return;
    const action = dashboardParams.get('action'),
      planId = dashboardParams.get('plan'),
      taskId = dashboardParams.get('task');
    if (!action && !planId && !taskId) return;
    const next = new URLSearchParams(dashboardParams);
    next.delete('action');
    next.delete('draftTicket');
    next.delete('plan');
    next.delete('task');
    setDashboardParams(next, { replace: true });
    if (action === 'planner') {
      if (state.canManage) setPlannerGoal('');
      else setError('Learning editing is not assigned.');
    } else if (action === 'create') {
      if (state.canManage) openCreate();
      else setError('Learning editing is not assigned.');
    } else if (action === 'draft') {
      const draft = learningDraftHandoff.take(
        state.actorId,
        dashboardParams.get('draftTicket') ?? '',
      );
      if (state.canManage && draft) openCreate(draft);
      else
        setError(
          'This learning draft expired or is unavailable for your current account. Ask the assistant to prepare it again.',
        );
    } else {
      const plan = state.plans.find(p => p.id.toLowerCase() === planId?.toLowerCase()),
        task = plan?.tasks.find(t => t.id.toLowerCase() === taskId?.toLowerCase());
      if (plan && task) setDetail({ plan, task });
      else setError('This learning task is unavailable.');
    }
  }, [dashboardParams, state]);
  const plannerCreate = useRef<LearningPlanCreateAttempt | null>(null);
  function validate() {
    if (
      !title.trim() ||
      title.trim().length > 160 ||
      !goal.trim() ||
      goal.length > 2000 ||
      names.length < 1 ||
      names.length > 60 ||
      names.some(n => n.length > 160) ||
      !Number.isInteger(minutes) ||
      minutes < 5 ||
      minutes > 480 ||
      !/^20\d{2}-\d{2}-\d{2}$/.test(start) ||
      !Number.isFinite(new Date(start + 'T12:00:00Z').getTime())
    ) {
      setFormError(
        'Enter a title, goal, valid start date, 5–480 minutes and 1–60 tasks (one per line).',
      );
      return false;
    }
    setFormError('');
    return { ok: true };
  }
  const first = month + '-01',
    weekday = new Date(first + 'T12:00:00Z').getUTCDay(),
    last = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();

  const newPlan = state?.canManage ? (
    <>
      <button className="secondary-button" onClick={() => setPlannerGoal('')}>
        <Sparkles size={17} />
        AI planner
      </button>
      <button className="admin-primary" onClick={() => openCreate()}>
        <Plus size={17} />
        New plan
      </button>
    </>
  ) : null;
  return (
    <div className="learning-page">
      {actionsContainer
        ? createPortal(newPlan, actionsContainer)
        : newPlan && <div className="learning-toolbar">{newPlan}</div>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
            Retry
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!state && !error && <p role="status">Loading learning…</p>}
      <section className="learning-workbench learning-home-workbench">
        <nav className="learning-tabs" aria-label="Learning views">
          {[
            'My learning',
            'Learning paths',
            'Goals',
            'Growth journey',
            'Recommendations',
            'Today',
            'Calendar',
            'Backlog',
          ].map(name => (
            <button
              key={name}
              className="secondary-button"
              aria-current={tab === name ? 'page' : undefined}
              onClick={() => setTab(name)}
            >
              {name}
              {name === 'Backlog' && backlog.length > 0 ? ' (' + backlog.length + ')' : ''}
            </button>
          ))}
        </nav>
        {tab === 'Recommendations' && <Recommendations onAccepted={() => setAttempt(n => n + 1)} />}
        {state && (
          <>
            <LearningHome
              busy={busy}
              plans={plans}
              canManage={state.canManage}
              tab={tab}
              zone={zone}
              onNew={openCreate}
              onPlanner={setPlannerGoal}
              onRecover={setRecovery}
              onStateChange={plan =>
                void change({
                  action: plan.status === 'ACTIVE' ? 'PAUSE' : 'RESUME',
                  id: plan.id,
                  revision: plan.revision,
                })
              }
              onArchive={plan => {
                setArchive(plan);
                setFormError('');
              }}
              onContinue={(plan, task) => setDetail({ plan, task })}
              onDraft={draft => openCreate(draft)}
              onTab={setTab}
            />
            {tab === 'Growth journey' && (
              <SkillGrowthJourney
                plans={plans}
                canManage={state.canManage}
                onContinue={(plan, task) => setDetail({ plan, task })}
                onResume={plan =>
                  void change({ action: 'RESUME', id: plan.id, revision: plan.revision })
                }
              />
            )}
            {tab === 'Backlog' &&
              state.canManage &&
              [...new Map(backlog.map(x => [x.plan.id, x.plan])).values()].map(plan => (
                <div className="recovery-entry" key={plan.id}>
                  <div>
                    <strong>{plan.title}</strong>
                    <small>
                      {backlog.filter(x => x.plan.id === plan.id).length} overdue tasks · Rebuild
                      the pending schedule
                    </small>
                  </div>
                  <button className="secondary-button" onClick={() => setRecovery(plan)}>
                    Recover plan
                  </button>
                </div>
              ))}
            {tab === 'Calendar' && (
              <div className="learning-calendar">
                <div className="panel-title">
                  <button
                    aria-label="Previous month"
                    className="secondary-button"
                    onClick={() => setMonth(shiftDay(first, -1).slice(0, 7))}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <h3>
                    {new Date(first + 'T12:00:00Z').toLocaleDateString(undefined, {
                      month: 'long',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </h3>
                  <button
                    aria-label="Next month"
                    className="secondary-button"
                    onClick={() => setMonth(shiftDay(first, 32).slice(0, 7))}
                  >
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="calendar-grid">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <span key={day}>{day}</span>
                  ))}
                  {Array.from({ length: weekday }, (_, i) => (
                    <span key={'blank' + i} />
                  ))}
                  {Array.from({ length: last }, (_, i) => {
                    const day = month + '-' + String(i + 1).padStart(2, '0'),
                      count = active.filter(x => x.task.plannedDate === day).length;
                    return (
                      <button
                        key={day}
                        aria-label={
                          day + (count ? ', ' + count + (count === 1 ? ' task' : ' tasks') : '')
                        }
                        aria-pressed={selectedDay === day}
                        onClick={() => setSelectedDay(day)}
                      >
                        <strong>{i + 1}</strong>
                        {count > 0 && (
                          <small>
                            {count} {count === 1 ? 'task' : 'tasks'}
                          </small>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="calendar-selected-header">
                  <div>
                    <h3>
                      Tasks for {selectedDay === today ? `Today (${selectedDay})` : selectedDay}
                    </h3>
                    <span className="calendar-selected-count">
                      {rows.length} {rows.length === 1 ? 'task scheduled' : 'tasks scheduled'}
                    </span>
                  </div>
                  {state.canManage && (
                    <div className="calendar-quick-actions">
                      <button
                        className="secondary-button"
                        onClick={() => setPlannerGoal('')}
                        title="Open AI Planner starting on this date"
                      >
                        <Sparkles size={15} />
                        AI planner
                      </button>
                      <button
                        className="admin-text-button"
                        onClick={() =>
                          openCreate({
                            title: '',
                            goal: '',
                            dailyMinutes: 30,
                            startDate: selectedDay,
                            tasks: [],
                          })
                        }
                        title="Create manual plan starting on this date"
                      >
                        <Plus size={15} />
                        Add plan
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {['My learning', 'Learning paths', 'Goals', 'Recommendations'].includes(
              tab,
            ) ? null : tab === 'Plans' ? (
              <div className="learning-plans">
                {plans.length ? (
                  plans.map(plan => {
                    const done = plan.tasks.filter(t => t.completedAt).length;
                    return (
                      <article key={plan.id}>
                        <div className="panel-title">
                          <h3>{plan.title}</h3>
                          <span className="claim-status">{plan.status.toLowerCase()}</span>
                        </div>
                        <p>{plan.goal}</p>
                        <progress
                          value={done}
                          max={plan.tasks.length}
                          aria-label={plan.title + ' progress'}
                        />
                        <p className="workspace-muted">
                          {done}/{plan.tasks.length} completed · {plan.dailyMinutes} min/day ·
                          Target {plan.targetDate}
                        </p>
                        <small>{plan.timezone}</small>
                        {state.canManage && plan.status !== 'ARCHIVED' && (
                          <div className="learning-actions">
                            <button
                              disabled={busy}
                              className="secondary-button"
                              onClick={() =>
                                void change({
                                  action: plan.status === 'ACTIVE' ? 'PAUSE' : 'RESUME',
                                  id: plan.id,
                                  revision: plan.revision,
                                })
                              }
                            >
                              {plan.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                            </button>
                            <button
                              disabled={busy}
                              className="admin-text-button"
                              onClick={() => {
                                setArchive(plan);
                                setFormError('');
                              }}
                            >
                              Archive
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })
                ) : (
                  <Empty
                    label="Build a learning plan"
                    detail="Choose a goal and break it into small daily tasks."
                  />
                )}
              </div>
            ) : rows.length ? (
              <div className="learning-task-list">
                {rows.map(({ plan, task }) => (
                  <article key={task.id}>
                    <span className={'learning-task-icon ' + (task.completedAt ? 'complete' : '')}>
                      {task.completedAt ? <Check size={18} /> : <Clock3 size={18} />}
                    </span>
                    <div>
                      <h3>{task.title}</h3>
                      <p>
                        {plan.title} · {task.plannedDate} ·{' '}
                        {task.completedAt
                          ? task.actualMinutes + ' min logged'
                          : task.estimatedMinutes + ' min planned'}
                      </p>
                      {task.notes && <p>{task.notes}</p>}
                    </div>
                    {task.completedAt ? (
                      <span className="claim-status">Completed</span>
                    ) : (
                      state.canManage && (
                        <div className="learning-actions">
                          <button
                            className="secondary-button"
                            onClick={() => {
                              setEditing({ plan, task, action: 'RESCHEDULE' });
                              setNewDay(today);
                              setFormError('');
                            }}
                          >
                            Reschedule
                          </button>
                          <button
                            className="admin-primary"
                            onClick={() => {
                              setEditing({ plan, task, action: 'LOG' });
                              setActual(task.estimatedMinutes);
                              setNotes('');
                              setFormError('');
                            }}
                          >
                            Log completion
                          </button>
                        </div>
                      )
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                label={tab === 'Backlog' ? 'No overdue tasks' : 'No tasks scheduled'}
                detail={
                  tab === 'Backlog'
                    ? 'Missed tasks stay here until you complete or reschedule them.'
                    : 'Create a plan or choose another date to see your learning tasks.'
                }
                action={
                  tab === 'Calendar' && state.canManage ? (
                    <div className="calendar-empty-actions">
                      <button className="admin-primary" onClick={() => setPlannerGoal('')}>
                        <Sparkles size={15} />
                        Build AI roadmap starting {selectedDay}
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          openCreate({
                            title: '',
                            goal: '',
                            dailyMinutes: 30,
                            startDate: selectedDay,
                            tasks: [],
                          })
                        }
                      >
                        <Plus size={15} />
                        Add manual plan for this date
                      </button>
                    </div>
                  ) : undefined
                }
              />
            )}
            {formError && !creating && !editing && !archive && <p role="alert">{formError}</p>}
          </>
        )}
      </section>
      {state && (
        <p className="workspace-muted learning-footnote">
          Current streak: {streak} {streak === 1 ? 'day' : 'days'}. Streaks count consecutive days
          with a completed task and at least one minute logged, in {zone}. Opening a task does not
          count. Learning progress does not verify a skill.
        </p>
      )}
      {recovery && (
        <LearningRecovery
          plan={recovery}
          onClose={() => setRecovery(undefined)}
          onSaved={() => {
            setRecovery(undefined);
            setAttempt(n => n + 1);
            setNotice('Recovery saved. Your pending tasks have a new schedule.');
            setTab('Calendar');
            setSelectedDay(dateInZone(new Date(), recovery.timezone));
            setMonth(dateInZone(new Date(), recovery.timezone).slice(0, 7));
          }}
          onReload={() => {
            setRecovery(undefined);
            setAttempt(n => n + 1);
          }}
        />
      )}
      {plannerGoal !== undefined && (
        <LearningPlanner
          today={tab === 'Calendar' ? selectedDay : today}
          initialGoal={plannerGoal}
          onClose={() => {
            setPlannerGoal(undefined);
            plannerCreate.current = null;
          }}
          onReview={draft => {
            openCreate(draft);
            setPlannerGoal(undefined);
          }}
          onConfirmSchedule={async draft => {
            if (!state?.canManage) throw Error('Learning editing is not assigned.');
            plannerCreate.current ??= new LearningPlanCreateAttempt();
            const saved = await plannerCreate.current.save(draft, zone, authenticatedFetch);
            setAttempt(n => n + 1);
            window.dispatchEvent(new Event('learning-updated'));
            setPlannerGoal(undefined);
            plannerCreate.current = null;
            setSelectedDay(saved.tasks[0].plannedDate);
            setMonth(saved.tasks[0].plannedDate.slice(0, 7));
            setTab('Calendar');
            setNotice(`Plan created. ${saved.tasks.length} tasks added to your calendar.`);
          }}
        />
      )}
      {creating && (
        <FormDialog
          title="New learning plan"
          busy={busy}
          onClose={() => setCreating(false)}
          page={page}
          onPageChange={setPage}
          stepNavigation
          message={formError && <p role="alert">{formError}</p>}
          pages={[
            {
              label: 'Goal & time',
              content: (
                <div className="access-form">
                  <label>
                    Plan name
                    <input
                      value={title}
                      maxLength={160}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Learn React fundamentals"
                    />
                  </label>
                  <label>
                    Your goal
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={goal}
                      onChange={e => setGoal(e.target.value)}
                      placeholder="What would you like to be able to do?"
                    />
                  </label>
                  <div className="learning-form-row">
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
                    <label>
                      Start date
                      <input type="date" value={start} onChange={e => setStart(e.target.value)} />
                    </label>
                  </div>
                  <p className="workspace-muted">
                    Timezone: {zone}. One task is scheduled each day.
                  </p>
                </div>
              ),
            },
            {
              label: 'Skill focus',
              content: (
                <div className="access-form">
                  <div className="learning-form-row">
                    <label>
                      Learning focus
                      <select value={focus} onChange={e => setFocus(e.target.value)}>
                        {[
                          'General',
                          'Backend',
                          'Frontend',
                          'Cloud',
                          'System Design',
                          'Data & AI',
                          'Professional',
                        ].map(x => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <PublishedSkillPicker
                    value={selectedSkill}
                    onChange={skill => {
                      setSelectedSkill(skill);
                      setSkillId(skill?.id ?? '');
                    }}
                  />
                  <p className="workspace-muted">
                    Optional mapping connects your goal to a published skill. Learning completion
                    does not change assessed proficiency.
                  </p>
                </div>
              ),
            },
            {
              label: 'Daily tasks',
              content: (
                <div className="access-form">
                  <label>
                    Tasks — one per line
                    <textarea
                      rows={7}
                      value={taskText}
                      maxLength={9660}
                      onChange={e => setTaskText(e.target.value)}
                      placeholder={
                        'Understand components\nPractice props and state\nBuild a small project'
                      }
                    />
                  </label>
                  <p>
                    {names.length} tasks · {minutes} minutes each · Finish {target}
                  </p>
                </div>
              ),
            },
            {
              label: 'Review',
              content: (
                <div>
                  <h3>{title || 'Your learning plan'}</h3>
                  <p>
                    Focus: {focus} · Skill: {selectedSkill?.name ?? 'No skill linked'}
                  </p>
                  <p>
                    {goal.length > 300 ? goal.slice(0, 300) + '… (full goal in Goal & time)' : goal}
                  </p>
                  <div className="learning-review-schedule">
                    <div>
                      <strong>Add this plan to your calendar</strong>
                      <small>
                        {schedule.length} daily {schedule.length === 1 ? 'task' : 'tasks'} from{' '}
                        {start} to {target}
                      </small>
                    </div>
                    <span className="claim-status">Scheduled on create</span>
                  </div>
                  <ol start={reviewPage * 3 + 1}>
                    {schedule.slice(reviewPage * 3, reviewPage * 3 + 3).map(item => (
                      <li key={item.day}>
                        {item.task} · {item.date}
                      </li>
                    ))}
                  </ol>
                  {schedule.length > 3 && (
                    <div className="learning-actions">
                      <button
                        className="secondary-button"
                        disabled={reviewPage === 0}
                        onClick={() => setReviewPage(n => n - 1)}
                      >
                        Previous tasks
                      </button>
                      <span>
                        {reviewPage + 1}/{Math.ceil(schedule.length / 3)}
                      </span>
                      <button
                        className="secondary-button"
                        disabled={(reviewPage + 1) * 3 >= schedule.length}
                        onClick={() => setReviewPage(n => n + 1)}
                      >
                        More tasks
                      </button>
                    </div>
                  )}
                  <p>
                    {schedule.length} daily tasks · {minutes} minutes/day · {start} to {target}
                  </p>
                  <p className="workspace-muted">
                    Create plan adds these tasks to Calendar immediately. Completion is logged
                    separately when you do the work.
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
                onClick={() => (page ? setPage(page - 1) : setCreating(false))}
              >
                {page ? 'Back' : 'Cancel'}
              </button>
              <button
                className="admin-primary"
                disabled={busy}
                onClick={() => {
                  if (page < 3) {
                    if (page === 2 && !validate()) return;
                    setPage(page + 1);
                  } else if (validate())
                    void change({
                      action: 'CREATE',
                      id: draftId,
                      revision: 0,
                      title,
                      goal,
                      timezone: zone,
                      dailyMinutes: minutes,
                      targetDate: target,
                      focus,
                      ...(skillId ? { skillId } : {}),
                      tasks: names.map((name, i) => ({
                        id: taskIds[i],
                        title: name,
                        estimatedMinutes: minutes,
                        plannedDate: shiftDay(start, i),
                      })),
                    }).then(res => {
                      if (res.ok) {
                        setCreating(false);
                        setSelectedDay(start);
                        setMonth(start.slice(0, 7));
                        setTab('Calendar');
                        setNotice(
                          `Plan created. ${names.length} ${names.length === 1 ? 'task was' : 'tasks were'} added to your calendar from ${start} to ${target}.`,
                        );
                      }
                    });
                }}
              >
                {busy ? 'Saving…' : page < 3 ? 'Next' : 'Create plan & add to calendar'}
              </button>
            </>
          }
        />
      )}
      {detail && (
        <LearningSession
          plan={detail.plan}
          task={detail.task}
          canManage={Boolean(state?.canManage)}
          onClose={() => setDetail(undefined)}
          onComplete={(minutes, notes) => {
            setEditing({ ...detail, action: 'LOG' });
            setActual(minutes);
            setNotes(notes);
            setFormError('');
            setDetail(undefined);
          }}
        />
      )}
      {editing && (
        <FormDialog
          title={editing.action === 'LOG' ? 'Log completion' : 'Reschedule task'}
          busy={busy}
          onClose={() => setEditing(undefined)}
          message={formError && <p role="alert">{formError}</p>}
          footer={
            <>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </button>
              <button
                className="admin-primary"
                disabled={busy}
                onClick={() =>
                  void change({
                    action: editing.action,
                    id: editing.plan.id,
                    revision: editing.plan.revision,
                    taskId: editing.task.id,
                    ...(editing.action === 'LOG'
                      ? { actualMinutes: actual, notes }
                      : { plannedDate: newDay }),
                  }).then(res => {
                    if (res.ok) setEditing(undefined);
                  })
                }
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <div className="access-form">
            <h3>{editing.task.title}</h3>
            {editing.action === 'LOG' ? (
              <>
                <label>
                  Actual minutes
                  <input
                    type="number"
                    min={1}
                    max={480}
                    value={actual}
                    onChange={e => setActual(Number(e.target.value))}
                  />
                </label>
                <label>
                  What did you learn? (optional)
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  New date
                  <input
                    type="date"
                    max={editing.plan.targetDate}
                    value={newDay}
                    onChange={e => setNewDay(e.target.value)}
                  />
                </label>
                <p>
                  Daily capacity: {editing.plan.dailyMinutes} minutes. Target:{' '}
                  {editing.plan.targetDate}. Tasks are moved only after you save.
                </p>
              </>
            )}
          </div>
        </FormDialog>
      )}
      {archive && (
        <FormDialog
          title="Archive learning plan"
          busy={busy}
          onClose={() => setArchive(undefined)}
          message={formError && <p role="alert">{formError}</p>}
          footer={
            <>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setArchive(undefined)}
              >
                Cancel
              </button>
              <button
                className="admin-primary"
                disabled={busy}
                onClick={() =>
                  void change({
                    action: 'ARCHIVE',
                    id: archive.id,
                    revision: archive.revision,
                  }).then(res => {
                    if (res.ok) setArchive(undefined);
                  })
                }
              >
                Archive plan
              </button>
            </>
          }
        >
          <p>
            Archive “{archive.title}”? Your logged progress is retained. Archived plans cannot be
            changed.
          </p>
        </FormDialog>
      )}
    </div>
  );
}
function Empty({ label, detail, action }: { label: string; detail: string; action?: ReactNode }) {
  return (
    <div className="learning-empty">
      <CalendarDays size={32} />
      <h3>{label}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
