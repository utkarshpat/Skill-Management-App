import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withRuntimeDatabase, closeRuntimeDatabase } from '../src/shared/database.js';
import { can } from '../src/modules/access/index.js';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
try {
  const access = new SqlAccessStore(account),
    before = await access.snapshot(),
    people = before.people.filter(
      p =>
        p.active &&
        can(before, p, 'learning.view', true) &&
        can(before, p, 'learning.manage', true),
    );
  assert.ok(people.length >= 2);
  const [owner, other] = people;
  await withRuntimeDatabase(async pool => {
    const fixture = async (
      action: (tx: sql.Transaction, p: string, t: string) => Promise<void>,
    ) => {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      const p = randomUUID(),
        t = randomUUID();
      try {
        await new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, owner.id)
          .input('plan_id', sql.UniqueIdentifier, p)
          .input('expected_revision', sql.Int, 0)
          .input('action', sql.VarChar(20), 'CREATE')
          .input(
            'payload',
            sql.NVarChar(sql.MAX),
            JSON.stringify({
              action: 'CREATE',
              id: p,
              revision: 0,
              title: 'Rollback practice QA',
              goal: 'Synthetic isolation checks',
              timezone: 'Asia/Kolkata',
              dailyMinutes: 30,
              targetDate: '2026-10-10',
              tasks: [
                {
                  id: t,
                  title: 'Practice storage',
                  plannedDate: '2026-10-04',
                  estimatedMinutes: 30,
                },
              ],
            }),
          )
          .execute('dbo.ChangeOwnLearningPlan');
        await action(tx, p, t);
      } finally {
        await tx.rollback().catch(() => undefined);
      }
    };
    const run = (
      tx: sql.Transaction,
      p: string,
      t: string,
      action: string,
      payload: object = {},
      actor = owner.id,
    ) =>
      new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, actor)
        .input('plan_id', sql.UniqueIdentifier, p)
        .input('task_id', sql.UniqueIdentifier, t)
        .input('action', sql.VarChar(20), action)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
        .execute('dbo.OwnLearningPractice');
    const quiz = (id: string) => ({
      id,
      title: 'Synthetic storage practice',
      provider: 'test',
      questions: [
        {
          prompt: 'Which stores objects?',
          options: ['Blob', 'Queue', 'DNS', 'Identity'],
          correctIndex: 0,
          explanation: 'Blob stores objects.',
        },
        {
          prompt: 'Which stores messages?',
          options: ['Blob', 'Queue', 'DNS', 'Identity'],
          correctIndex: 1,
          explanation: 'Queues hold messages.',
        },
      ],
    });
    await fixture(async (tx, p, t) => {
      await run(tx, p, t, 'SESSION', {
        revision: 0,
        notes: 'Draft note',
        minutes: 15,
        resources: [{ label: 'Docs', url: 'https://example.com/docs' }],
      });
      await run(tx, p, t, 'SESSION', {
        revision: 1,
        notes: 'Saved twice',
        minutes: 20,
        resources: [],
      });
      const id = randomUUID(),
        a = randomUUID();
      await run(tx, p, t, 'QUIZ', quiz(id));
      await run(tx, p, t, 'ATTEMPT', { id: a, quizId: id, answers: [0, 0] });
      await run(tx, p, t, 'ATTEMPT', { id: a, quizId: id, answers: [0, 0] });
      const sets = (await run(tx, p, t, 'READ')).recordsets as sql.IRecordSet<
        Record<string, unknown>
      >[];
      assert.equal(sets[0][0].revision, 2);
      assert.equal(sets[2].length, 1);
      assert.equal(sets[2][0].score, 1);
      assert.equal(sets[2][0].total, 2);
      assert.ok(sets[2][0].submittedAt);
      const plans = await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, owner.id)
        .execute('dbo.ReadOwnLearningPlans');
      const row = (plans.recordsets as sql.IRecordSet<{ id: string; payload: string }>[])[1].find(
        r => r.id.toLowerCase() === p,
      );
      assert.ok(row);
      assert.equal(JSON.parse(row.payload).tasks[0].completedAt, undefined);
    });
    await fixture(async (tx, p, t) => {
      await assert.rejects(
        run(tx, p, t, 'READ', {}, other.id),
        e => (e as { number: number }).number === 51004,
      );
    });
    await fixture(async (tx, p, t) => {
      await run(tx, p, t, 'SESSION', { revision: 0, notes: '', minutes: 0, resources: [] });
      await assert.rejects(
        run(tx, p, t, 'SESSION', { revision: 0, notes: 'stale', minutes: 0, resources: [] }),
        e => (e as { number: number }).number === 51009,
      );
    });
    for (const extra of [
      { score: 100 },
      { answers: [0] },
      { answers: ['0', 1] },
      { answers: [0, 1.2] },
    ])
      await fixture(async (tx, p, t) => {
        const id = randomUUID();
        await run(tx, p, t, 'QUIZ', quiz(id));
        await assert.rejects(
          run(tx, p, t, 'ATTEMPT', { id: randomUUID(), quizId: id, answers: [0, 1], ...extra }),
          e => (e as { number: number }).number === 51000,
        );
      });
    for (const table of ['LearningQuiz', 'LearningAttempt', 'LearningSession'])
      await assert.rejects(
        pool.request().query('SELECT TOP 1 * FROM dbo.' + table),
        e => (e as { number: number }).number === 229,
      );
  });
  assert.equal((await access.snapshot()).revision, before.revision);
  console.log(
    'Learning practice SQL: owner isolation, server grading/timestamps, idempotency, session CAS, provenance and table denial verified. All fixtures rolled back.',
  );
} finally {
  await closeRuntimeDatabase();
}
