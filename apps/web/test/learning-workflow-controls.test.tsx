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
const { Learning } = component<typeof import('../src/Learning')>('Learning.tsx');
const plan: import('../src/Learning').Plan = {
  id: 'customer-reporting',
  revision: 4,
  title: 'Customer reporting practice',
  goal: 'Deliver grouped customer reports',
  timezone: 'Asia/Calcutta',
  dailyMinutes: 45,
  targetDate: '2026-12-01',
  status: 'ACTIVE',
  focus: 'Data & AI',
  tasks: [
    {
      id: 'query-practice',
      title: 'Practice grouped queries',
      plannedDate: '2026-11-01',
      estimatedMinutes: 30,
    },
  ],
};
let view: Awaited<ReturnType<typeof render>> | undefined;
let plans: (typeof plan)[],
  failure = 0,
  writeFailure = 0,
  canManage = true;
let writes: any[] = [];
beforeEach(async () => {
  plans = [structuredClone(plan)];
  failure = 0;
  writeFailure = 0;
  canManage = true;
  writes = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    if (url.startsWith('/api/skills?'))
      return Response.json({ skills: [], total: 0, pageSize: 10, categories: [] });
    if (url === '/api/assistant')
      return Response.json({
        reply: 'Practice grouped reporting using your current learning goal.',
        artifact: {
          kind: 'task_draft',
          title: 'Client reporting practice',
          summary: 'Practice reporting',
          body: 'Improve grouped client reporting',
          steps: ['Practice grouping', 'Validate report totals'],
        },
      });
    assert.equal(url, '/api/learning');
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      if (writeFailure)
        return Response.json(
          { error: { message: 'Learning revision changed. Refresh the plan.' } },
          { status: writeFailure },
        );
      const selected = plans.find(p => p.id === body.id);
      if (selected && ['PAUSE', 'RESUME', 'ARCHIVE'].includes(body.action))
        selected.status =
          body.action === 'PAUSE' ? 'PAUSED' : body.action === 'RESUME' ? 'ACTIVE' : 'ARCHIVED';
      if (body.action === 'CREATE') plans.push({ ...body, status: 'ACTIVE', revision: 1 });
      return Response.json({ ok: true });
    }
    return failure
      ? Response.json({ error: { message: 'Learning access denied' } }, { status: failure })
      : Response.json({ actorId: 'aditi', plans, canManage });
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount(path = '/learning?tab=paths') {
  view = await render(
    <MemoryRouter initialEntries={[path]}>
      <Learning />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}

test('learning paths pause, resume and archive only the selected plan with explicit confirmation', async () => {
  await mount();
  await click('Pause');
  assert.deepEqual(writes[0], { action: 'PAUSE', id: plan.id, revision: 4 });
  await click('Resume');
  assert.deepEqual(writes[1], { action: 'RESUME', id: plan.id, revision: 4 });
  await click('Archive');
  assert.equal(writes.length, 2);
  assert.match(document.querySelector('.form-dialog')!.textContent!, /logged progress is retained/);
  await click('Cancel');
  assert.equal(writes.length, 2);
  await click('Archive');
  await click('Archive plan');
  assert.deepEqual(writes[2], { action: 'ARCHIVE', id: plan.id, revision: 4 });
  assert.equal(document.querySelector('.form-dialog'), null);
});

test('backlog rescheduling and completion retain notes after a conflict', async () => {
  await mount('/learning?tab=backlog');
  await click('Reschedule');
  await fill('New date', '2026-11-15');
  await click('Save');
  assert.deepEqual(writes[0], {
    action: 'RESCHEDULE',
    id: plan.id,
    revision: 4,
    taskId: 'query-practice',
    plannedDate: '2026-11-15',
  });
  await click('Log completion');
  await fill('Actual minutes', '40');
  await fill('What did you learn?', 'Used GROUP BY and HAVING to validate client totals.');
  writeFailure = 409;
  await click('Save');
  assert.match(document.body.textContent!, /Learning revision changed/);
  assert.equal(
    document.querySelector('textarea')!.value,
    'Used GROUP BY and HAVING to validate client totals.',
  );
  writeFailure = 0;
  await click('Save');
  assert.deepEqual(writes[1], writes[2]);
  assert.equal(writes[2].action, 'LOG');
  assert.equal(writes[2].actualMinutes, 40);
  assert.equal(document.querySelector('.form-dialog'), null);
});

test('manual plan requires review and schedules exact tasks without changing skill proficiency', async () => {
  await mount();
  await click('New plan');
  await fill('Plan name', 'SQL delivery practice');
  await fill('Your goal', 'Build reliable customer reports');
  await fill('Minutes per day', '35');
  await fill('Start date', '2026-11-10');
  await click('Next', document.querySelector('.form-dialog-footer')!);
  await fill('Learning focus', 'Data & AI');
  await click('Next', document.querySelector('.form-dialog-footer')!);
  await click('Next', document.querySelector('.form-dialog-footer')!);
  assert.equal(writes.length, 0);
  assert.match(document.body.textContent!, /Enter a title, goal/);
  await fill('Tasks', 'Practice filters\nPractice joins\nGroup client totals\nReview query plans');
  await click('Next', document.querySelector('.form-dialog-footer')!);
  await click('More tasks');
  assert.match(document.querySelector('.form-dialog')!.textContent!, /Review query plans/);
  await click('Previous tasks');
  assert.equal(writes.length, 0);
  await click('Create plan & add to calendar');
  const body = writes[0];
  assert.equal(body.action, 'CREATE');
  assert.equal(body.title, 'SQL delivery practice');
  assert.equal(body.focus, 'Data & AI');
  assert.equal(body.skillId, undefined);
  assert.equal(body.targetDate, '2026-11-13');
  assert.equal(body.tasks.length, 4);
  assert.deepEqual(
    body.tasks.map((t: any) => t.plannedDate),
    ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'],
  );
  assert.equal(new Set(body.tasks.map((t: any) => t.id)).size, 4);
  assert.match(document.body.textContent!, /4 tasks were added to your calendar/);
});

test('calendar month navigation and empty-day manual creation preserve the selected date', async () => {
  plans = [];
  await mount('/learning?tab=calendar');
  await click('Next month');
  await click('Previous month');
  const day = [...document.querySelectorAll<HTMLButtonElement>('.calendar-grid button')].find(b =>
    b.getAttribute('aria-label')?.endsWith('-20'),
  )!;
  const date = day.getAttribute('aria-label')!;
  await act(async () => day.click());
  await settle();
  await click('Add manual plan for this date');
  assert.equal((document.querySelector('input[type="date"]') as HTMLInputElement).value, date);
  await click('Cancel');
  assert.equal(document.querySelector('.form-dialog'), null);
});

test('read-only learning hides mutations and denied deep links never create a plan', async () => {
  canManage = false;
  await mount('/learning?action=create');
  assert.match(document.body.textContent!, /Learning editing is not assigned/);
  assert.equal(document.querySelector('.learning-toolbar'), null);
  assert.equal(writes.length, 0);
  await view!.unmount();
  view = undefined;
  failure = 403;
  await mount();
  assert.match(document.body.textContent!, /Learning access denied/);
  assert.equal(document.querySelector('.ld-path'), null);
  failure = 0;
  await click('Retry');
  assert.match(document.body.textContent!, /Customer reporting practice/);
  assert.equal(writes.length, 0);
});

test('unconfirmed manual save retries the original calendar payload without duplicating task IDs', async () => {
  await mount();
  await click('New plan');
  await fill('Plan name', 'Reliable reporting');
  await fill('Your goal', 'Verify client totals');
  await fill('Start date', '2026-11-10');
  await click('Next', document.querySelector('.form-dialog-footer')!);
  await click('Next', document.querySelector('.form-dialog-footer')!);
  await fill('Tasks', 'Build grouped query');
  await click('Next', document.querySelector('.form-dialog-footer')!);
  writeFailure = 409;
  await click('Create plan & add to calendar');
  assert.match(document.body.textContent!, /Save could not be confirmed/);
  const back = [...document.querySelectorAll('button')].find(
    b => b.textContent?.trim() === 'Back',
  )!;
  assert.equal(back.disabled, true);
  writeFailure = 0;
  await click('Create plan & add to calendar');
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(plans.filter(p => p.title === 'Reliable reporting').length, 1);
});

test('AI learning suggestion remains a draft until the personal schedule is reviewed', async () => {
  await mount('/learning');
  await fill('Your goal for the AI planner', 'Improve client reporting');
  await click('Get recommendations');
  assert.equal(writes.length, 0);
  assert.match(document.body.textContent!, /Practice grouped reporting/);
  await click('Review draft before adding');
  assert.ok(document.querySelector('[aria-label="New learning plan"]'));
  assert.equal(writes.length, 0);
  assert.match(
    document.querySelector('.form-dialog')!.textContent!,
    /Add this plan to your calendar/,
  );
  await click('Close New learning plan');
  assert.equal(writes.length, 0);
});
