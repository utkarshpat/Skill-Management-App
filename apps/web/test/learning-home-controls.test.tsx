import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  fill,
} from './support/interactions';
const { LearningHome } = component<typeof import('../src/LearningHome')>('LearningHome.tsx');
import type { Plan } from '../src/Learning';
const plan: Plan = {
  id: 'reporting',
  revision: 4,
  title: 'Reliable SQL reporting',
  goal: 'Validate customer reporting totals',
  timezone: 'Asia/Calcutta',
  dailyMinutes: 30,
  targetDate: '2026-01-12',
  status: 'ACTIVE',
  skillId: 'sql',
  skillName: 'SQL',
  tasks: Array.from({ length: 12 }, (_, i) => ({
    id: 'task-' + i,
    title: 'Reporting exercise ' + (i + 1),
    plannedDate: '2026-01-' + String(i + 1).padStart(2, '0'),
    estimatedMinutes: 30,
    ...(i < 4
      ? {
          completedAt: '2026-01-' + String(i + 1).padStart(2, '0') + 'T12:00:00Z',
          actualMinutes: 35,
        }
      : {}),
  })),
};
let view: Awaited<ReturnType<typeof render>> | undefined;
let changes: string[] = [],
  opened: string[] = [],
  aiCalls = 0,
  fail = false;
