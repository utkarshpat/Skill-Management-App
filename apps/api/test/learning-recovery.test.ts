import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  LearningRecoveryService,
  recoveryInput,
  recoverySchedule,
} from '../src/modules/learning/recovery.js';
import type { LearningPlan, LearningStore } from '../src/modules/learning/learning.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { createApp } from '../src/create-app.js';
const plan: LearningPlan = {
  id: randomUUID(),
  revision: 3,
  title: 'Recovery',
  goal: 'Learn',
  timezone: 'Asia/Kolkata',
  status: 'ACTIVE',
  dailyMinutes: 30,
  targetDate: '2026-10-05',
  tasks: [
    {
      id: randomUUID(),
      title: 'Done',
      estimatedMinutes: 30,
      plannedDate: '2026-10-02',
      actualMinutes: 20,
      notes: 'Keep',
      completedAt: '2026-10-02T14:00:00Z',
    },
    { id: randomUUID(), title: 'Oldest', estimatedMinutes: 30, plannedDate: '2026-10-03' },
    { id: randomUUID(), title: 'Future', estimatedMinutes: 30, plannedDate: '2026-10-05' },
  ],
};
const now = () => new Date('2026-10-03T20:00:00Z'),
  input = { planId: plan.id, revision: 3, startDate: '2026-10-04', dailyMinutes: 60 };
