import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { ToolRegistry } from '../src/modules/ai/tool-registry.js';
import type { LearningStore } from '../src/modules/learning/index.js';
test('exact learning task retrieval binds current actor, rejects foreign IDs and discards revoked access', async () => {
  const access = await LocalAccessStore.open(),
    s = access.snapshot(),
    actor = s.people[0];
  actor.overrides.push({ permission: 'learning.view', scope: 'OWN', effect: 'ALLOW' });
  access.snapshot = () => structuredClone(s);
  const planId = 'aa123456-1234-1234-1234-123456789abc',
    taskId = 'bb123456-1234-1234-1234-123456789abc';
  let calls = 0,
    revoke = false;
  const learning: LearningStore = {
    read: async who => {
      assert.equal(who, actor.id);
      calls++;
      if (revoke)
        actor.overrides.push({ permission: 'learning.view', scope: 'OWN', effect: 'DENY' });
      return {
        canManage: true,
        plans: [
          {
            id: planId,
            title: 'Saved goal',
            goal: 'Learn',
            revision: 1,
            status: 'ACTIVE',
            timezone: 'Asia/Calcutta',
            dailyMinutes: 30,
            targetDate: '2026-10-04',
            tasks: [
              {
                id: taskId,
                title: 'Same task title',
                plannedDate: '2026-10-04',
                estimatedMinutes: 30,
                notes: 'Private session notes are not needed',
              },
            ],
          },
        ],
      };
    },
    change: async () => {
      throw Error('Read only');
    },
  };
  const registry = new ToolRegistry(access, undefined, undefined, undefined, learning),
    signal = AbortSignal.timeout(5000);
  for (const args of [
    { planId, taskId, actorId: 'foreign' },
    { planId, taskId: 'bad' },
  ])
    await assert.rejects(registry.execute(actor.id, 'my_learning_task', args, signal));
  assert.equal(calls, 0);
  const result = await registry.execute(actor.id, 'my_learning_task', { planId, taskId }, signal);
  assert.match(JSON.stringify(result.data), /Saved goal/);
  assert.doesNotMatch(JSON.stringify(result.data), /Private session notes/);
  await assert.rejects(
    registry.execute(
      actor.id,
      'my_learning_task',
      { planId, taskId: 'cc123456-1234-1234-1234-123456789abc' },
      signal,
    ),
    /unavailable/,
  );
  revoke = true;
  await assert.rejects(
    registry.execute(actor.id, 'my_learning_task', { planId, taskId }, signal),
    /permission/,
  );
  const before = calls;
  await assert.rejects(registry.execute(actor.id, 'my_learning_task', { planId, taskId }, signal));
  assert.equal(calls, before);
});
