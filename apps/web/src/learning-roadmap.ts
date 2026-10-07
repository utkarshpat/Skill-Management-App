export interface LearningRoadmap {
  title: string;
  goal: string;
  steps: string[];
  dailyMinutes: number;
  days: number;
  startDate: string;
}

export function readLearningRoadmap(value: unknown, startDate: string): LearningRoadmap {
  const body = value as Partial<LearningRoadmap> | undefined;
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    typeof body.title !== 'string' ||
    !body.title.trim() ||
    body.title.length > 160 ||
    typeof body.goal !== 'string' ||
    !body.goal.trim() ||
    body.goal.length > 2000 ||
    !Array.isArray(body.steps) ||
    body.steps.length < 1 ||
    body.steps.length > 12 ||
    body.steps.some(step => typeof step !== 'string' || !step.trim() || step.length > 160) ||
    !Number.isInteger(body.dailyMinutes) ||
    Number(body.dailyMinutes) < 5 ||
    Number(body.dailyMinutes) > 480 ||
    !Number.isInteger(body.days) ||
    body.days !== body.steps.length
  )
    throw Error(
      'The planner returned an incomplete roadmap. Generate it again; no plan was saved.',
    );
  return {
    title: body.title,
    goal: body.goal,
    steps: [...body.steps],
    dailyMinutes: Number(body.dailyMinutes),
    days: Number(body.days),
    startDate,
  };
}
