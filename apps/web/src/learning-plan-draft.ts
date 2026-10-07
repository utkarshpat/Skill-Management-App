import { shiftDay } from './learning-calendar';

export interface LearningPlanDraftInput {
  title: string;
  steps?: string[];
  tasks?: string[];
  goal?: string;
  body?: string;
  summary?: string;
  dailyMinutes?: number;
  startDate?: string;
}
export interface LearningPlanDraftPrefill {
  title: string;
  goal: string;
  dailyMinutes: number;
  startDate: string;
  tasks: string[];
}

const datePattern = /^20\d{2}-\d{2}-\d{2}$/;

function validDate(value: string) {
  return (
    datePattern.test(value) &&
    Number.isFinite(new Date(value + 'T12:00:00Z').getTime()) &&
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value
  );
}

export function prefillLearningPlanDraft(
  draft: LearningPlanDraftInput,
  today: string,
): LearningPlanDraftPrefill {
  const source = Array.isArray(draft.steps)
    ? draft.steps
    : Array.isArray(draft.tasks)
      ? draft.tasks
      : [];
  const tasks = source
    .filter((step): step is string => typeof step === 'string')
    .map(step => step.trim())
    .filter(Boolean);
  return {
    title: typeof draft.title === 'string' ? draft.title.trim() : '',
    goal:
      [draft.goal, draft.body, draft.summary]
        .find(value => typeof value === 'string' && value.trim())
        ?.trim() ?? '',
    dailyMinutes:
      Number.isInteger(draft.dailyMinutes) &&
      Number(draft.dailyMinutes) >= 5 &&
      Number(draft.dailyMinutes) <= 480
        ? Number(draft.dailyMinutes)
        : 30,
    startDate:
      typeof draft.startDate === 'string' && validDate(draft.startDate) ? draft.startDate : today,
    tasks,
  };
}

export function learningPlanSchedule(startDate: string, tasks: string[]) {
  return tasks.map((task, index) => ({
    day: index + 1,
    date: shiftDay(startDate, index),
    task,
  }));
}

export function learningDraftReviewable(draft: LearningPlanDraftPrefill) {
  return Boolean(
    draft.title &&
    draft.title.length <= 160 &&
    draft.goal &&
    draft.goal.length <= 2000 &&
    draft.tasks.length >= 1 &&
    draft.tasks.length <= 60 &&
    draft.tasks.every(task => task.length <= 160),
  );
}
