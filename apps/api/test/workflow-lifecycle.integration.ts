import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withRuntimeDatabase, closeRuntimeDatabase } from '../src/shared/database.js';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
import { can, type PermissionCode } from '../src/modules/access/index.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
try {
  const access = new SqlAccessStore(account),
    before = await access.snapshot();
  const admin = before.people.find(
    p => can(before, p, 'permissions.manage') && can(before, p, 'users.manage'),
  );
  assert.ok(admin);
  const people = before.people.filter(
    p => p.active && can(before, p, 'request.create', true) && can(before, p, 'request.view', true),
  );
  assert.ok(people.length >= 3);
  const [owner, receiver, target] = people;
  await withRuntimeDatabase(async pool => {
    const run = (tx: sql.Transaction, mode: string, actor: string, id?: string, payload?: object) =>
      new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, actor)
        .input('mode', sql.VarChar(20), mode)
        .input('record_id', sql.UniqueIdentifier, id ?? null)
        .input('payload', sql.NVarChar(sql.MAX), payload ? JSON.stringify(payload) : null)
        .execute('dbo.WorkflowWorkspace');
    async function grant(tx: sql.Transaction, person: typeof receiver, deny?: PermissionCode) {
      const codes = [
        'request.view',
        'request.create',
        'request.assign',
        'request.resolve',
        'incident.view',
        'incident.create',
        'incident.assign',
        'incident.resolve',
      ] as PermissionCode[];
      const overrides = person.overrides.filter(p => !codes.includes(p.permission));
      for (const permission of codes)
        overrides.push({
          permission,
          scope: 'OWN',
          effect: permission === deny ? 'DENY' : 'ALLOW',
        });
      const state = await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .execute('dbo.ReadAccessWorkspace');
      await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, admin!.id)
        .input(
          'expected_revision',
          sql.Int,
          (state.recordsets as sql.IRecordSet<any>[])[0][0].revision,
        )
        .input('kind', sql.VarChar(10), 'person')
        .input('target_id', sql.UniqueIdentifier, person.id)
        .input('is_new', sql.Bit, false)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify({ ...person, overrides }))
        .execute('dbo.SaveAccessChange');
    }
    const rejects = (promise: Promise<unknown>, n: number) =>
      assert.rejects(promise, e => (e as { number?: number }).number === n);
    async function fixture(
      kind: string,
      check: (tx: sql.Transaction, id: string) => Promise<void>,
    ) {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      const id = randomUUID();
      try {
        await grant(tx, owner);
        await grant(tx, receiver);
        await grant(tx, target);
        await run(tx, 'CREATE', owner.id, id, {
          action: 'CREATE',
          id,
          kind,
          title: 'Rollback lifecycle QA',
          description: 'Synthetic lifecycle fixture',
          priority: 'NORMAL',
          recipientId: receiver.id,
        });
        await check(tx, id);
      } finally {
        await tx.rollback().catch(() => undefined);
      }
    }
    for (const kind of ['REQUEST', 'INCIDENT']) {
      await fixture(kind, async (tx, id) => {
        assert.equal((await run(tx, 'DETAIL', owner.id, id)).recordset[0].canReassign, true);
        assert.ok(
          (await run(tx, 'REASSIGN_OPTIONS', owner.id, id)).recordset.some(
            e => e.id.toLowerCase() === target.id,
          ),
        );
        await run(tx, 'REASSIGN', owner.id, id, {
          action: 'REASSIGN',
          id,
          eventId: randomUUID(),
          revision: 1,
          body: 'Owner selected another recipient',
          recipientId: target.id,
        });
        assert.equal(
          (await run(tx, 'DETAIL', target.id, id)).recordset[0].recipientId.toLowerCase(),
          target.id,
        );
        await rejects(run(tx, 'REASSIGN_OPTIONS', receiver.id, id), 51004);
      });
      await fixture(kind, async (tx, id) => {
        const first = (await run(tx, 'DETAIL', receiver.id, id)).recordset[0];
        assert.equal(first.canStart, true);
        assert.equal(first.canResolve, false);
        const start = {
          action: 'START',
          id,
          eventId: randomUUID(),
          revision: 1,
          body: 'Investigate supplied issue',
        };
        await run(tx, 'START', receiver.id, id, start);
        await run(tx, 'START', receiver.id, id, start);
        const active = (await run(tx, 'DETAIL', receiver.id, id)).recordset[0];
        assert.equal(active.status, 'IN_PROGRESS');
        assert.equal(active.revision, 2);
        assert.equal(active.canResolve, true);
        const resolve = {
          action: 'RESOLVE',
          id,
          eventId: randomUUID(),
          revision: 2,
          body: 'Completed the requested work; fixture only',
        };
        await run(tx, 'RESOLVE', receiver.id, id, resolve);
        await run(tx, 'RESOLVE', receiver.id, id, resolve);
        const done = (await run(tx, 'DETAIL', owner.id, id)).recordset[0];
        assert.equal(done.status, 'RESOLVED');
        assert.equal(done.revision, 3);
        assert.equal(done.canComment, false);
        assert.equal(done.canCancel, false);
        assert.ok(
          (await run(tx, 'NOTIFICATIONS', owner.id)).recordset.some(
            e => e.id.toLowerCase() === resolve.eventId,
          ),
        );
      });
      await fixture(kind, async (tx, id) => {
        await rejects(
          run(tx, 'START', owner.id, id, {
            action: 'START',
            id,
            eventId: randomUUID(),
            revision: 1,
            body: 'Owner cannot start',
          }),
          51003,
        );
      });
      await fixture(kind, async (tx, id) => {
        await rejects(
          run(tx, 'RESOLVE', receiver.id, id, {
            action: 'RESOLVE',
            id,
            eventId: randomUUID(),
            revision: 1,
            body: 'Cannot skip starting work',
          }),
          51009,
        );
      });
      await fixture(kind, async (tx, id) => {
        const options = (await run(tx, 'REASSIGN_OPTIONS', receiver.id, id)).recordset;
        assert.ok(options.some(e => e.id.toLowerCase() === target.id));
        assert.ok(!options.some(e => [owner.id, receiver.id].includes(e.id.toLowerCase())));
        await run(tx, 'REASSIGN', receiver.id, id, {
          action: 'REASSIGN',
          id,
          eventId: randomUUID(),
          revision: 1,
          body: 'Please handle in your department',
          recipientId: target.id,
        });
        const handoff = await run(tx, 'DETAIL', target.id, id);
        assert.equal(handoff.recordset[0].recipientId.toLowerCase(), target.id);
        assert.equal(handoff.recordset[0].status, 'SUBMITTED');
        assert.ok(
          (handoff.recordsets as sql.IRecordSet<any>[])[1][1].body.includes(target.displayName),
        );
        assert.equal((await run(tx, 'DETAIL', owner.id, id)).recordset[0].revision, 2);
        await rejects(run(tx, 'DETAIL', receiver.id, id), 51004);
      });
      await fixture(kind, async (tx, id) => {
        await grant(tx, receiver, kind === 'REQUEST' ? 'request.assign' : 'incident.assign');
        await rejects(
          run(tx, 'START', receiver.id, id, {
            action: 'START',
            id,
            eventId: randomUUID(),
            revision: 1,
            body: 'Revoked assign',
          }),
          51003,
        );
      });
      await fixture(kind, async (tx, id) => {
        await run(tx, 'START', receiver.id, id, {
          action: 'START',
          id,
          eventId: randomUUID(),
          revision: 1,
          body: 'Start',
        });
        await grant(tx, receiver, kind === 'REQUEST' ? 'request.resolve' : 'incident.resolve');
        await rejects(
          run(tx, 'RESOLVE', receiver.id, id, {
            action: 'RESOLVE',
            id,
            eventId: randomUUID(),
            revision: 2,
            body: 'Revoked resolve',
          }),
          51003,
        );
      });
      await fixture(kind, async (tx, id) => {
        const payload = { action: 'START', id, eventId: randomUUID(), revision: 1, body: 'Start' };
        await run(tx, 'START', receiver.id, id, payload);
        await rejects(
          run(tx, 'START', receiver.id, id, { ...payload, body: 'Changed replay' }),
          51009,
        );
      });
      await fixture(kind, async (tx, id) => {
        await run(tx, 'START', receiver.id, id, {
          action: 'START',
          id,
          eventId: randomUUID(),
          revision: 1,
          body: 'Start',
        });
        await rejects(
          run(tx, 'REASSIGN', receiver.id, id, {
            action: 'REASSIGN',
            id,
            eventId: randomUUID(),
            revision: 1,
            body: 'Stale handoff',
            recipientId: target.id,
          }),
          51009,
        );
      });
    }
  });
  assert.equal((await access.snapshot()).revision, before.revision);
  console.log(
    'Lifecycle SQL checks passed for requests and incidents: recipient-only authority, start/resolve, idempotent retries, reassignment isolation, notifications, revocation and stale revisions. All fixtures rolled back.',
  );
} finally {
  await closeRuntimeDatabase();
}
