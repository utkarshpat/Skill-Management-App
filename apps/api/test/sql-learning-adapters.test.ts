import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlAdapterFixture } from './sql-adapter-fixture.js';
import { SqlLearningStore } from '../src/modules/learning/sql-store.js';
import { SqlPracticeStore } from '../src/modules/learning/sql-practice-store.js';
import { SqlRecoveryStore } from '../src/modules/learning/sql-recovery-store.js';
import type { RecoveryPreview } from '../src/modules/learning/recovery.js';
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  plan = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  task = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('learning adapter preserves published plan data and parameterizes revision-bound changes', async () => {
  const f = sqlAdapterFixture();
  try {
    const store = new SqlLearningStore(account);
    const payload = {
      title: 'Customer reporting SQL',
      goal: 'Improve window function queries',
      timezone: 'Asia/Kolkata',
      dailyMinutes: 40,
      targetDate: '2026-11-20',
      tasks: [],
    };
    f.reply(
      'dbo.ReadOwnLearningPlans',
      [{ canManage: true }],
      [
        { id: plan.toUpperCase(), revision: 4, status: 'ACTIVE', payload: JSON.stringify(payload) },
        {
          id: task,
          revision: 1,
          status: 'PAUSED',
          payload: JSON.stringify({ ...payload, focus: 'Skill', skillId: task, skillName: 'SQL' }),
        },
      ],
    );
    const result = await store.read(actor);
    assert.equal(result.plans[0].id, plan);
    assert.equal(result.plans[0].focus, 'General');
    assert.equal(result.plans[1].skillName, 'SQL');
    f.reply('dbo.ChangeOwnLearningPlan');
    await store.change(actor, { action: 'PAUSE', id: plan, revision: 4 });
    assert.deepEqual(f.calls.at(-1)?.inputs, {
      account_id: account,
      actor_id: actor,
      plan_id: plan,
      expected_revision: 4,
      action: 'PAUSE',
      payload: JSON.stringify({ action: 'PAUSE', id: plan, revision: 4 }),
    });
    for (const [number, status] of [
      [51003, 403],
      [51004, 404],
      [51009, 409],
      [2601, 409],
      [2627, 409],
      [51000, 400],
      [51010, 400],
    ]) {
      f.reject('dbo.ReadOwnLearningPlans', { number });
      await assert.rejects(store.read(actor), { status });
      f.reject('dbo.ChangeOwnLearningPlan', { number });
      await assert.rejects(store.change(actor, { action: 'PAUSE', id: plan, revision: 4 }), {
        status,
      });
    }
    const offline = new Error('driver disconnected');
    f.reject('dbo.ReadOwnLearningPlans', offline);
    await assert.rejects(store.read(actor), e => e === offline);
  } finally {
    await f.finish();
  }
});

test('practice adapter reconstructs saved sessions, quiz questions and attempt scores without leaking SQL identity', async () => {
  const f = sqlAdapterFixture();
  try {
    const store = new SqlPracticeStore(account);
    f.reply('dbo.OwnLearningPractice', [], [], []);
    assert.deepEqual(await store.read(actor, plan, task), {
      session: { revision: 0, notes: '', minutes: 0, resources: [] },
      quizzes: [],
      attempts: [],
    });
    f.reply(
      'dbo.OwnLearningPractice',
      [
        {
          revision: 2,
          payload: JSON.stringify({
            notes: 'Partitioned monthly customer totals',
            minutes: 40,
            resources: [],
          }),
        },
      ],
      [
        {
          id: plan.toUpperCase(),
          title: 'Window functions',
          provider: 'azure',
          createdAt: '2026-11-04T10:00:00Z',
          questions: '[{"prompt":"Partition or group?"}]',
        },
      ],
      [
        {
          id: task.toUpperCase(),
          quizId: plan.toUpperCase(),
          answers: '[1]',
          score: 1,
          total: 1,
          submittedAt: '2026-11-04T11:00:00Z',
        },
      ],
    );
    const data = await store.read(actor, plan, task);
    assert.equal(data.session.revision, 2);
    assert.equal(data.quizzes[0].id, plan);
    assert.equal(data.attempts[0].quizId, plan);
    assert.deepEqual(data.attempts[0].answers, [1]);
    assert.equal(data.attempts[0].score, 1);
    f.reply('dbo.OwnLearningPractice');
    await store.write(actor, plan, task, 'SESSION', { revision: 2, notes: 'Reviewed' });
    assert.deepEqual(f.calls.at(-1)?.inputs, {
      account_id: account,
      actor_id: actor,
      plan_id: plan,
      task_id: task,
      action: 'SESSION',
      payload: '{"revision":2,"notes":"Reviewed"}',
    });
    for (const [number, status] of [
      [51003, 403],
      [51004, 404],
      [51009, 409],
      [2601, 409],
      [2627, 409],
      [51000, 400],
      [51010, 400],
    ]) {
      f.reject('dbo.OwnLearningPractice', { number });
      await assert.rejects(store.read(actor, plan, task), { status });
    }
    const error = new Error('offline');
    f.reject('dbo.OwnLearningPractice', error);
    await assert.rejects(store.read(actor, plan, task), e => e === error);
  } finally {
    await f.finish();
  }
});

test('recovery adapter writes only the reviewed schedule and translates denied or stale previews', async () => {
  const f = sqlAdapterFixture();
  try {
    const store = new SqlRecoveryStore(account),
      preview = {
        planId: plan,
        revision: 4,
        dailyMinutes: 40,
        targetDate: '2026-11-20',
        startDate: '2026-11-05',
        tasks: [{ id: task, newDate: '2026-11-06', title: 'Practise window functions' }],
      } as RecoveryPreview;
    f.reply('dbo.RecoverOwnLearningPlan');
    await store.apply(actor, preview);
    assert.deepEqual(f.calls[0].inputs, {
      account_id: account,
      actor_id: actor,
      plan_id: plan,
      expected_revision: 4,
      payload: JSON.stringify({
        dailyMinutes: 40,
        targetDate: '2026-11-20',
        startDate: '2026-11-05',
        tasks: [{ id: task, plannedDate: '2026-11-06' }],
      }),
    });
    for (const [number, status] of [
      [51003, 403],
      [51004, 404],
      [51009, 409],
      [51000, 400],
      [51010, 400],
    ]) {
      f.reject('dbo.RecoverOwnLearningPlan', { number });
      await assert.rejects(store.apply(actor, preview), { status });
    }
    const error = new Error('offline');
    f.reject('dbo.RecoverOwnLearningPlan', error);
    await assert.rejects(store.apply(actor, preview), e => e === error);
  } finally {
    await f.finish();
  }
});
