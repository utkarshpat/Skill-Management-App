import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withDatabase, withRuntimeDatabase, closeRuntimeDatabase } from '../src/shared/database.js';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
import { SqlCatalogueStore } from '../src/modules/skills/sql-store.js';
import { can } from '../src/modules/access/index.js';
import { recommendationAccess } from '../src/modules/recommendations/index.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
try {
  const access = new SqlAccessStore(account),
    before = await access.snapshot();
  const manager = before.people.find(
    p =>
      p.active &&
      before.reporting?.some(
        e =>
          e.managerId === p.id &&
          before.people.some(
            t =>
              t.id === e.personId &&
              recommendationAccess(before, p, t.id).allowed &&
              can(before, t, 'learning.manage', true),
          ),
      ),
  );
  assert.ok(manager, 'Need an eligible manager');
  const employee = before.people.find(
    p =>
      p.active &&
      recommendationAccess(before, manager, p.id).allowed &&
      can(before, p, 'learning.manage', true),
  );
  assert.ok(employee);
  const stranger = before.people.find(p => p.active && p.id !== employee.id && p.id !== manager.id);
  assert.ok(stranger);
  const catalogue = await new SqlCatalogueStore(account).read(manager.id, {
    status: 'PUBLISHED',
    search: '',
    page: 1,
  });
  const skill = catalogue.skills[0];
  assert.ok(skill);
  const run = (tx: sql.Transaction, actor: string, action: string, payload: object) =>
    new sql.Request(tx)
      .input('account_id', sql.UniqueIdentifier, account)
      .input('actor_id', sql.UniqueIdentifier, actor)
      .input('action', sql.VarChar(20), action)
      .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
      .execute('dbo.LearningRecommendations');
  const payload = (id: string) => ({
    id,
    personId: employee.id,
    skillId: skill.id,
    rank: skill.levels[0].rank,
    reason: 'Rollback-only recommendation QA',
    resource: 'https://example.org/learning',
  });
  const plan = () => ({
    action: 'CREATE',
    id: randomUUID(),
    revision: 0,
    title: 'Rollback-only development plan',
    goal: 'Practice skill without verification',
    timezone: 'Asia/Kolkata',
    dailyMinutes: 30,
    targetDate: '2026-10-10',
    skillId: skill.id,
    tasks: [
      {
        id: randomUUID(),
        title: 'Practice skill',
        plannedDate: '2026-10-10',
        estimatedMinutes: 30,
      },
    ],
  });
  await withRuntimeDatabase(async pool => {
    async function fixture(action: (tx: sql.Transaction, id: string) => Promise<void>) {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await action(tx, randomUUID());
      } finally {
        await tx.rollback().catch(() => undefined);
      }
    }
    await fixture(async (tx, id) => {
      const choices = await run(tx, manager.id, 'OPTIONS', { search: '' });
      assert.ok(choices.recordset.some(p => p.id.toLowerCase() === employee.id));
      const filtered = await run(tx, manager.id, 'OPTIONS', { search: employee.employeeCode });
      assert.equal(filtered.recordset.length, 1);
      assert.equal(filtered.recordset[0].id.toLowerCase(), employee.id);
      await run(tx, manager.id, 'SEND', payload(id));
      const received = await run(tx, employee.id, 'LIST', { view: 'received', id });
      const row = (received.recordsets as sql.IRecordSet<Record<string, unknown>>[])[1][0];
      assert.equal(row.skillName, skill.name);
      assert.equal(row.canRespond, true);
      const hidden = await run(tx, stranger.id, 'LIST', { view: 'received', id });
      assert.equal((hidden.recordsets as sql.IRecordSet<unknown>[])[1].length, 0);
      const notifications = await run(tx, employee.id, 'NOTIFICATIONS', {});
      assert.ok(notifications.recordset.some(n => n.href.toLowerCase().includes(id)));
      await run(tx, employee.id, 'DISCUSS', {
        id,
        revision: 1,
        action: 'DISCUSS',
        message: 'Discuss the goal first',
      });
      const proposed = plan();
      await run(tx, employee.id, 'ACCEPT', {
        id,
        revision: 2,
        action: 'ACCEPT',
        message: 'Agreed',
        plan: proposed,
      });
      const accepted = await run(tx, employee.id, 'LIST', { view: 'received', id });
      assert.equal(
        (accepted.recordsets as sql.IRecordSet<Record<string, unknown>>[])[1][0].status,
        'ACCEPTED',
      );
      const own = await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, employee.id)
        .execute('dbo.ReadOwnLearningPlans');
      assert.ok(
        (own.recordsets as sql.IRecordSet<{ id: string }>[])[1].some(
          p => p.id.toLowerCase() === proposed.id,
        ),
      );
    });
    for (const [number, attempt] of [
      [
        51003,
        (tx: sql.Transaction, id: string) =>
          run(tx, manager.id, 'SEND', { ...payload(id), personId: manager.id }),
      ],
      [51003, (tx: sql.Transaction, id: string) => run(tx, stranger.id, 'SEND', payload(id))],
      [
        51004,
        (tx: sql.Transaction, id: string) =>
          run(tx, employee.id, 'ACCEPT', {
            id,
            revision: 1,
            action: 'ACCEPT',
            message: '',
            plan: plan(),
          }),
      ],
      [
        51009,
        async (tx: sql.Transaction, id: string) => {
          await run(tx, manager.id, 'SEND', payload(id));
          await run(tx, employee.id, 'DECLINE', {
            id,
            revision: 2,
            action: 'DECLINE',
            message: '',
          });
        },
      ],
      [
        51009,
        async (tx: sql.Transaction, id: string) => {
          await run(tx, manager.id, 'SEND', payload(id));
          await run(tx, employee.id, 'ACCEPT', {
            id,
            revision: 1,
            action: 'ACCEPT',
            message: '',
            plan: plan(),
          });
          await run(tx, employee.id, 'ACCEPT', {
            id,
            revision: 1,
            action: 'ACCEPT',
            message: '',
            plan: plan(),
          });
        },
      ],
      [
        51000,
        async (tx: sql.Transaction, id: string) => {
          await run(tx, manager.id, 'SEND', payload(id));
          await run(tx, employee.id, 'ACCEPT', {
            id,
            revision: 1,
            action: 'ACCEPT',
            message: '',
            plan: { ...plan(), skillId: randomUUID() },
          });
        },
      ],
      [
        51000,
        (tx: sql.Transaction, id: string) =>
          run(tx, manager.id, 'SEND', { ...payload(id), ownerId: stranger.id }),
      ],
    ] as const)
      await fixture(async (tx, id) => {
        await assert.rejects(attempt(tx, id), e => (e as { number: number }).number === number);
      });
    await fixture(async (tx, id) => {
      await run(tx, manager.id, 'SEND', payload(id));
      await run(tx, employee.id, 'DECLINE', {
        id,
        revision: 1,
        action: 'DECLINE',
        message: 'Later',
      });
      const feed = await run(tx, employee.id, 'LIST', { view: 'received', id });
      assert.equal(
        (feed.recordsets as sql.IRecordSet<Record<string, unknown>>[])[1][0].planId,
        null,
      );
    });
    await assert.rejects(
      pool.request().query('SELECT TOP(1) * FROM dbo.LearningRecommendation'),
      e => (e as { number: number }).number === 229,
    );
  });
  // Access changes stay in rollback-only administrator fixtures; the procedure rechecks live rows.
  await withDatabase(async pool => {
    for (const mode of ['deny', 'reassign', 'inactive', 'revoke-learning']) {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const id = randomUUID();
        await run(tx, manager.id, 'SEND', payload(id));
        const q = new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .input('sender', sql.UniqueIdentifier, manager.id)
          .input('recipient', sql.UniqueIdentifier, employee.id)
          .input('other', sql.UniqueIdentifier, stranger.id);
        if (mode === 'deny')
          await q.query(
            "DELETE dbo.AccessPersonOverride WHERE account_id=@a AND person_id=@sender AND permission_code='learning.recommend'; INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until) VALUES(@a,@sender,'learning.recommend','ORGANIZATION','DENY',N'Rollback deny test',DATEADD(day,1,SYSUTCDATETIME()))",
          );
        if (mode === 'reassign')
          await q.query(
            'UPDATE dbo.AccessOrgAssignment SET manager_id=@other WHERE account_id=@a AND person_id=@recipient',
          );
        if (mode === 'inactive')
          await q.query(
            'UPDATE dbo.AccessPerson SET active=0 WHERE account_id=@a AND person_id=@sender',
          );
        if (mode === 'revoke-learning')
          await q.query(
            "DELETE dbo.AccessPersonOverride WHERE account_id=@a AND person_id=@recipient AND permission_code='learning.manage'; INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until) VALUES(@a,@recipient,'learning.manage','OWN','DENY',N'Rollback learning deny',DATEADD(day,1,SYSUTCDATETIME()))",
          );
        await assert.rejects(
          run(tx, employee.id, 'ACCEPT', {
            id,
            revision: 1,
            action: 'ACCEPT',
            message: '',
            plan: plan(),
          }),
          e => (e as { number: number }).number === 51003,
        );
      } finally {
        await tx.rollback().catch(() => undefined);
      }
    }
  });
  assert.equal((await access.snapshot()).revision, before.revision);
  console.log(
    'Recommendations SQL passed: runtime isolation, own responses, notification links, discussion, atomic acceptance, duplicate/stale revisions, explicit deny, reassignment, inactive sender and learning revocation. All fixtures rolled back.',
  );
} finally {
  await closeRuntimeDatabase();
}
