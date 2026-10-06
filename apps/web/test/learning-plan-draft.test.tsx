import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learningPlanSchedule, prefillLearningPlanDraft } from '../src/learning-plan-draft';

test('draft prefill trims AI output and applies safe defaults before review', () => {
  const draft = prefillLearningPlanDraft(
    {
      title: '  Azure roadmap  ',
      body: '  Build an API on Azure  ',
      steps: ['  Read app service basics  ', ' ', ' Practice deployment '],
      dailyMinutes: 999,
      startDate: 'invalid',
    },
    '2026-10-06',
  );
  assert.deepEqual(draft, {
    title: 'Azure roadmap',
    goal: 'Build an API on Azure',
    dailyMinutes: 30,
    startDate: '2026-10-06',
    tasks: ['Read app service basics', 'Practice deployment'],
  });
});

test('draft prefill preserves a valid planner schedule', () => {
  const draft = prefillLearningPlanDraft(
    {
      title: 'Cycle',
      goal: 'Ship a React feature',
      steps: ['Design UI'],
      dailyMinutes: 45,
      startDate: '2026-10-10',
    },
    '2026-10-06',
  );
  assert.deepEqual(draft, {
    title: 'Cycle',
    goal: 'Ship a React feature',
    dailyMinutes: 45,
    startDate: '2026-10-10',
    tasks: ['Design UI'],
  });
});

test('schedule preview assigns consecutive calendar dates for each task', () => {
  const tasks = ['Plan', 'Build', 'Review'];
  assert.deepEqual(learningPlanSchedule('2026-12-31', tasks), [
    { day: 1, date: '2026-12-31', task: 'Plan' },
    { day: 2, date: '2027-01-01', task: 'Build' },
    { day: 3, date: '2027-01-02', task: 'Review' },
  ]);
  assert.deepEqual(tasks, ['Plan', 'Build', 'Review']);
});

test('draft prefill supports tasks array and summary fallback', () => {
  const draft = prefillLearningPlanDraft(
    { title: 'Go path', summary: 'Learn goroutines', tasks: ['Read syntax', 'Build channel'] },
    '2026-10-06',
  );
  assert.deepEqual(draft, {
    title: 'Go path',
    goal: 'Learn goroutines',
    dailyMinutes: 30,
    startDate: '2026-10-06',
    tasks: ['Read syntax', 'Build channel'],
  });
});

test('draft prefill safely tolerates undefined title and non-string step items', () => {
  const draft = prefillLearningPlanDraft(
    { title: undefined as unknown as string, steps: ['Step 1', 42 as unknown as string, '  '] },
    '2026-10-06',
  );
  assert.deepEqual(draft, {
    title: '',
    goal: '',
    dailyMinutes: 30,
    startDate: '2026-10-06',
    tasks: ['Step 1', '42'],
  });
});