test('recovery schedule packs pending tasks, preserves completed records and follows plan timezone', () => {
  const original = structuredClone(plan),
    schedule = recoverySchedule(plan, input, now());
  assert.equal(schedule.today, '2026-10-04');
  assert.equal(schedule.overdue, 1);
  assert.equal(schedule.targetDate, '2026-10-04');
  assert.equal(schedule.days, 1);
  assert.equal(schedule.totalMinutes, 60);
  assert.deepEqual(
    schedule.tasks.map(t => t.title),
    ['Oldest', 'Future'],
  );
  assert.ok(schedule.tasks.every(t => t.newDate === '2026-10-04'));
  assert.deepEqual(plan, original);
  const extended = recoverySchedule(
    plan,
    { ...input, dailyMinutes: 30, startDate: '2026-10-06' },
    now(),
  );
  assert.equal(extended.targetDate, '2026-10-07');
  assert.deepEqual(
    extended.tasks.map(t => t.newDate),
    ['2026-10-06', '2026-10-07'],
  );
});
test('recovery rejects forged dates/owners, insufficient capacity, stale revisions and inactive/no-backlog plans', () => {
  for (const extra of [
    { actorId: 'other' },
    { tasks: [] },
    { targetDate: 'forged' },
    { previewHash: 'forged' },
    { dailyMinutes: 0 },
    { revision: 0 },
    { startDate: '2026-02-30' },
  ])
    assert.throws(() => recoveryInput({ ...input, ...extra }));
  for (const extra of [
    { dailyMinutes: 20 },
    { startDate: '2026-10-03' },
    { startDate: '2028-10-04' },
    { revision: 2 },
  ])
    assert.throws(() => recoverySchedule(plan, { ...input, ...extra }, now()));
  assert.throws(() => recoverySchedule({ ...plan, status: 'PAUSED' }, input, now()));
  assert.throws(() => recoverySchedule({ ...plan, tasks: [plan.tasks[0]] }, input, now()));
});
test('preview performs no write; confirmation recomputes schedule and rejects altered preview, changed plan or revoked permission', async () => {
  let allowed = true,
    current = structuredClone(plan),
    writes = 0;
  const learning: LearningStore = {
    read: async actor => {
      assert.equal(actor, 'owner');
      return { canManage: allowed, plans: [structuredClone(current)] };
    },
    change: async () => {
      throw Error('Use atomic recovery only');
    },
  };
  const service = new LearningRecoveryService(
    learning,
    {
      apply: async (actor, preview) => {
        assert.equal(actor, 'owner');
        assert.equal(preview.tasks.length, 2);
        writes++;
        current.revision++;
      },
    },
    undefined,
    now,
  );
  const preview = await service.preview('owner', input);
  assert.equal(writes, 0);
  await assert.rejects(
    service.apply('owner', { ...input, startDate: '2026-10-06', previewHash: preview.previewHash }),
  );
  assert.equal(writes, 0);
  allowed = false;
  await assert.rejects(service.apply('owner', { ...input, previewHash: preview.previewHash }));
  allowed = true;
  await service.apply('owner', { ...input, previewHash: preview.previewHash });
  assert.equal(writes, 1);
  await assert.rejects(service.apply('owner', { ...input, previewHash: preview.previewHash }));
  assert.equal(writes, 1);
});
test('a preview cannot be replayed after timezone day rollover or for another actor', async () => {
  let clock = now();
  const learning: LearningStore = {
    read: async () => ({ canManage: true, plans: [plan] }),
    change: async () => {
      throw Error('No save');
    },
  };
  const service = new LearningRecoveryService(
    learning,
    {
      apply: async () => {
        throw Error('Must reject');
      },
    },
    undefined,
    () => clock,
  );
  const p = await service.preview('owner', input);
  await assert.rejects(service.apply('other', { ...input, previewHash: p.previewHash }));
  clock = new Date('2026-10-04T20:00:00Z');
  await assert.rejects(service.apply('owner', { ...input, previewHash: p.previewHash }));
});
test('AI recovery advice cannot write and is discarded after permission revocation', async () => {
  let allowed = true;
  const learning: LearningStore = {
      read: async () => ({ canManage: allowed, plans: [plan] }),
      change: async () => {
        throw Error('No saves');
      },
    },
    store = {
      apply: async () => {
        throw Error('Advice must not apply');
      },
    };
  const service = new LearningRecoveryService(
    learning,
    store,
    async (actor, prompt) => {
      assert.equal(actor, 'owner');
      assert.ok(prompt.includes('Keep its order'));
      return { provider: 'test', reply: 'Practice in small steps.' };
    },
    now,
  );
  assert.equal(
    (await service.advice('owner', input, AbortSignal.timeout(1000))).reply,
    'Practice in small steps.',
  );
  const revoked = new LearningRecoveryService(
    learning,
    store,
    async () => {
      allowed = false;
      return { provider: 'test', reply: 'Private advice' };
    },
    now,
  );
  await assert.rejects(revoked.advice('owner', input, AbortSignal.timeout(1000)));
});
test('recovery HTTP binds verified identity, rejects supplied schedules and independently checks management access', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    person = state.people[0];
  person.overrides.push(
    { permission: 'learning.view', scope: 'OWN', effect: 'ALLOW' },
    { permission: 'learning.manage', scope: 'OWN', effect: 'ALLOW' },
  );
  access.snapshot = () => structuredClone(state);
  let writes = 0;
  const learning: LearningStore = {
      read: async actor => {
        assert.equal(actor, person.id);
        return { canManage: true, plans: [plan] };
      },
      change: async () => {
        throw Error('No saves');
      },
    },
    recovery = new LearningRecoveryService(
      learning,
      {
        apply: async () => {
          writes++;
        },
      },
      undefined,
      now,
    );
  const server = createApp({
    verify: async h => {
      if (h !== 'Bearer trusted') throw Error();
      return { tenantId: 't', objectId: 'o' };
    },
    profile: async () => undefined,
    access,
    resolveAccess: async () => person.id,
    learning,
    recovery,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/learning/recovery/`,
    headers = { Authorization: 'Bearer trusted', 'Content-Type': 'application/json' };
  try {
    assert.equal(
      (
        await fetch(base + 'preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(base + 'preview', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...input, tasks: [] }),
        })
      ).status,
      400,
    );
    const response = await fetch(base + 'preview', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(writes, 0);
    person.overrides.push({ permission: 'learning.manage', scope: 'OWN', effect: 'DENY' });
    assert.equal(
      (
        await fetch(base + 'apply', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...input, previewHash: preview.previewHash }),
        })
      ).status,
      403,
    );
    assert.equal(writes, 0);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
