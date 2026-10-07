import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withRuntimeDatabase, closeRuntimeDatabase } from '../src/shared/database.js';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
import { can, type LocalPerson } from '../src/modules/access/index.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
try {
  const access = new SqlAccessStore(account),
    before = await access.snapshot();
  const admin = before.people.find(
    p => can(before, p, 'permissions.manage') && can(before, p, 'users.manage'),
  );
  assert.ok(admin);
  const owners = before.people.filter(
    p => p.active && can(before, p, 'request.create', true) && can(before, p, 'request.view', true),
  );
  assert.ok(owners.length >= 3);
  const [owner, recipient, other] = owners;
  await withRuntimeDatabase(async pool => {
    async function permissions(tx: sql.Transaction, p: LocalPerson, deny = false) {
      const state = await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .execute('dbo.ReadAccessWorkspace');
      const overrides = p.overrides.filter(
        x =>
          !(
            ['request.view', 'request.assign', 'incident.view', 'incident.assign'].includes(
              x.permission,
            ) && x.scope === 'ORGANIZATION'
          ),
      );
      for (const permission of [
        'request.view',
        'request.assign',
        'incident.view',
        'incident.assign',
      ] as const)
        overrides.push({ permission, scope: 'ORGANIZATION', effect: deny ? 'DENY' : 'ALLOW' });
      await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, admin!.id)
        .input(
          'expected_revision',
          sql.Int,
          (state.recordsets as sql.IRecordSet<any>[])[0][0].revision,
        )
        .input('kind', sql.VarChar(10), 'person')
        .input('target_id', sql.UniqueIdentifier, p.id)
        .input('is_new', sql.Bit, false)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify({ ...p, overrides }))
        .execute('dbo.SaveAccessChange');
    }
    const run = (
      tx: sql.Transaction,
      mode: string,
      actor = owner.id,
      id?: string,
      payload?: object,
      inbox = false,
    ) =>
      new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, actor)
        .input('mode', sql.VarChar(20), mode)
        .input('record_id', sql.UniqueIdentifier, id ?? null)
        .input('page', sql.Int, 1)
        .input('inbox', sql.Bit, inbox)
        .input('payload', sql.NVarChar(sql.MAX), payload ? JSON.stringify(payload) : null)
        .execute('dbo.WorkflowWorkspace');
    async function fixture(
      action: (tx: sql.Transaction, id: string, body: object) => Promise<void>,
      kind = 'REQUEST',
    ) {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      const id = randomUUID(),
        body = {
          action: 'CREATE',
          id,
          kind,
          title: 'Rollback workflow QA',
          description: 'Synthetic business request',
          priority: 'NORMAL',
          recipientId: recipient.id,
        };
      try {
        await permissions(tx, recipient);
        await action(tx, id, body);
      } finally {
        await tx.rollback().catch(() => undefined);
      }
    }
    const rejects = (p: Promise<unknown>, n: number) =>
      assert.rejects(p, e => (e as { number?: number }).number === n);
    await fixture(async (tx, id, body) => {
      const opts = await run(tx, 'OPTIONS');
      assert.ok(
        (opts.recordsets as sql.IRecordSet<any>[])[1].some(
          (r: { id: string }) => r.id.toLowerCase() === recipient.id,
        ),
      );
      await run(tx, 'CREATE', owner.id, id, body);
      await run(tx, 'CREATE', owner.id, id, body);
      const read = await run(tx, 'DETAIL', owner.id, id);
      assert.equal((read.recordsets as sql.IRecordSet<any>[])[0][0].revision, 1);
      assert.equal((read.recordsets as sql.IRecordSet<any>[])[1].length, 1);
      const inbox = await run(tx, 'LIST', recipient.id, undefined, undefined, true);
      assert.ok(
        (inbox.recordsets as sql.IRecordSet<any>[])[1].some(
          (r: { id: string }) => r.id.toLowerCase() === id,
        ),
      );
      const comment = {
        action: 'COMMENT',
        id,
        eventId: randomUUID(),
        revision: 1,
        body: 'Recipient update',
      };
      await run(tx, 'COMMENT', recipient.id, id, comment);
      await run(tx, 'COMMENT', recipient.id, id, comment);
      const feed = await run(tx, 'NOTIFICATIONS', owner.id);
      assert.ok(feed.recordset.some((r: { id: string }) => r.id.toLowerCase() === comment.eventId));
      const cancellation = {
        action: 'CANCEL',
        id,
        eventId: randomUUID(),
        revision: 2,
        body: 'No longer needed',
      };
      await run(tx, 'CANCEL', owner.id, id, cancellation);
      await run(tx, 'CANCEL', owner.id, id, cancellation);
      const done = await run(tx, 'DETAIL', owner.id, id);
      assert.equal((done.recordsets as sql.IRecordSet<any>[])[0][0].status, 'CANCELLED');
      assert.equal((done.recordsets as sql.IRecordSet<any>[])[0][0].revision, 3);
      assert.equal((done.recordsets as sql.IRecordSet<any>[])[0][0].canComment, false);
      assert.equal((done.recordsets as sql.IRecordSet<any>[])[1].length, 3);
    });
    await fixture(async (tx, id, body) => {
      await run(tx, 'CREATE', owner.id, id, body);
      await rejects(run(tx, 'DETAIL', other.id, id), 51004);
    });
    await fixture(async (tx, id, body) => {
      await run(tx, 'CREATE', owner.id, id, body);
      await rejects(
        run(tx, 'COMMENT', owner.id, id, {
          action: 'COMMENT',
          id,
          eventId: randomUUID(),
          revision: 2,
          body: 'Stale',
        }),
        51009,
      );
    });
    await fixture(async (tx, id, body) => {
      await run(tx, 'CREATE', owner.id, id, body);
      await rejects(
        run(tx, 'CANCEL', recipient.id, id, {
          action: 'CANCEL',
          id,
          eventId: randomUUID(),
          revision: 1,
          body: 'Unauthorized',
        }),
        51003,
      );
    });
    await fixture(async (tx, id, body) => {
      await run(tx, 'CREATE', owner.id, id, body);
      await permissions(tx, recipient, true);
      assert.equal((await run(tx, 'NOTIFICATIONS', recipient.id)).recordset.length, 0);
      await rejects(run(tx, 'DETAIL', recipient.id, id), 51004);
    });
    await fixture(async (tx, id, body) => {
      await permissions(tx, recipient, true);
      await rejects(run(tx, 'CREATE', owner.id, id, body), 51011);
    });
    await fixture(async (tx, id, body) => {
      await rejects(run(tx, 'CREATE', owner.id, id, { ...body, ownerId: other.id }), 51000);
    });
    await fixture(async (tx, id, body) => {
      await run(tx, 'CREATE', owner.id, id, body);
      await rejects(run(tx, 'CREATE', owner.id, id, { ...body, title: 'Changed replay' }), 51009);
    });
    await fixture(async (tx, id, body) => {
      await run(tx, 'CREATE', owner.id, id, body);
      assert.equal(
        ((await run(tx, 'DETAIL', owner.id, id)).recordsets as sql.IRecordSet<any>[])[0][0].kind,
        'INCIDENT',
      );
    }, 'INCIDENT');
    const ordinary = new sql.Transaction(pool);
    await ordinary.begin();
    try {
      const id = randomUUID();
      const body = {
        action: 'CREATE',
        id,
        kind: 'REQUEST',
        title: 'Own recipient QA',
        description: 'Explicit recipient without assignment powers',
        priority: 'NORMAL',
        recipientId: recipient.id,
      };
      assert.equal(can(before, recipient, 'request.assign'), false);
      await run(ordinary, 'CREATE', owner.id, id, body);
      assert.equal((await run(ordinary, 'DETAIL', recipient.id, id)).recordset[0].canComment, true);
      const matches = await new sql.Request(ordinary)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, owner.id)
        .input('mode', sql.VarChar(20), 'OPTIONS')
        .input('query', sql.NVarChar(100), recipient.displayName)
        .execute('dbo.WorkflowWorkspace');
      assert.ok((matches.recordsets as sql.IRecordSet<any>[])[1].length > 0);
      assert.ok(
        (matches.recordsets as sql.IRecordSet<any>[])[1].every(
          r => r.name === recipient.displayName,
        ),
      );
    } finally {
      await ordinary.rollback().catch(() => undefined);
    }
    const listing = new sql.Transaction(pool);
    await listing.begin();
    try {
      const marker = randomUUID();
      for (let n = 0; n < 12; n++) {
        const id = randomUUID();
        await run(listing, 'CREATE', owner.id, id, {
          action: 'CREATE',
          id,
          kind: 'REQUEST',
          category: n % 2 ? 'SKILL' : 'LEARNING',
          title: marker + ' ' + n,
          description: 'Search literal % _ [ characters',
          priority: n % 2 ? 'HIGH' : 'NORMAL',
          recipientId: recipient.id,
        });
      }
      const list = (
        actor: string,
        page = 1,
        inbox = false,
        category = '',
        query: string = marker,
      ) =>
        new sql.Request(listing)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('page', sql.Int, page)
          .input('inbox', sql.Bit, inbox)
          .input('category', sql.VarChar(24), category)
          .input('query', sql.NVarChar(80), query)
          .execute('dbo.ReadWorkflowList');
      const first = (await list(owner.id)).recordsets as sql.IRecordSet<any>[];
      assert.equal(first[0][0].total, 12);
      assert.equal(first[1].length, 10);
      assert.match(first[1][0].reference, /^REQ-\d+$/);
      assert.ok(first[2][0].myTotal >= 12);
      const last = (await list(owner.id, 99999)).recordsets as sql.IRecordSet<any>[];
      assert.equal(last[0][0].page, 2);
      assert.equal(last[1].length, 2);
      assert.ok(!last[1].some(r => first[1].some(f => f.id === r.id)));
      const filtered = (await list(owner.id, 1, false, 'LEARNING'))
        .recordsets as sql.IRecordSet<any>[];
      assert.equal(filtered[0][0].total, 6);
      assert.ok(filtered[1].every(r => r.category === 'LEARNING'));
      assert.equal(filtered[2][0].total, first[2][0].total);
      assert.equal((await list(recipient.id, 1, true)).recordset[0].total, 12);
      assert.equal((await list(other.id)).recordset[0].total, 0);
      assert.equal(
        (await list(owner.id, 1, false, '', first[1][0].reference)).recordset[0].total,
        1,
      );
      assert.equal((await list(owner.id, 1, false, '', "' OR 1=1 --")).recordset[0].total, 0);
    } finally {
      await listing.rollback().catch(() => undefined);
    }
    await rejects(pool.request().query('SELECT TOP 1 * FROM dbo.WorkflowRecord'), 229);
  });
  assert.equal((await access.snapshot()).revision, before.revision);
  console.log(
    'Workflow SQL checks passed: owner/recipient isolation, current permissions, idempotency, comments, cancellation, incident separation, notification filtering and restricted table access. All records and permission fixtures rolled back.',
  );
} finally {
  await closeRuntimeDatabase();
}
