import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { dateInZone } from '../src/learning-calendar';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { registerHooks } from 'node:module';
import { MemoryRouter } from 'react-router';
import { refreshDevelopmentLogin } from '../src/auth';
import { click, fill } from './support/interactions';
const css = registerHooks({
  load(url, context, next) {
    return url.endsWith('.css')
      ? { format: 'module', source: '', shortCircuit: true }
      : next(url, context);
  },
});
const { Learning } = await import('../src/Learning');
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
let recoveryCalls: { action: string; body: Record<string, unknown> }[];
let learningReads: number;
let journeyFailure: number;
let sessionWrites: Record<string, unknown>[];
beforeEach(async () => {
  plans = [structuredClone(plan)];
  failure = 0;
  writeFailure = 0;
  canManage = true;
  writes = [];
  recoveryCalls = [];
  learningReads = journeyFailure = 0;
  sessionWrites = [];
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
    if (url.startsWith('/api/recommendations?'))
      return Response.json({ items: [], total: 0, pageSize: 10 });
    if (url === '/api/my-skills/journey')
      return journeyFailure
        ? Response.json(
            { error: { message: 'Skill-claim status denied' } },
            { status: journeyFailure },
          )
        : Response.json({ claims: [], total: 0, pageSize: 10, canClaim: true });
    if (url.startsWith('/api/learning/practice?') || url === '/api/learning/practice/session') {
      const body = init?.method === 'POST' ? JSON.parse(String(init.body)) : undefined;
      if (body) sessionWrites.push(body);
      return Response.json({
        session: {
          revision: body ? 3 : 2,
          notes: body?.notes ?? 'Validated report totals.',
          minutes: body?.minutes ?? 35,
          resources: [],
        },
        quizzes: [],
        attempts: [],
      });
    }
    if (url === '/api/learning/planner') {
      const body = JSON.parse(String(init?.body));
      return Response.json({
        title: 'Client reporting roadmap',
        goal: body.goal,
        dailyMinutes: body.dailyMinutes,
        days: body.days,
        startDate: body.startDate,
        steps: ['Practice filters', 'Validate grouped totals'],
      });
    }
    if (url.startsWith('/api/learning/recovery/')) {
      const action = url.split('/').at(-1)!;
      const body = JSON.parse(String(init?.body));
      recoveryCalls.push({ action, body });
      if (action === 'apply') {
        if (writeFailure)
          return Response.json(
            { error: { message: 'Plan changed. Reload and review again.' } },
            { status: writeFailure },
          );
        plans[0].revision++;
        plans[0].tasks[0].plannedDate = String(body.startDate);
        return Response.json({ saved: true });
      }
      assert.equal(action, 'preview');
      const task = plans[0].tasks[0];
      return Response.json({
        planId: plan.id,
        revision: plans[0].revision,
        startDate: body.startDate,
        dailyMinutes: body.dailyMinutes,
        oldDailyMinutes: plan.dailyMinutes,
        oldTargetDate: plan.targetDate,
        targetDate: body.startDate,
        today: dateInZone(new Date(), plan.timezone),
        timezone: plan.timezone,
        overdue: 1,
        totalMinutes: task.estimatedMinutes,
        days: 1,
        tasks: [
          {
            id: task.id,
            title: task.title,
            oldDate: task.plannedDate,
            newDate: body.startDate,
            minutes: task.estimatedMinutes,
          },
        ],
        previewHash: 'a'.repeat(64),
      });
    }
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
    learningReads++;
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
after(async () => {
  css.deregister();
  await closeBrowser();
});
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

async function waitForDialog(name: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const element = document.querySelector(`dialog[aria-label="${name}"]`);
    if (element) return element;
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
    });
  }
  throw Error('Expected dialog: ' + name);
}

test('backlog recovery reloads after conflict and returns to calendar only after a confirmed save', async () => {
  plans[0].tasks[0].plannedDate = '2026-01-01';
  await mount('/learning?tab=backlog');
  await click('Recover plan');
  const recovery = await waitForDialog('Recover learning plan');
  await click('Preview recovery', recovery);
  const preview = recoveryCalls[0].body;
  assert.equal(preview.planId, plan.id);
  assert.equal(preview.revision, 4);
  writeFailure = 409;
  await click('Confirm recovery', recovery);
  assert.match(recovery.textContent!, /Plan changed/);
  const previous = learningReads;
  await click('Reload plan', recovery);
  assert.ok(learningReads > previous);
  assert.equal(document.querySelector('[aria-label="Recover learning plan"]'), null);
  assert.match(
    document.querySelector('.learning-tabs [aria-current="page"]')!.textContent!,
    /Backlog/,
  );
  writeFailure = 0;
  await click('Recover plan');
  const reopened = await waitForDialog('Recover learning plan');
  await click('Preview recovery', reopened);
  await click('Confirm recovery', reopened);
  assert.deepEqual(
    recoveryCalls.map(call => call.action),
    ['preview', 'apply', 'preview', 'apply'],
  );
  assert.equal(recoveryCalls[3].body.previewHash, 'a'.repeat(64));
  assert.match(document.body.textContent!, /Recovery saved/);
  assert.equal(
    document.querySelector('.learning-tabs [aria-current="page"]')!.textContent,
    'Calendar',
  );
});

