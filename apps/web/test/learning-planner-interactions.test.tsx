import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { render, settle, closeBrowser, demoResponse, deferred } from './support/browser';
import { refreshDevelopmentLogin, component, click, fill, change } from './support/interactions';
import type { LearningRoadmap } from '../src/learning-roadmap';
Object.assign(globalThis, {
  Node: window.Node,
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
});
const { LearningPlanner } =
  component<typeof import('../src/LearningPlanner')>('LearningPlanner.tsx');
type Props = Parameters<typeof LearningPlanner>[0];
const roadmap: LearningRoadmap = {
  title: 'SQL customer reporting practice',
  goal: 'Build reliable SQL reporting queries for Northstar Bank',
  steps: [
    'Compare reporting joins',
    'Practice grouped reporting metrics',
    'Document and review a customer reporting example',
  ],
  dailyMinutes: 30,
  days: 3,
  startDate: '2026-11-06',
};
let mounted: Awaited<ReturnType<typeof render>> | undefined,
  requests: any[] = [],
  reviewed: LearningRoadmap[] = [],
  confirmed: LearningRoadmap[] = [],
  reply: any,
  status = 200,
  confirmationError: Error | undefined,
  manual = 0,
  closed = 0,
  pending: ReturnType<typeof deferred<Response>> | undefined,
  signal: AbortSignal | undefined;
beforeEach(async () => {
  requests = [];
  reviewed = [];
  confirmed = [];
  reply = structuredClone(roadmap);
  status = 200;
  confirmationError = undefined;
  manual = 0;
  closed = 0;
  pending = undefined;
  signal = undefined;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    if (path === '/api/dev-login') return demoResponse();
    assert.equal(path, '/api/learning/planner');
    requests.push(JSON.parse(String(init?.body)));
    signal = init?.signal ?? undefined;
    if (pending) return pending.promise;
    return status === 200
      ? Response.json(reply)
      : Response.json(
          { error: { message: 'AI planning quota unavailable. Try later.' } },
          { status },
        );
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount(options: Partial<Props> = {}) {
  mounted = await render(
    <LearningPlanner
      today="2026-11-06"
      onClose={() => closed++}
      onManual={() => manual++}
      onReview={draft => reviewed.push(draft)}
      {...options}
    />,
  );
  await settle();
}
async function prepare() {
  await fill('What would you like to learn?', roadmap.goal);
  await fill('Learning days', '3');
  await fill('Minutes per day', '30');
  await fill('Start date', '2026-11-06');
  await click('Next');
  await fill(
    'Experience and preferences',
    'I can read basic reporting queries and prefer practical delivery exercises.',
  );
}

test('planner validates bounded goals and schedules before any quota-consuming request, then returns only a reviewed draft', async () => {
  await mount();
  await click('Next');
  assert.match(document.body.textContent!, /Enter a goal/);
  assert.equal(requests.length, 0);
  await fill('What would you like to learn?', roadmap.goal);
  await fill('Learning days', '13');
  await click('Next');
  assert.equal(requests.length, 0);
  await prepare();
  await click('Generate roadmap');
  assert.deepEqual(requests[0], {
    goal: roadmap.goal,
    experience: 'I can read basic reporting queries and prefer practical delivery exercises.',
    dailyMinutes: 30,
    days: 3,
    feedback: '',
  });
  assert.match(document.body.textContent!, /2026-11-08/);
  assert.equal(reviewed.length, 0);
  await click('Use roadmap');
  assert.deepEqual(reviewed, [roadmap]);
  assert.equal(requests.length, 1);
});
test('quota errors and malformed AI output retain the goal and never create or confirm a learning plan', async () => {
  await mount();
  await prepare();
  status = 429;
  await click('Generate roadmap');
  assert.match(document.body.textContent!, /quota unavailable/);
  assert.equal(reviewed.length, 0);
  status = 200;
  reply = { ...roadmap, steps: [] };
  await click('Generate roadmap');
  assert.match(document.body.textContent!, /incomplete roadmap/);
  assert.equal(reviewed.length, 0);
  assert.equal(confirmed.length, 0);
  reply = structuredClone(roadmap);
  await click('Generate roadmap');
  assert.match(document.body.textContent!, /SQL customer reporting practice/);
  assert.equal(reviewed.length, 0);
  assert.equal(requests.length, 3);
});
test('roadmap refinement receives the exact edited draft and user feedback without saving it', async () => {
  await mount({ initialGoal: roadmap.goal });
  await fill('Learning days', '3');
  await click('Next');
  await click('Generate roadmap');
  const first = document.querySelector<HTMLTextAreaElement>('.roadmap-task textarea');
  assert.ok(first);
  await change(first, 'Compare inner and outer joins using customer reports');
  await fill('What should AI change?', 'Include a reporting quality check');
  reply = {
    ...roadmap,
    steps: ['Compare reporting joins', 'Validate reporting totals', 'Review delivery evidence'],
  };
  await click('Refine roadmap');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].feedback, 'Include a reporting quality check');
  assert.equal(
    requests[1].previous.steps[0],
    'Compare inner and outer joins using customer reports',
  );
  await click('Use roadmap');
  assert.deepEqual(reviewed[0].steps, reply.steps);
  assert.equal(confirmed.length, 0);
});
test('uncertain calendar confirmation locks editing and retries the same restored draft without another AI request', async () => {
  confirmationError = Object.assign(Error('Calendar confirmation was lost'), { status: 503 });
  await mount({
    initialDraft: roadmap,
    onConfirmSchedule: async draft => {
      confirmed.push(draft);
      if (confirmationError) throw confirmationError;
      return true;
    },
  });
  await click('Retry confirmation');
  assert.match(document.body.textContent!, /Calendar confirmation was lost/);
  assert.ok(document.querySelector<HTMLTextAreaElement>('.roadmap-task textarea')?.disabled);
  confirmationError = undefined;
  await click('Retry confirmation');
  assert.equal(confirmed.length, 2);
  assert.equal(confirmed[0], confirmed[1]);
  assert.deepEqual(confirmed[0], roadmap);
  assert.equal(requests.length, 0);
  assert.equal(reviewed.length, 0);
  await click('Close');
  assert.equal(closed, 1);
});
test('manual planning avoids AI calls and unmount aborts an in-flight roadmap without delivering late state', async () => {
  await mount();
  await click('Write plan manually');
  assert.equal(manual, 1);
  assert.equal(requests.length, 0);
  await prepare();
  pending = deferred<Response>();
  await click('Generate roadmap');
  assert.equal(requests.length, 1);
  assert.ok(signal && !signal.aborted);
  await mounted!.unmount();
  mounted = undefined;
  assert.equal(signal.aborted, true);
  pending.resolve(Response.json(roadmap));
  await settle();
  assert.equal(reviewed.length, 0);
  assert.equal(confirmed.length, 0);
});
