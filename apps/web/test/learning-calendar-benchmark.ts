// Synthetic CPU comparison, not browser rendering or API latency.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { dateInZone } from '../src/learning-calendar';
import { indexLearningTasks } from '../src/learning-task-index';
import type { Plan } from '../src/Learning';

const at = new Date('2026-10-17T18:30:00Z');
const plans: Plan[] = Array.from({ length: 40 }, (_, p) => ({
  id: `p${p}`,
  revision: 1,
  title: 'Plan',
  goal: 'Learn',
  timezone: p % 2 ? 'America/Los_Angeles' : 'Asia/Kolkata',
  dailyMinutes: 30,
  targetDate: '2026-10-31',
  status: 'ACTIVE',
  tasks: Array.from({ length: 50 }, (_, t) => ({
    id: `${p}-${t}`,
    title: 'Task',
    plannedDate: `2026-10-${String(1 + (t % 31)).padStart(2, '0')}`,
    estimatedMinutes: 30,
    ...(t % 4 === 0 ? { completedAt: '2026-10-16T23:00:00Z' } : {}),
  })),
}));
const days = Array.from({ length: 31 }, (_, d) => `2026-10-${String(d + 1).padStart(2, '0')}`);
const native = Intl.DateTimeFormat;
let constructions = 0;
Intl.DateTimeFormat = new Proxy(native, {
  construct(target, args) {
    constructions++;
    return Reflect.construct(target, args);
  },
});
const ids = (rows: { task: { id: string } }[]) => rows.map(({ task }) => task.id);
function measure<T>(run: () => T) {
  constructions = 0;
  const start = performance.now();
  const value = run();
  return {
    value,
    ms: Math.round((performance.now() - start) * 100) / 100,
    formatters: constructions,
  };
}
try {
  const oldDay = (date: Date, zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  const baseline = measure(() => {
    const all = plans.flatMap(plan => plan.tasks.map(task => ({ plan, task })));
    const active = all.filter(({ plan }) => plan.status === 'ACTIVE');
    const backlog = active.filter(
      ({ plan, task }) => !task.completedAt && task.plannedDate < oldDay(at, plan.timezone),
    );
    return {
      backlog: ids(backlog),
      today: ids(active.filter(({ plan, task }) => task.plannedDate === oldDay(at, plan.timezone))),
      completedDays: all
        .filter(({ task }) => task.completedAt)
        .map(({ task }) => oldDay(new Date(task.completedAt!), 'Asia/Kolkata')),
      calendarCounts: days.map(day => active.filter(({ task }) => task.plannedDate === day).length),
      overdueCounts: plans.map(plan => backlog.filter(row => row.plan.id === plan.id).length),
    };
  });
  const indexed = measure(() => {
    const index = indexLearningTasks(plans, at);
    return {
      backlog: ids(index.backlog),
      today: ids(index.todayTasks()),
      completedDays: index.completed.map(({ task }) =>
        dateInZone(new Date(task.completedAt!), 'Asia/Kolkata'),
      ),
      calendarCounts: days.map(day => index.tasksByDay.get(day)?.length ?? 0),
      overdueCounts: plans.map(plan => index.overdueByPlan.get(plan.id) ?? 0),
    };
  });
  assert.deepEqual(indexed.value, baseline.value);
  console.log(
    JSON.stringify(
      {
        plans: plans.length,
        tasks: plans.reduce((sum, plan) => sum + plan.tasks.length, 0),
        baselineMs: baseline.ms,
        indexedMs: indexed.ms,
        baselineFormatters: baseline.formatters,
        indexedFormatters: indexed.formatters,
        identicalResults: true,
      },
      null,
      2,
    ),
  );
} finally {
  Intl.DateTimeFormat = native;
}
