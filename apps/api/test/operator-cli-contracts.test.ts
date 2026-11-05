import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import sql from 'mssql';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let sequence = 0;
test('catalogue provisioning previews by default, requires current owner access, and commits only explicit reviewed writes', async () => {
  const env = { ...process.env },
    argv = process.argv.slice(),
    exit = process.exitCode,
    logs: string[] = [],
    writes: Record<string, unknown>[] = [];
  let allowed = true,
    linked = true,
    migration = true,
    commits = 0,
    rollbacks = 0,
    writeFailure = false;
  Object.assign(process.env, {
    NODE_ENV: 'development',
    AZURE_SQL_SERVER: 'operator-contract.database.windows.net',
    AZURE_SQL_DATABASE: 'catalogue-contract-dev',
    AZURE_SQL_RUNTIME_AUTH: 'managed-identity',
    ACCESS_ACCOUNT_ID: account,
    ROLE_PRESET_OWNER_OBJECT_ID: actor,
    ENTRA_TENANT_ID: account,
  });
  const mocks = [
    mock.method(console, 'log', (...args: unknown[]) => logs.push(args.join(' '))),
    mock.method(console, 'error', (...args: unknown[]) => logs.push(args.join(' '))),
    mock.method(sql.ConnectionPool.prototype, 'connect', async function (this: sql.ConnectionPool) {
      return this;
    }),
    mock.method(sql.ConnectionPool.prototype, 'close', async () => {}),
    mock.method(sql.Transaction.prototype, 'begin', async function (this: sql.Transaction) {
      return this;
    }),
    mock.method(sql.Transaction.prototype, 'commit', async () => {
      commits++;
    }),
    mock.method(sql.Transaction.prototype, 'rollback', async () => {
      rollbacks++;
    }),
    mock.method(
      sql.Request.prototype,
      'execute',
      async function (this: sql.Request, procedure: string) {
        if (procedure === 'dbo.ResolveAccessIdentity')
          return { recordset: linked ? [{ id: actor }] : [] };
        assert.equal(procedure, 'dbo.SaveSkillCatalogue');
        if (writeFailure) throw { number: 51009 };
        writes.push(
          Object.fromEntries(Object.entries(this.parameters).map(([k, v]) => [k, v.value])),
        );
        return { recordset: [] };
      },
    ),
    mock.method(sql.Request.prototype, 'query', async (statement: string) => {
      if (statement.includes('SELECT w.revision'))
        return { recordsets: [[{ revision: 4, allowed }], []] };
      if (statement.includes('WHERE version=74'))
        return { recordset: migration ? [{ version: 74 }] : [] };
      throw Error('Unexpected catalogue operator query');
    }),
  ];
  const run = async (args: string[]) => {
    process.exitCode = 0;
    process.argv = [argv[0], argv[1], ...args];
    await import(
      new URL('../src/catalogue-seed-cli.ts?scenario=' + ++sequence, import.meta.url).href
    );
  };
  try {
    await run(['--unknown']);
    assert.equal(process.exitCode, 1);
    assert.equal(writes.length, 0);
    linked = false;
    await run([]);
    assert.equal(process.exitCode, 1);
    linked = true;
    allowed = false;
    await run([]);
    assert.equal(process.exitCode, 1);
    allowed = true;
    await run([]);
    assert.equal(process.exitCode, 0);
    assert.equal(writes.length, 0);
    assert.equal(commits, 0);
    assert.ok(rollbacks > 0);
    await run(['--align-existing']);
    assert.equal(writes.length, 0);
    migration = false;
    await run(['--apply']);
    assert.equal(process.exitCode, 1);
    assert.equal(writes.length, 0);
    migration = true;
    await run(['--apply']);
    assert.equal(process.exitCode, 0);
    assert.equal(commits, 1);
    assert.ok(writes.length > 20);
    assert.equal(writes[0].expected_revision, 4);
    assert.equal(writes.at(-1)?.expected_revision, 3 + writes.length);
    assert.ok(
      writes.every(w => w.account_id === account && w.actor_id === actor && w.is_new === true),
    );
    writeFailure = true;
    const before = commits;
    await run(['--apply']);
    assert.equal(process.exitCode, 1);
    assert.equal(commits, before);
    assert.ok(logs.some(s => s.includes('transaction rolled back')));
  } finally {
    for (const m of mocks) m.mock.restore();
    process.argv = argv;
    process.exitCode = exit;
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }
});