test('learning navigation opens the calendar planner without writing a plan on cancel', async () => {
  plans = [];
  await mount();
  const navigation = document.querySelector('.learning-tabs')!;
  await click('Calendar', navigation);
  assert.equal(navigation.querySelector('[aria-current="page"]')!.textContent, 'Calendar');
  await click('Build AI roadmap starting');
  const planner = await waitForDialog('AI learning planner');
  await click('Cancel', planner);
  assert.equal(document.querySelector('[aria-label="AI learning planner"]'), null);
  assert.equal(writes.length, 0);
  await click('Goals', navigation);
  assert.equal(navigation.querySelector('[aria-current="page"]')!.textContent, 'Goals');
});

test('confirming a generated roadmap retries the same schedule after a conflict and then opens the calendar', async () => {
  await mount();
  await click('AI planner', document.querySelector('.learning-toolbar')!);
  const planner = await waitForDialog('AI learning planner');
  await fill('What would you like to learn?', 'Improve SQL reporting', planner);
  await fill('Minutes per day', '30', planner);
  await fill('Learning days', '2', planner);
  await fill('Start date', '2026-11-10', planner);
  await click('Next', planner);
  await click('Generate roadmap', planner);
  assert.equal(writes.length, 0);
  writeFailure = 409;
  await click('Confirm & add to calendar', planner);
  assert.match(planner.textContent!, /Learning revision changed/);
  writeFailure = 0;
  await click('Retry confirmation', planner);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[1].action, 'CREATE');
  assert.deepEqual(
    writes[1].tasks.map((task: { plannedDate: string }) => task.plannedDate),
    ['2026-11-10', '2026-11-11'],
  );
  assert.equal(document.querySelector('[aria-label="AI learning planner"]'), null);
  assert.equal(
    document.querySelector('.learning-tabs [aria-current="page"]')!.textContent,
    'Calendar',
  );
  assert.match(document.body.textContent!, /2 tasks added to your calendar/);
});

test('growth journey resumes the selected paused plan and opens its next learning session', async () => {
  plans[0] = { ...plans[0], skillId: 'sql', skillName: 'SQL reporting', status: 'PAUSED' };
  await mount('/learning?tab=journey');
  await click('Resume learning plan');
  assert.deepEqual(writes, [{ action: 'RESUME', id: plan.id, revision: 4 }]);
  await click('Continue learning');
  const session = await waitForDialog('Practice grouped queries');
  assert.match(session.textContent!, /Customer reporting practice/);
  await click('Close Practice grouped queries', session);
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(sessionWrites.length, 0);
});

test('learning session completion transfers saved minutes and notes into the explicit log form', async () => {
  await mount('/learning');
  await click('Continue learning', document.querySelector('.ld-focus-task')!);
  const session = await waitForDialog('Practice grouped queries');
  await settle();
  await click('Log completion', session);
  assert.deepEqual(sessionWrites, [
    {
      planId: plan.id,
      taskId: 'query-practice',
      revision: 2,
      notes: 'Validated report totals.',
      minutes: 35,
      resources: [],
    },
  ]);
  const log = await waitForDialog('Log completion');
  assert.equal(log.querySelector('textarea')!.value, 'Validated report totals.');
  assert.equal(writes.length, 0);
  await click('Save', log);
  assert.equal(writes[0].action, 'LOG');
  assert.equal(writes[0].actualMinutes, 35);
  assert.equal(writes[0].notes, 'Validated report totals.');
  assert.equal(document.querySelector('dialog'), null);
});

test('growth journey retries denied claim status before offering a new claim for completed learning', async () => {
  plans[0] = {
    ...plans[0],
    skillId: 'sql',
    skillName: 'SQL reporting',
    tasks: [{ ...plans[0].tasks[0], completedAt: '2026-11-08T10:00:00Z' }],
  };
  journeyFailure = 403;
  await mount('/learning?tab=journey');
  assert.match(document.body.textContent!, /Skill-claim status denied/);
  assert.equal(document.querySelector('a[href^="/my-skills?action=add"]'), null);
  journeyFailure = 0;
  await click('Retry', document.querySelector('[role="alert"]')!);
  assert.ok(document.querySelector('a[href^="/my-skills?action=add"]'));
  assert.equal(writes.length, 0);
});
