import { Link } from 'react-router';
import { ArrowUpRight, BookOpen, CalendarDays, Clock3, Sparkles } from 'lucide-react';
import { ProgressBar, ProgressRing } from './ui-kit';
export interface NextLearningTask {
  id: string;
  planId: string;
  title: string;
  planTitle: string;
  skillName?: string;
  plannedDate: string;
  timezone: string;
  estimatedMinutes: number;
  due: 'OVERDUE' | 'TODAY' | 'UPCOMING';
  daysOverdue: number;
  planCompleted: number;
  planTotal: number;
  href: string;
}
export interface DashboardLearningData {
  total: number;
  completed: number;
  progress: number;
  activePlans: number;
  loggedMinutes: number;
  overdue: number;
  today: number;
  canManage: boolean;
  nextTask: NextLearningTask | null;
}
export function learningTaskPrompt(task: Pick<NextLearningTask, 'id' | 'planId'>) {
  return `Use my_learning_task with planId ${task.planId} and taskId ${task.id} to read my exact saved learning task. Explain the objective and suggest a small exercise. Ask about my experience if needed. Do not complete or reschedule anything.`;
}
export function DashboardLearning({
  data,
  ai,
  onHelp,
}: {
  data: DashboardLearningData;
  ai: boolean;
  onHelp: (task: NextLearningTask) => void;
}) {
  const task = data.nextTask,
    planProgress =
      task && task.planTotal ? Math.round((task.planCompleted / task.planTotal) * 100) : 0;
  const dueLabel =
    task?.due === 'OVERDUE'
      ? `${task.daysOverdue} ${task.daysOverdue === 1 ? 'day' : 'days'} overdue`
      : task?.due === 'TODAY'
        ? 'Due today'
        : 'Next scheduled task';
  return (
    <div className="dashboard-learning-focus">
      {task ? (
        <article className="dashboard-next-task">
          <span className={'dashboard-task-due ' + task.due.toLowerCase()}>{dueLabel}</span>
          <h4>{task.title}</h4>
          <p className="dashboard-next-plan">
            {task.planTitle}
            {task.skillName && <span>Skill focus: {task.skillName}</span>}
          </p>
          <div className="dashboard-task-meta">
            <span>
              <Clock3 size={16} />
              {task.estimatedMinutes} min estimated
            </span>
            <span>
              <CalendarDays size={16} />
              <time dateTime={task.plannedDate}>
                {new Intl.DateTimeFormat('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'UTC',
                }).format(new Date(task.plannedDate + 'T12:00:00Z'))}
              </time>
            </span>
          </div>
          <small>Scheduled by date · {task.timezone}</small>
          <div className="dashboard-plan-progress">
            <span>
              {task.planCompleted} of {task.planTotal} plan tasks completed
            </span>
            <strong>{planProgress}%</strong>
          </div>
          <ProgressBar value={planProgress} label="Selected learning plan completion" />
          <div className="dashboard-next-actions">
            <Link className="admin-primary" to={task.href}>
              {data.canManage ? 'Continue learning' : 'Open learning task'}
              <ArrowUpRight size={16} />
            </Link>
            {ai && (
              <button className="dashboard-ai" onClick={() => onHelp(task)}>
                <Sparkles size={16} />
                Help with this task
              </button>
            )}
          </div>
        </article>
      ) : (
        <div className="dashboard-empty">
          <BookOpen size={25} />
          <div>
            <strong>
              {data.activePlans ? 'Your active plans are complete' : 'Start with a learning goal'}
            </strong>
            <p>
              {data.activePlans
                ? 'All tasks in your active plans are logged. Choose your next goal when you’re ready.'
                : 'Break a goal into small tasks you can fit into your day.'}
            </p>
            {data.canManage && (
              <Link to="/learning?action=create">
                {data.activePlans ? 'Create your next plan' : 'Create a learning plan'}
                <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
        </div>
      )}
      <div className="dashboard-learning-stats">
        <Link to="/learning?tab=today">
          <strong>{data.today}</strong>
          <span>Tasks due today</span>
        </Link>
        <Link to="/learning?tab=backlog" className={data.overdue ? 'has-overdue' : ''}>
          <strong>{data.overdue}</strong>
          <span>Overdue tasks</span>
        </Link>
        <Link to="/learning">
          <strong>{data.activePlans}</strong>
          <span>Active plans</span>
        </Link>
      </div>
      {data.total > 0 && (
        <div className="dashboard-learning-overall">
          <ProgressRing
            value={data.progress}
            label="Overall learning progress across active plans"
            size={64}
            stroke={7}
            tone="success"
          />
          <p className="dashboard-learning-caption">
            Across active plans: {data.completed} / {data.total} tasks complete ({data.progress}%) ·{' '}
            {data.loggedMinutes} actual minutes logged.
          </p>
        </div>
      )}
    </div>
  );
}
