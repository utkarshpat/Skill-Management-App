import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { LocalAccessStore, type Assignment } from '../src/modules/access/local-access-store.js';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
let sequence = 0;
test('permission operator plans preserve custom roles and DENY; explicit apply uses current administrator and OWN-only additions', async () => {
  const env = { ...process.env },
    argv = process.argv.slice(),
    exit = process.exitCode,
    state = (await LocalAccessStore.open()).snapshot(),
    actor = state.people[0].id;
  const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    writes: { actor: string; change: any }[] = [],
    logs: string[] = [];
  for (const p of state.people) delete p.entraObjectId;
  state.people[0].entraObjectId = actor;
  for (const r of state.roles)
    r.permissions = r.permissions.filter(
      p =>
        !['request.assign', 'request.resolve', 'incident.assign', 'incident.resolve'].includes(
          p.permission,
        ),
    );
  let linked = true;
  state.roles.push({
    id: account,
    name: 'Delivery Support',
    permissions: [
      { permission: 'request.view', scope: 'OWN', effect: 'ALLOW' },
      { permission: 'incident.view', scope: 'OWN', effect: 'ALLOW' },
      { permission: 'request.resolve', scope: 'OWN', effect: 'DENY' },
    ],
  });
  Object.assign(process.env, {
    NODE_ENV: 'development',
    ACCESS_ACCOUNT_ID: account,
    ROLE_PRESET_OWNER_OBJECT_ID: actor,
    ENTRA_TENANT_ID: account,
  });
  const mocks = [
    mock.method(console, 'log', (...v: unknown[]) => logs.push(v.join(' '))),
    mock.method(console, 'error', (...v: unknown[]) => logs.push(v.join(' '))),
    mock.method(SqlAccessStore.prototype, 'resolveIdentity', async () =>
      linked ? actor : undefined,
    ),
    mock.method(SqlAccessStore.prototype, 'snapshot', async () => structuredClone(state)),
    mock.method(SqlAccessStore.prototype, 'save', async (caller: string, input: unknown) => {
      const change = input as { name: string; permissions: Assignment[]; id?: string };
      writes.push({ actor: caller, change });
      return structuredClone(state);
    }),
  ];
  const run = async (file: string, args: string[] = []) => {
    process.exitCode = 0;
    process.argv = [argv[0], argv[1], ...args];
    await import(new URL('../src/' + file + '.ts?scenario=' + ++sequence, import.meta.url).href);
  };
  try {
    process.env.NODE_ENV = 'production';
    await run('role-presets-cli');
    assert.equal(process.exitCode, 1);
    assert.equal(writes.length, 0);
    process.env.NODE_ENV = 'development';
    linked = false;
    await run('role-presets-cli');
    assert.equal(process.exitCode, 1);
    linked = true;
    await run('role-presets-cli');
    assert.equal(process.exitCode, 0);
    assert.ok(
      logs.some(
        s => s.includes('Preserved existing role:') || s.includes('no permission template created'),
      ),
    );
    assert.ok(writes.every(w => w.actor === actor));
    writes.length = 0;
    delete process.env.ACCESS_ACCOUNT_ID;
    await run('workflow-permissions-cli');
    assert.equal(process.exitCode, 1);
    process.env.ACCESS_ACCOUNT_ID = account;
    delete state.people[0].entraObjectId;
    await run('workflow-permissions-cli');
    assert.equal(process.exitCode, 1);
    state.people[0].entraObjectId = actor;
    await run('workflow-permissions-cli');
    assert.equal(process.exitCode, 0);
    assert.equal(writes.length, 0);
    assert.ok(logs.some(s => s.includes('Plan ')));
    await run('workflow-permissions-cli', ['--apply']);
    assert.equal(process.exitCode, 0);
    assert.ok(writes.length > 0);
    for (const w of writes) {
      assert.equal(w.actor, actor);
      assert.equal(w.change.revision, state.revision);
      for (const p of w.change.permissions as Assignment[])
        if (
          ['request.assign', 'request.resolve', 'incident.assign', 'incident.resolve'].includes(
            p.permission,
          )
        )
          assert.equal(p.scope, 'OWN');
    }
    assert.ok(
      logs.some(s =>
        s.includes('Existing explicit grants/denies and individual overrides are preserved'),
      ),
    );
  } finally {
    for (const m of mocks) m.mock.restore();
    process.argv = argv;
    process.exitCode = exit;
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }
});
