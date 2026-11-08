import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { component, refreshDevelopmentLogin, click, fill } from './support/interactions';
const { LearningPlanner } =
  component<typeof import('../src/LearningPlanner')>('LearningPlanner.tsx');
const draft = {
  title: 'Practical SQL reporting',
  goal: 'Improve SQL reporting',
  steps: ['Practice filtered queries', 'Build a grouped report'],
  dailyMinutes: 30,
  days: 2,
  startDate: '2026-11-08',
};
let view: Awaited<ReturnType<typeof render>> | undefined;
let response: Response;
let writes: any[] = [];
beforeEach(async () => {
  writes = [];
  response = Response.json(draft);
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === '/api/dev-login') return demoResponse();
    assert.equal(String(input), '/api/learning/planner');
    writes.push(JSON.parse(String(init?.body)));
    return response.clone();
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);

test('planner validates effort and dates, generates an editable draft and refines without saving', async () => {
  const reviewed: any[] = [];
  view = await render(
    <LearningPlanner
      today="2026-11-08"
      onClose={() => {}}
      onReview={value => reviewed.push(value)}
    />,
  );
  await click('Next');
  assert.match(document.body.textContent!, /Enter a goal/);
  assert.equal(writes.length, 0);
  await fill('What would you like to learn?', 'Improve SQL reporting');
  await fill('Minutes per day', '4');
  await click('Next');
  assert.equal(writes.length, 0);
  await fill('Minutes per day', '30');
  await fill('Learning days', '13');
  await click('Next');
  assert.equal(writes.length, 0);
  await fill('Learning days', '2');
  await fill('Start date', '');
  await click('Next');
  assert.equal(writes.length, 0);
  await fill('Start date', '2026-11-08');
  await click('Next');
  await fill('Experience and preferences', 'I know SELECT; I need GROUP BY exercises.');
  await click('Generate roadmap');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].days, 2);
  assert.equal(writes[0].feedback, '');
  assert.match(document.body.textContent!, /2026-11-09/);
  await fill('Day 1', 'Practice filtered customer queries');
  await fill('What should AI change?', 'Use customer reporting examples');
  await click('Refine roadmap');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].previous.steps, [
    'Practice filtered customer queries',
    'Build a grouped report',
  ]);
  assert.equal(writes[1].feedback, 'Use customer reporting examples');
  assert.equal(reviewed.length, 0);
  await click('Use roadmap');
  assert.deepEqual(reviewed, [draft]);
});

test('planner failures keep the goal editable and permit switching to manual planning', async () => {
  let manual = 0,
    closed = 0;
  view = await render(
    <LearningPlanner
      today="2026-11-08"
      initialGoal="Improve SQL reporting"
      onClose={() => closed++}
      onReview={() => {
        throw Error('must not review');
      }}
      onManual={() => manual++}
    />,
  );
  await click('Next');
  response = Response.json({ error: { message: 'Your AI quota is exhausted' } }, { status: 429 });
  await click('Generate roadmap');
  assert.match(document.body.textContent!, /quota is exhausted/);
  response = Response.json({ title: 'Incomplete' });
  await click('Generate roadmap');
  assert.match(document.body.textContent!, /incomplete roadmap/);
  await click('Back');
  assert.equal(document.querySelector('textarea')!.value, 'Improve SQL reporting');
  await click('Write plan manually');
  assert.equal(manual, 1);
  await click('Cancel');
  assert.equal(closed, 1);
});

test('unconfirmed calendar save retries the same draft and locks edits until resolved', async () => {
  const saved: any[] = [];
  let closed = 0;
  view = await render(
    <LearningPlanner
      today="2026-11-08"
      initialDraft={draft}
      onClose={() => closed++}
      onReview={() => {
        throw Error('must not customize');
      }}
      onConfirmSchedule={async value => {
        saved.push(value);
        if (saved.length === 1) throw Error('Network response lost');
      }}
    />,
  );
  assert.match(document.body.textContent!, /previous save is unconfirmed/);
  assert.ok([...document.querySelectorAll('textarea')].every(input => input.disabled));
  await click('Retry confirmation');
  assert.match(document.body.textContent!, /Network response lost/);
  await click('Retry confirmation');
  assert.deepEqual(saved, [draft, draft]);
  assert.equal(writes.length, 0);
  await click('Close');
  assert.equal(closed, 1);
});
