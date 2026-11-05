import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlAdapterFixture } from './sql-adapter-fixture.js';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
import {
  LocalAccessStore,
  type LocalAccessState,
} from '../src/modules/access/local-access-store.js';
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  at = new Date('2026-11-04T10:00:00Z');
function encode(state: LocalAccessState): unknown[][] {
  return [
    [{ revision: state.revision }],
    state.roles.map(r => ({ id: r.id, name: r.name })),
    state.roles.flatMap(r =>
      r.permissions.map(p => ({
        ...p,
        roleId: r.id,
        validUntil: p.validUntil ? new Date(p.validUntil) : null,
      })),
    ),
    state.people.map(p => ({
      ...p,
      entraObjectId: p.entraObjectId ?? null,
      businessJson: p.business ? JSON.stringify(p.business) : undefined,
    })),
    state.people.flatMap(p => p.roleIds.map(roleId => ({ personId: p.id, roleId }))),
    state.people.flatMap(p =>
      p.overrides.map(o => ({
        ...o,
        personId: p.id,
        validUntil: o.validUntil ? new Date(o.validUntil) : null,
      })),
    ),
    state.audit.map(a => ({
      ...a,
      at: new Date(a.at),
      before: a.before ? JSON.stringify(a.before) : null,
      after: JSON.stringify(a.after),
    })),
    state.reporting ?? [],
  ];
}
test('access adapter reconstructs role/override expiry, actor-only projections, audit cursors and verified identity bindings', async () => {
  const f = sqlAdapterFixture(),
    store = new SqlAccessStore(account);
  try {
    assert.throws(() => new SqlAccessStore('invalid'), /UUID/);
    const permission = {
      permission: 'profile.view',
      scope: 'OWN',
      effect: 'ALLOW',
      validUntil: at,
      reason: 'Personal workspace',
    };
    const sets = [
      [{ revision: 8 }],
      [
        { id: id.toUpperCase(), name: 'Personal Workspace' },
        { id: account.toUpperCase(), name: 'Unassigned role' },
      ],
      [{ ...permission, roleId: id.toUpperCase() }],
      [
        {
          id: actor.toUpperCase(),
          displayName: 'Aditi Menon',
          employeeCode: 'EMP-1042',
          active: true,
          primaryCapabilityId: id.toUpperCase(),
          entraObjectId: actor.toUpperCase(),
          businessJson: '{}',
        },
        {
          id: account.toUpperCase(),
          displayName: 'Rohan Mehta',
          active: false,
          primaryCapabilityId: null,
        },
      ],
      [{ personId: actor.toUpperCase(), roleId: id.toUpperCase() }],
      [
        {
          ...permission,
          personId: actor.toUpperCase(),
          effect: 'DENY',
          validUntil: null,
          reason: null,
        },
      ],
      [
        {
          actorId: actor.toUpperCase(),
          targetId: id.toUpperCase(),
          action: 'role.updated',
          at,
          revision: 8,
          before: '{}',
          after: '{"name":"Personal Workspace"}',
        },
        {
          actorId: actor.toUpperCase(),
          targetId: id.toUpperCase(),
          action: 'role.created',
          at,
          revision: 7,
          before: null,
          after: '{}',
        },
      ],
      [
        { personId: actor.toUpperCase(), managerId: account.toUpperCase() },
        { personId: account.toUpperCase(), managerId: null },
      ],
    ];
    f.reply('dbo.ReadAccessWorkspace', ...sets);
    const state = await store.snapshot();
    assert.equal(state.roles[0].permissions[0].validUntil, at.toISOString());
    assert.equal(state.roles[1].permissions.length, 0);
    assert.equal(state.people[0].entraObjectId, actor);
    assert.equal(state.people[1].overrides.length, 0);
    assert.equal(state.audit[0].at, at.toISOString());
    assert.equal(state.reporting?.[0].managerId, account);
    f.reply('dbo.ReadActorAccessContext', ...sets);
    assert.equal((await store.actorSnapshot(actor, { includeAudit: true })).reporting, undefined);
    assert.equal(f.calls.at(-1)?.inputs.include_notifications, true);
    f.reply('dbo.ReadActorAccessContext', ...sets);
    assert.equal((await store.person(actor))?.displayName, 'Aditi Menon');
    f.reply('dbo.ReadActorAccessContext', ...sets);
    assert.equal(await store.person(account), undefined);
    f.reply(
      'dbo.ReadPrimaryCapabilities',
      [{ total: 1, page: 2, pageSize: 25 }],
      [{ id: id.toUpperCase(), name: 'SQL' }],
    );
    assert.equal(
      (await store.primaryCapabilities(actor, { search: 'SQL', page: 2 })).items[0].id,
      id,
    );
    for (const [number, status] of [
      [51003, 403],
      [51004, 404],
      [51000, 400],
    ]) {
      f.reject('dbo.ReadPrimaryCapabilities', { number });
      await assert.rejects(store.primaryCapabilities(actor, { search: '', page: 1, id }), {
        status,
      });
    }
    const event = {
      actorId: actor.toUpperCase(),
      targetId: id.toUpperCase(),
      action: 'role.updated',
      at,
      revision: 8,
      before: '{}',
      after: '{}',
    };
    f.reply('dbo.ReadAccessAuditPage', [{ revision: 8 }], [event, { ...event, revision: 7 }]);
    const page = await store.auditPage(actor, { pageSize: 1, query: 'role', details: true });
    assert.equal(page.hasMore, true);
    assert.equal(page.nextCursor, 8);
    assert.equal(page.items[0].actorId, actor);
    f.reply(
      'dbo.ReadAccessAuditPage',
      [{ revision: 8 }],
      [{ ...event, before: null, after: null }],
    );
    const last = await store.auditPage(actor, {
      pageSize: 25,
      query: '',
      details: false,
      before: 8,
      personId: id,
    });
    assert.equal(last.nextCursor, null);
    assert.equal(last.items[0].before, undefined);
    f.reject('dbo.ReadAccessAuditPage', { number: 51003 });
    await assert.rejects(store.auditPage(actor, { pageSize: 25, query: '', details: false }), {
      status: 403,
    });
    for (const rows of [[{ id: actor.toUpperCase() }], []]) {
      f.reply('dbo.ResolveAccessIdentity', rows);
      assert.equal(
        await store.resolveIdentity({ tenantId: account, objectId: actor }),
        rows.length ? actor : undefined,
      );
    }
    const fault = new Error('offline');
    for (const [proc, run] of [
      [
        'dbo.ReadPrimaryCapabilities',
        () => store.primaryCapabilities(actor, { search: '', page: 1 }),
      ],
      [
        'dbo.ReadAccessAuditPage',
        () => store.auditPage(actor, { pageSize: 25, query: '', details: false }),
      ],
    ] as const) {
      f.reject(proc, fault);
      await assert.rejects(run(), e => e === fault);
    }
  } finally {
    await f.finish();
  }
});
test('access writes validate candidate changes, use reviewed revisions and translate SQL recheck failures', async () => {
  const f = sqlAdapterFixture(),
    store = new SqlAccessStore(account),
    state = (await LocalAccessStore.open()).snapshot(),
    admin = state.people[0].id;
  const change = {
    revision: state.revision,
    kind: 'role',
    name: 'SQL Delivery Readers',
    permissions: [{ permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' }],
  };
  try {
    f.reply('dbo.ReadAccessWorkspace', ...encode(state));
    f.reply('dbo.SaveAccessChange');
    f.reply('dbo.ReadAccessWorkspace', ...encode({ ...state, revision: state.revision + 1 }));
    assert.equal((await store.save(admin, change)).revision, state.revision + 1);
    const write = f.calls.find(c => c.procedure === 'dbo.SaveAccessChange')!;
    assert.equal(write.inputs.actor_id, admin);
    assert.equal(write.inputs.expected_revision, state.revision);
    assert.equal(write.inputs.is_new, true);
    assert.equal(JSON.parse(String(write.inputs.payload)).name, 'SQL Delivery Readers');
    for (const [number, status] of [
      [51009, 409],
      [51003, 403],
      [51004, 404],
      [51010, 400],
      [51000, 400],
      [2601, 400],
      [2627, 400],
      [547, 400],
    ]) {
      f.reply('dbo.ReadAccessWorkspace', ...encode(state));
      f.reject('dbo.SaveAccessChange', { number });
      await assert.rejects(store.save(admin, change), { status });
    }
    const fault = new Error('offline');
    f.reply('dbo.ReadAccessWorkspace', ...encode(state));
    f.reject('dbo.SaveAccessChange', fault);
    await assert.rejects(store.save(admin, change), e => e === fault);
  } finally {
    await f.finish();
  }
});
