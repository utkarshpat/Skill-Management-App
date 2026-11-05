import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { refreshDevelopmentLogin, component, click, fill } from './support/interactions';
import type { Plan } from '../src/Learning';
Object.assign(globalThis, {
  Node: window.Node,
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
});
const { LearningRecovery } =
  component<typeof import('../src/LearningRecovery')>('LearningRecovery.tsx');
const day = (offset = 0) => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Calcutta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(today + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const plan: Plan = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  revision: 3,
  title: 'Northstar Bank SQL reporting practice',
  goal: 'Improve customer reporting SQL delivery',
  timezone: 'Asia/Calcutta',
  dailyMinutes: 30,
  targetDate: '2026-11-01',
  status: 'ACTIVE',
  tasks: Array.from({ length: 3 }, (_, i) => ({
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i + 1).padStart(12, '0')}`,
    title: ['Review SQL joins', 'Practice reporting totals', 'Document delivery evidence'][i],
    plannedDate: `2026-10-${String(27 + i).padStart(2, '0')}`,
    estimatedMinutes: 30,
  })),
};
const hash = 'a'.repeat(64);
let mounted: Awaited<ReturnType<typeof render>> | undefined,
  calls: { action: string; body: any }[] = [],
  mode = 'complete',
  failApply = false,
  saved = 0,
  reloaded = 0,
  closed = 0;
let transform: ((value: any) => any) | undefined;
beforeEach(async () => {
  calls = [];
  mode = 'complete';
  failApply = false;
  saved = 0;
  reloaded = 0;
  closed = 0;
  transform = undefined;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    if (path === '/api/dev-login') return demoResponse();
    const action = path.split('/').at(-1)!;
    const body = JSON.parse(String(init?.body));
    calls.push({ action, body });
    if (action === 'preview') {
      if (mode === 'empty-preview') return Response.json({});
      const daily = body.dailyMinutes;
      const tasks = plan.tasks.map((t, i) => ({
        id: t.id,
        title: t.title,
        oldDate: t.plannedDate,
        newDate: day(Math.floor(i / Math.floor(daily / 30))),
        minutes: t.estimatedMinutes,
      }));
      const preview = {
        planId: mode === 'foreign-preview' ? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' : plan.id,
        revision: 3,
        startDate: body.startDate,
        dailyMinutes: daily,
        oldDailyMinutes: 30,
        oldTargetDate: plan.targetDate,
        targetDate: tasks.at(-1)!.newDate,
        today: day(),
        timezone: plan.timezone,
        overdue: 3,
        totalMinutes: 90,
        days: new Set(tasks.map(t => t.newDate)).size,
        tasks,
        previewHash: hash,
      };
      return Response.json(transform ? transform(preview) : preview);
    }
    if (action === 'advice')
      return Response.json({
        previewHash: mode === 'stale-advice' ? 'b'.repeat(64) : hash,
        reply:
          mode === 'invalid-advice'
            ? { text: 'Not a string' }
            : 'Use short SQL practice sessions for customer reporting. '.repeat(25),
      });
    if (action === 'apply')
      return failApply
        ? Response.json(
            { error: { message: 'Plan changed. Review a fresh preview.' } },
            { status: 409 },
          )
        : Response.json(
            mode === 'empty-apply' ? {} : mode === 'null-apply' ? null : { saved: true },
          );
    throw Error('Unexpected recovery path ' + path);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount() {
  mounted = await render(
    <LearningRecovery
      plan={plan}
      onClose={() => closed++}
      onSaved={() => saved++}
      onReload={() => reloaded++}
    />,
  );
  await settle();
}

test('recovery previews all pending work, pages guidance and submits only the reviewed hash and budget', async () => {
  await mount();
  await fill('Daily minutes', '60');
  await click('Preview recovery');
  assert.match(document.body.textContent!, /30 → 60 min/);
  assert.match(document.body.textContent!, /Review SQL joins/);
  await click('More tasks');
  assert.match(document.body.textContent!, /Document delivery evidence/);
  await click('Previous tasks');
  await click('AI guidance');
  await click('Get guidance');
  assert.equal(saved, 0);
  await click('More advice');
  await click('Previous advice');
  await click('Schedule preview');
  await click('Confirm recovery');
  assert.equal(saved, 1);
  assert.deepEqual(calls.find(c => c.action === 'apply')!.body, {
    planId: plan.id,
    revision: 3,
    startDate: day(),
    dailyMinutes: 60,
    previewHash: hash,
  });
});
test('changing recovery budget discards the old preview; stale apply requires reload before another confirmation', async () => {
  await mount();
  await click('Preview recovery');
  await click('Edit budget');
  await fill('Daily minutes', '60');
  assert.equal(
    document
      .querySelector<HTMLButtonElement>('.form-dialog-footer .admin-primary')
      ?.textContent?.trim(),
    'Preview recovery',
  );
  assert.ok(
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.trim() === 'Get guidance',
    )?.disabled,
  );
  await click('Preview recovery');
  failApply = true;
  await click('Confirm recovery');
  assert.equal(saved, 0);
  assert.match(document.body.textContent!, /Plan changed/);
  assert.ok(
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.trim() === 'Confirm recovery',
    )?.disabled,
  );
  await click('Reload plan');
  assert.equal(reloaded, 1);
  assert.equal(calls.filter(c => c.action === 'apply').length, 1);
});
test('malformed or foreign recovery previews produce a controlled error instead of rendering an unbound schedule', async () => {
  for (const selected of ['empty-preview', 'foreign-preview']) {
    mode = selected;
    await mount();
    await click('Preview recovery');
    assert.match(document.body.textContent!, /incomplete or mismatched preview/);
    assert.equal(saved, 0);
    assert.equal(calls.filter(c => c.action === 'apply').length, 0);
    await mounted!.unmount();
    mounted = undefined;
  }
});
test('a success-shaped HTTP response without saved=true never announces recovery completion', async () => {
  mode = 'empty-apply';
  await mount();
  await click('Preview recovery');
  await click('Confirm recovery');
  assert.equal(saved, 0);
  assert.match(document.body.textContent!, /save could not be confirmed/);
  assert.ok(
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.trim() === 'Confirm recovery',
    )?.disabled,
  );
});
test('malformed advice stays a retryable guidance error; mismatched preview hashes block confirmation', async () => {
  await mount();
  await click('Preview recovery');
  await click('AI guidance');
  mode = 'invalid-advice';
  await click('Get guidance');
  assert.match(document.body.textContent!, /incomplete guidance/);
  assert.equal(saved, 0);
  mode = 'stale-advice';
  await click('Get guidance');
  assert.match(document.body.textContent!, /plan changed/i);
  assert.ok(
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.trim() === 'Confirm recovery',
    )?.disabled,
  );
});

test('corrupt recovery snapshots cannot replace the selected plan or misrepresent its pending schedule', async () => {
  const mutations: [string, (value: any) => void][] = [
    [
      'changed revision',
      v => {
        v.revision = 4;
      },
    ],
    [
      'changed start',
      v => {
        v.startDate = day(1);
      },
    ],
    [
      'changed daily budget',
      v => {
        v.dailyMinutes = 60;
      },
    ],
    [
      'changed original budget',
      v => {
        v.oldDailyMinutes = 60;
      },
    ],
    [
      'changed original target',
      v => {
        v.oldTargetDate = day(1);
      },
    ],
    [
      'changed timezone',
      v => {
        v.timezone = 'UTC';
      },
    ],
    [
      'invalid today',
      v => {
        v.today = '2026-02-30';
      },
    ],
    [
      'invalid target',
      v => {
        v.targetDate = '2026-13-01';
      },
    ],
    [
      'target before start',
      v => {
        v.targetDate = day(-1);
      },
    ],
    [
      'missing pending tasks',
      v => {
        v.tasks = null;
      },
    ],
    [
      'lost pending task',
      v => {
        v.tasks.pop();
      },
    ],
    [
      'null task',
      v => {
        v.tasks[0] = null;
      },
    ],
    [
      'duplicate task',
      v => {
        v.tasks[1] = { ...v.tasks[0] };
      },
    ],
    [
      'foreign task',
      v => {
        v.tasks[0].id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      },
    ],
    [
      'invalid task ID',
      v => {
        v.tasks[0].id = 12;
      },
    ],
    [
      'empty task title',
      v => {
        v.tasks[0].title = '';
      },
    ],
    [
      'overlong task title',
      v => {
        v.tasks[0].title = 'x'.repeat(161);
      },
    ],
    [
      'changed original task date',
      v => {
        v.tasks[0].oldDate = day(-5);
      },
    ],
    [
      'shortened existing task',
      v => {
        v.tasks[0].minutes = 15;
      },
    ],
    [
      'task before chosen start',
      v => {
        v.tasks[0].newDate = day(-1);
      },
    ],
    [
      'task beyond target',
      v => {
        v.tasks[0].newDate = day(5);
      },
    ],
    [
      'invalid task date',
      v => {
        v.tasks[0].newDate = 12;
      },
    ],
    [
      'missing review hash',
      v => {
        v.previewHash = '';
      },
    ],
    [
      'invalid overdue count',
      v => {
        v.overdue = -1;
      },
    ],
    [
      'invented overdue count',
      v => {
        v.overdue = 4;
      },
    ],
    [
      'changed minute total',
      v => {
        v.totalMinutes = 89;
      },
    ],
    [
      'invalid day count',
      v => {
        v.days = 1.5;
      },
    ],
    [
      'changed day total',
      v => {
        v.days = 2;
      },
    ],
    [
      'overbooked day',
      v => {
        for (const task of v.tasks) task.newDate = day();
        v.targetDate = day();
        v.days = 1;
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    transform = value => {
      mutate(value);
      return value;
    };
    await mount();
    await click('Preview recovery');
    assert.match(document.body.textContent!, /incomplete or mismatched preview/, name);
    assert.equal(saved, 0, name);
    assert.equal(calls.filter(call => call.action === 'apply').length, 0, name);
    await mounted!.unmount();
    mounted = undefined;
  }
});

test('a missing acknowledgement requires reload rather than another blind recovery apply', async () => {
  mode = 'null-apply';
  await mount();
  await click('Preview recovery');
  await click('Confirm recovery');
  assert.equal(saved, 0);
  assert.match(document.body.textContent!, /save could not be confirmed/);
  await click('Reload plan');
  assert.equal(reloaded, 1);
  assert.equal(calls.filter(call => call.action === 'apply').length, 1);
});