let plans: Plan[] = [];
const callbacks = () => ({
  onNew: () => changes.push('new'),
  onPlanner: (goal: string) => changes.push('planner:' + goal),
  onRecover: (p: Plan) => changes.push('recover:' + p.id),
  onContinue: (p: Plan, t: Plan['tasks'][number]) => opened.push(p.id + ':' + t.id),
  onDraft: (d: any) => changes.push('draft:' + d.title),
  onStateChange: (p: Plan) => changes.push('state:' + p.id),
  onArchive: (p: Plan) => changes.push('archive:' + p.id),
  onTab: (tab: string) => changes.push('tab:' + tab),
});
beforeEach(async () => {
  changes = [];
  opened = [];
  aiCalls = 0;
  fail = false;
  plans = [structuredClone(plan)];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    assert.equal(url, '/api/assistant');
    aiCalls++;
    return fail
      ? Response.json({ error: { message: 'Suggestions unavailable' } }, { status: 503 })
      : Response.json({
          reply: 'Practice reviewing grouped reporting totals.',
          artifact: {
            kind: 'task_draft',
            title: 'Reporting practice',
            summary: 'Practice SQL',
            body: 'Build grouped reports',
            steps: ['Validate totals'],
          },
        });
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount(tab = 'My learning', canManage = true, path = '/learning') {
  view = await render(
    <MemoryRouter initialEntries={[path]}>
      <LearningHome
        busy={false}
        plans={plans}
        canManage={canManage}
        tab={tab}
        zone="Asia/Calcutta"
        {...callbacks()}
      />
    </MemoryRouter>,
  );
  await settle();
}
const card = (title: string) =>
  [...document.querySelectorAll<HTMLElement>('.ld-card')].find(
    el => el.querySelector('h2')?.textContent === title,
  )!;

test('learning dashboard queue, completed logs and deadlines paginate independently with exact task callbacks', async () => {
  await mount();
  const queue = card('My learning queue'),
    recent = card('Completed recently'),
    deadlines = card('Upcoming deadlines');
  assert.equal(queue.querySelectorAll('article').length, 4);
  await click('Next', queue);
  assert.equal(queue.querySelectorAll('article').length, 4);
  await click('Continue', queue);
  assert.equal(opened.at(-1), 'reporting:task-8');
  await click('Previous', queue);
  await click('View log', recent);
  assert.equal(opened.at(-1), 'reporting:task-3');
  await click('Next', recent);
  assert.equal(recent.querySelectorAll('article').length, 1);
  await click('Previous', recent);
  assert.equal(deadlines.querySelectorAll('.ld-deadline').length, 4);
  await click('View all', deadlines);
  assert.equal(deadlines.querySelectorAll('.ld-deadline').length, 8);
  const deadline = [...deadlines.querySelectorAll<HTMLButtonElement>('.ld-deadline')].find(button =>
    button.textContent?.includes('Reporting exercise 5'),
  );
  assert.ok(deadline);
  await act(async () => deadline.click());
  assert.equal(opened.at(-1), 'reporting:task-4');
  await click('Show less', deadlines);
  assert.equal(deadlines.querySelectorAll('.ld-deadline').length, 4);
  await click('Continue learning');
  assert.equal(opened.at(-1), 'reporting:task-4');
});

test('full learning roadmap supports task pages, week selection and exact task opening', async () => {
  await mount();
  await click('View full plan');
  assert.equal(document.querySelectorAll('.ld-plan-task').length, 3);
  await click('Next', document.querySelector('.ld-plan-week .ld-pager')!);
  assert.match(document.querySelector('.ld-plan-week')!.textContent!, /Reporting exercise 4/);
  await click('Previous', document.querySelector('.ld-plan-week .ld-pager')!);
  await click('Next week');
  assert.match(document.querySelector('.ld-plan-week')!.textContent!, /Reporting exercise 8/);
  await click('Previous week');
  await fill('Roadmap week', '1');
  await click('Open task', document.querySelector('.ld-plan-week')!);
  assert.equal(opened.at(-1), 'reporting:task-7');
  assert.equal(document.querySelector('.form-dialog'), null);
  await click('View goal');
  await click('Close Reliable SQL reporting');
  assert.equal(document.querySelector('.form-dialog'), null);
});

test('path and goal actions target only their selected plan and read-only paths hide mutations', async () => {
  await mount('Learning paths');
  await click('Pause');
  await click('Recover plan');
  await click('Archive');
  assert.deepEqual(changes, ['state:reporting', 'recover:reporting', 'archive:reporting']);
  await click('View full plan');
  await click('Close Reliable SQL reporting');
  await view!.unmount();
  view = undefined;
  await mount('Goals');
  await click('Reliable SQL reporting');
  assert.ok(document.querySelector('.form-dialog'));
  await click('Close Reliable SQL reporting');
  await view!.unmount();
  view = undefined;
  await mount('Learning paths', false);
  assert.equal(document.querySelector('.ld-plan-actions'), null);
  assert.equal(changes.length, 3);
});

test('AI recommendation stat switches context on demand, retries explicitly and opens only a draft', async () => {
  await mount('Goals');
  fail = true;
  await click('AI recommendations: On demand, click to generate');
  assert.deepEqual(changes, ['tab:My learning']);
  assert.equal(aiCalls, 1);
  await view!.unmount();
  view = undefined;
  await mount();
  await fill('Your goal for the AI planner', 'Improve SQL reporting');
  await click('Build AI roadmap');
  assert.equal(changes.at(-1), 'planner:Improve SQL reporting');
  await click('Get recommendations');
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /Suggestions unavailable/);
  fail = false;
  await click('Get recommendations');
  await click('Review draft before adding');
  assert.equal(changes.at(-1), 'draft:Reporting practice');
  const before = aiCalls;
  await click('AI recommendations: Ready, click to view');
  assert.equal(aiCalls, before);
});

test('learning plan deep link opens only the supplied plan and empty dashboard offers explicit creation', async () => {
  await mount('Goals', true, '/learning?openPlan=reporting');
  assert.ok(document.querySelector('.form-dialog'));
  await click('Close Reliable SQL reporting');
  await view!.unmount();
  view = undefined;
  plans = [];
  await mount();
  assert.match(document.body.textContent!, /No pending deadlines/);
  await click('Add learning goal');
  assert.equal(changes.at(-1), 'new');
  assert.equal(opened.length, 0);
  assert.equal(aiCalls, 0);
});