test('legacy development import never overwrites an initialized workspace and keeps source data off disk in contract tests', async () => {
  const env = { ...process.env },
    argv = process.argv.slice(),
    exit = process.exitCode,
    originalRead = fs.readFile,
    virtual = new Map<string, string>(),
    logs: string[] = [],
    writes: string[] = [];
  const local = (await LocalAccessStore.open()).snapshot();
  let existing = false,
    activeAccount = true,
    commits = 0,
    fail = false;
  Object.assign(process.env, {
    NODE_ENV: 'development',
    DEV_DIRECT_LOGIN: 'true',
    AZURE_SQL_SERVER: 'operator-contract.database.windows.net',
    AZURE_SQL_DATABASE: 'import-contract-dev',
    ENTRA_TENANT_ID: account,
    ROLE_PRESET_OWNER_OBJECT_ID: actor,
  });
  const read = mock.method(
    fs,
    'readFile',
    async (
      file: Parameters<typeof fs.readFile>[0],
      options?: Parameters<typeof fs.readFile>[1],
    ) => {
      if (String(file).endsWith('/.local/dev-access.json')) return JSON.stringify(local);
      return originalRead(file, options ?? {});
    },
  );
  const write = mock.method(
    fs,
    'writeFile',
    async (file: Parameters<typeof fs.writeFile>[0], data: Parameters<typeof fs.writeFile>[1]) => {
      virtual.set(String(file), String(data));
    },
  );
  syncBuiltinESMExports();
  const mocks = [
    mock.method(console, 'log', (...args: unknown[]) => logs.push(args.join(' '))),
    mock.method(console, 'error', (...args: unknown[]) => logs.push(args.join(' '))),
    mock.method(sql.ConnectionPool.prototype, 'connect', async function (this: sql.ConnectionPool) {
      return this;
    }),
    mock.method(sql.ConnectionPool.prototype, 'close', async () => {}),
    mock.method(sql.Transaction.prototype, 'begin', async function (this: sql.Transaction) {
      return this;
    }),
    mock.method(sql.Transaction.prototype, 'commit', async () => {
      commits++;
    }),
    mock.method(sql.Transaction.prototype, 'rollback', async () => {}),
    mock.method(sql.Request.prototype, 'query', async (statement: string) => {
      if (statement.includes('SELECT account_id'))
        return { recordset: activeAccount ? [{ account_id: account }] : [] };
      if (statement.includes('SELECT revision'))
        return { recordset: existing ? [{ revision: 4 }] : [] };
      if (fail) throw { number: 51003 };
      assert.ok(
        statement.startsWith('INSERT ') || statement.startsWith('IF DATABASE_PRINCIPAL_ID'),
      );
      writes.push(statement);
      return { recordset: [] };
    }),
  ];
  const run = async () => {
    process.exitCode = 0;
    await import(
      new URL('../src/access-import-cli.ts?scenario=' + ++sequence, import.meta.url).href
    );
  };
  try {
    process.env.NODE_ENV = 'production';
    await assert.rejects(run(), /explicit development/);
    process.env.NODE_ENV = 'development';
    activeAccount = false;
    await run();
    assert.equal(process.exitCode, 1);
    assert.equal(writes.length, 0);
    activeAccount = true;
    existing = true;
    await run();
    assert.equal(process.exitCode, 1);
    assert.equal(writes.length, 0);
    existing = false;
    await run();
    assert.equal(process.exitCode, 0);
    assert.equal(commits, 1);
    assert.ok(writes.some(s => s.includes('AccessPersonOverride')));
    assert.ok(virtual.size > 0);
    const before = commits;
    fail = true;
    await run();
    assert.equal(process.exitCode, 1);
    assert.equal(commits, before);
    assert.ok(logs.some(s => s.includes('Access import failed (51003)')));
  } finally {
    for (const m of mocks) m.mock.restore();
    read.mock.restore();
    write.mock.restore();
    syncBuiltinESMExports();
    process.argv = argv;
    process.exitCode = exit;
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }
});
