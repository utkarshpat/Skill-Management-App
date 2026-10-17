import type { Plan, Task } from './Learning';
import { dateInZone } from './learning-calendar';

type PlanTask = { plan: Plan; task: Task };
// Rebuild from current plans/time on each render. No personal data or dates
// survive a render, and calendar cells use counts instead of rescanning tasks.
export function indexLearningTasks(plans: Plan[], at: Date) {
  const active: PlanTask[] = [],
    completed: PlanTask[] = [],
    backlog: PlanTask[] = [];
  const tasksByDay = new Map<string, PlanTask[]>();
  const overdueByPlan = new Map<string, number>();
  const todayByZone = new Map<string, string>();
  const todayFor = (zone: string) => {
    let today = todayByZone.get(zone);
    if (today === undefined) {
      today = dateInZone(at, zone);
      todayByZone.set(zone, today);
    }
    return today;
  };
  for (const plan of plans) {
    for (const task of plan.tasks) {
      const entry = { plan, task };
      if (task.completedAt) completed.push(entry);
      if (plan.status !== 'ACTIVE') continue;
      active.push(entry);
      const onDay = tasksByDay.get(task.plannedDate);
      if (onDay) onDay.push(entry);
      else tasksByDay.set(task.plannedDate, [entry]);
      if (!task.completedAt && task.plannedDate < todayFor(plan.timezone)) {
        backlog.push(entry);
        overdueByPlan.set(plan.id, (overdueByPlan.get(plan.id) ?? 0) + 1);
      }
    }
  }
  return {
    completed,
    backlog,
    tasksByDay,
    overdueByPlan,
    todayTasks: () =>
      active.filter(({ plan, task }) => task.plannedDate === todayFor(plan.timezone)),
  };
}
