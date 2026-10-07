import type { Plan, Task } from './Learning';
import { dateInZone, shiftDay } from './learning-calendar';
export function learningSummary(plans: Plan[], month: string) {
  const tasks = plans.flatMap(plan => plan.tasks.map(task => ({ plan, task }))),
    scheduled = tasks.filter(x => x.task.plannedDate.startsWith(month)),
    done = scheduled.filter(x => x.task.completedAt).length;
  return {
    total: tasks.length,
    completed: tasks.filter(x => x.task.completedAt).length,
    monthlyPercent: scheduled.length ? Math.round((done / scheduled.length) * 100) : 0,
    monthlyDone: done,
    monthlyTotal: scheduled.length,
    plannedMinutes: scheduled.reduce((n, x) => n + x.task.estimatedMinutes, 0),
    loggedMinutes: tasks
      .filter(
        x =>
          x.task.completedAt &&
          dateInZone(new Date(x.task.completedAt), x.plan.timezone).startsWith(month),
      )
      .reduce((n, x) => n + (x.task.actualMinutes ?? 0), 0),
  };
}
export function planWeeks(plan: Plan) {
  const tasks = [...plan.tasks].sort((a, b) => a.plannedDate.localeCompare(b.plannedDate)),
    anchor = tasks[0]?.plannedDate;
  if (!anchor) return [];
  const weeks = new Map<number, Task[]>();
  for (const task of tasks) {
    const week =
      Math.floor(
        (Date.parse(task.plannedDate + 'T12:00:00Z') - Date.parse(anchor + 'T12:00:00Z')) /
          604800000,
      ) + 1;
    weeks.set(week, [...(weeks.get(week) ?? []), task]);
  }
  return [...weeks].map(([week, tasks]) => ({
    week,
    tasks,
    start: shiftDay(anchor, (week - 1) * 7),
  }));
}
