import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLearningRoadmap } from '../src/learning-roadmap';
const response = {
  title: 'Azure',
  goal: 'Deploy an API',
  steps: ['Read', 'Build'],
  days: 2,
  dailyMinutes: 30,
};
test('planner rejects missing, malformed and incomplete success bodies before rendering', () => {
  for (const body of [
    undefined,
    null,
    {},
    [],
    { ...response, steps: undefined },
    { ...response, steps: ['Read', 42] },
    { ...response, days: 3 },
    { ...response, dailyMinutes: 0 },
    { ...response, title: 42 },
  ])
    assert.throws(() => readLearningRoadmap(body, '2026-10-07'), /incomplete roadmap/);
});
test('planner uses the selected date and isolates the editable draft from response data', () => {
  const draft = readLearningRoadmap({ ...response, startDate: '2000-01-01' }, '2026-10-07');
  assert.equal(draft.startDate, '2026-10-07');
  draft.steps[0] = 'Changed';
  assert.equal(response.steps[0], 'Read');
});
