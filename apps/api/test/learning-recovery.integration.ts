import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withRuntimeDatabase, closeRuntimeDatabase } from '../src/shared/database.js';
import { can } from '../src/modules/access/index.js';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
const day = new Date().toISOString().slice(0, 10),
  shift = (n: number) => {
    const d = new Date(day + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
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
      action: (tx: sql.Transaction, p: string, ids: string[]) => Promise<void>,
    ) => {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      const p = randomUUID(),
        ids = [randomUUID(), randomUUID(), randomUUID()];
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
              title: 'Rollback recovery QA',
              goal: 'Synthetic recovery checks',
              timezone: 'Asia/Kolkata',
              dailyMinutes: 60,
              targetDate: shift(2),
              tasks: ids.map((id, i) => ({
                id,
                title: 'Task ' + i,
                estimatedMinutes: 30,
                plannedDate: i === 2 ? shift(2) : shift(-1),
              })),
            }),
          )
          .execute('dbo.ChangeOwnLearningPlan');
        await new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, owner.id)
          .input('plan_id', sql.UniqueIdentifier, p)
          .input('expected_revision', sql.Int, 1)
          .input('action', sql.VarChar(20), 'LOG')
          .input(
            'payload',
            sql.NVarChar(sql.MAX),
            JSON.stringify({
              action: 'LOG',
              id: p,
              revision: 1,
              taskId: ids[0],
              actualMinutes: 20,
              notes: 'Keep completed notes',
            }),
          )
          .execute('dbo.ChangeOwnLearningPlan');
        await action(tx, p, ids);
      } finally {
        await tx.rollback().catch(() => undefined);
      }
    };
    const run = (tx: sql.Transaction, p: string, payload: object, actor = owner.id, revision = 2) =>
      new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, actor)
        .input('plan_id', sql.UniqueIdentifier, p)
        .input('expected_revision', sql.Int, revision)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
        .execute('dbo.RecoverOwnLearningPlan');
    const payload = (ids: string[]) => ({
      dailyMinutes: 60,
      startDate: day,
      targetDate: day,
      tasks: ids.slice(1).map(id => ({ id, plannedDate: day })),
    });
    const read = async (tx: sql.Transaction, p: string) => {
      const result = await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, owner.id)
        .execute('dbo.ReadOwnLearningPlans');
      const row = (
        result.recordsets as sql.IRecordSet<{ id: string; revision: number; payload: string }>[]
      )[1].find(r => r.id.toLowerCase() === p);
      assert.ok(row);
      return { revision: row.revision, data: JSON.parse(row.payload) };
    };
    const practice = (
      tx: sql.Transaction,
      p: string,
      t: string,
      action: string,
      data: object = {},
    ) =>
      new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, owner.id)
        .input('plan_id', sql.UniqueIdentifier, p)
        .input('task_id', sql.UniqueIdentifier, t)
        .input('action', sql.VarChar(20), action)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(data))
        .execute('dbo.OwnLearningPractice');
    await fixture(async (tx, p, ids) => {
      const original = await read(tx, p),
        quiz = randomUUID(),
        attempt = randomUUID();
      await practice(tx, p, ids[1], 'SESSION', {
        revision: 0,
        notes: 'Retain pending study draft',
        minutes: 17,
        resources: [{ label: 'Docs', url: 'https://example.com/docs' }],
      });
      await practice(tx, p, ids[1], 'QUIZ', {
        id: quiz,
        title: 'Practice',
        provider: 'test',
        questions: [
          {
            prompt: 'Which stores objects?',
            options: ['Blob', 'Queue', 'DNS', 'Identity'],
            correctIndex: 0,
            explanation: 'Blob stores objects.',
          },
        ],
      });
      await practice(tx, p, ids[1], 'ATTEMPT', { id: attempt, quizId: quiz, answers: [0] });
      const prior = (await practice(tx, p, ids[1], 'READ')).recordsets;
      await run(tx, p, payload(ids));
      const after = await read(tx, p);
      assert.equal(after.revision, 3);
      assert.equal(after.data.dailyMinutes, 60);
      assert.equal(after.data.targetDate, day);
      assert.deepEqual(after.data.tasks[0], original.data.tasks[0]);
      assert.deepEqual(
        after.data.tasks.map((t: { id: string }) => t.id),
        ids,
      );
      for (const t of after.data.tasks.slice(1)) assert.equal(t.plannedDate, day);
      assert.deepEqual((await practice(tx, p, ids[1], 'READ')).recordsets, prior);
    });
    await fixture(async (tx, p, ids) => {
      await assert.rejects(
        run(tx, p, payload(ids), other.id),
        e => (e as { number: number }).number === 51004,
      );
    });
    await fixture(async (tx, p, ids) => {
      await assert.rejects(
        run(tx, p, payload(ids), owner.id, 1),
        e => (e as { number: number }).number === 51009,
      );
    });
    for (const mutate of [
      (v: ReturnType<typeof payload>) => ({ ...v, dailyMinutes: 30 }),
      (v: ReturnType<typeof payload>) => ({ ...v, tasks: v.tasks.slice(0, 1) }),
      (v: ReturnType<typeof payload>) => ({ ...v, tasks: [...v.tasks, v.tasks[0]] }),
      (v: ReturnType<typeof payload>) => ({ ...v, targetDate: shift(1) }),
      (v: ReturnType<typeof payload>) => ({ ...v, ownerId: other.id }),
      (v: ReturnType<typeof payload>) => ({
        ...v,
        tasks: v.tasks.map(t => ({ ...t, minutes: 1 })),
      }),
    ])
      await fixture(async (tx, p, ids) => {
        await assert.rejects(
          run(tx, p, mutate(payload(ids))),
          e => (e as { number: number }).number === 51000,
        );
      });
    await fixture(async (tx, p, ids) => {
      await assert.rejects(
        run(tx, p, {
          ...payload(ids),
          tasks: [...payload(ids).tasks, { id: ids[0], plannedDate: day }],
        }),
        e => (e as { number: number }).number === 51000,
      );
    });
    await assert.rejects(
      pool.request().query('SELECT TOP 1 * FROM dbo.LearningPlan'),
      e => (e as { number: number }).number === 229,
    );
  });
  assert.equal((await access.snapshot()).revision, before.revision);
  console.log(
    'Learning recovery SQL: atomic owner-only scheduling, CAS, capacity, exact pending coverage, completed records and session/quiz/attempt retention verified. All fixtures rolled back.',
  );
} finally {
  await closeRuntimeDatabase();
}
