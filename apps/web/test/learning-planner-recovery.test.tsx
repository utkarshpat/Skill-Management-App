import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { LearningPlanCreateAttempt } from '../src/learning-plan-create';

test('closing and reopening an uncertain AI plan restores the draft and reconciles the same create', async () => {
  const source = await fs.readFile(new URL('../src/Learning.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('<LearningPlanner');
  const jsx = source.slice(start, source.indexOf('/>', start) + 2);
  const code = transformSync(jsx, { loader: 'tsx', jsxFactory: 'element' }).code;
  const plannerCreate: { current: LearningPlanCreateAttempt | null } = { current: null };
  let writes = 0;
  let savedId = '';
  let readable = false;
  let goal: string | undefined = 'Learn Azure';
  const render = () =>
    vm.runInNewContext(code, {
      element: (_component: unknown, props: any) => props,
      LearningPlanner: 'planner',
      LearningPlanCreateAttempt,
      plannerCreate,
      pendingPlannerDraft: plannerCreate.current?.pendingDraft,
      plannerGoal: goal,
      today: '2026-10-17',
      selectedDay: '2026-10-17',
      tab: 'My learning',
      zone: 'UTC',
      state: { canManage: true },
      setPlannerGoal: (value: string | undefined) => {
        goal = value;
      },
      openCreate: () => {},
      setAttempt: () => {},
      setSelectedDay: () => {},
      setMonth: () => {},
      setTab: () => {},
      setNotice: () => {},
      window: { dispatchEvent: () => {} },
      Event,
      authenticatedFetch: async (_path: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          writes++;
          savedId = JSON.parse(String(init.body)).id;
          throw Error('Response lost after commit');
        }
        if (!readable) throw Error('Read unavailable');
        return Response.json({ plans: [{ id: savedId }] });
      },
    });
  const draft = {
    title: 'Azure',
    goal: 'Learn Azure',
    steps: ['Read', 'Build'],
    dailyMinutes: 30,
    days: 2,
    startDate: '2026-10-17',
  };
  const first = render();
  await assert.rejects(first.onConfirmSchedule(draft), /could not be confirmed/);
  const pending = plannerCreate.current;
  assert.equal(pending?.pending, true);
  first.onClose();
  assert.equal(goal, undefined);
  assert.equal(plannerCreate.current, pending, 'Closing must retain the uncertain write identity');
  goal = 'A different launch goal';
  const reopened = render();
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.initialDraft)), draft);
  readable = true;
  await reopened.onConfirmSchedule(reopened.initialDraft);
  assert.equal(writes, 1, 'Reopening must reconcile the committed plan, not create another');
  assert.equal(plannerCreate.current, null);
});

test('planner permits correction after a definite rejection but preserves uncertain confirmation', async () => {
  const source = await fs.readFile(new URL('../src/LearningPlanner.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  async function handleConfirmSchedule()');
  const end = source.indexOf('  const schedule =', start);
  const code = transformSync(source.slice(start, end) + '\nhandleConfirmSchedule();', {
    loader: 'ts',
  }).code;
  for (const status of [400, 403, 409, 503, undefined]) {
    let locked = false;
    await vm.runInNewContext(code, {
      draft: { steps: ['Learn'] },
      busy: false,
      setBusy: () => {},
      setError: () => {},
      setConfirmationStarted: (value: boolean) => {
        locked = value;
      },
      onConfirmSchedule: async () => {
        throw Object.assign(Error('Save failed'), { status });
      },
    });
    assert.equal(locked, status !== 400 && status !== 403);
  }
});
