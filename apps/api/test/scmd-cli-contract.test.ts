import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import sql from 'mssql';
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let sequence = 0;
test('SCMD operator requires matching preview receipt; verify rolls back and only apply commits governed catalogue operations', async () => {
  const env = { ...process.env },
    argv = process.argv.slice(),
    exit = process.exitCode,
    originalRead = fs.readFile,
    virtual = new Map<string, string>(),
    logs: string[] = [],
    writes: { procedure: string; payload?: Record<string, unknown> }[] = [];
  let allowed = true,
    approval = true,
    db = 'catalogue-contract-dev',
    revision = 4,
    commits = 0,
    rollbacks = 0,
    version = 0,
    retiredProvider = false;
  Object.assign(process.env, {
    AZURE_SQL_SERVER: 'operator-contract.database.windows.net',
    AZURE_SQL_DATABASE: db,
    ACCESS_ACCOUNT_ID: account,
  });
  const read = mock.method(
    fs,
    'readFile',
    async (file: Parameters<typeof fs.readFile>[0], options?: Parameters<typeof fs.readFile>[1]) =>
      String(file).endsWith('/.local/scmd-catalogue-preview.json')
        ? (virtual.get('receipt') ?? '{}')
        : originalRead(file, options ?? {}),
  );
  const write = mock.method(
    fs,
    'writeFile',
    async (file: Parameters<typeof fs.writeFile>[0], data: Parameters<typeof fs.writeFile>[1]) => {
      assert.ok(String(file).endsWith('/.local/scmd-catalogue-preview.json'));
      virtual.set('receipt', String(data));
    },
  );
  syncBuiltinESMExports();
  const mocks = [
    mock.method(console, 'log', (...args: unknown[]) => logs.push(args.join(' '))),
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
    mock.method(sql.Request.prototype, 'query', async (statement: string) => {
      if (statement.includes('AS databaseName'))
        return {
          recordsets: [
            [{ databaseName: db, revision, allowed }],
            [],
            retiredProvider ? [{ id: actor, name: 'Oracle', active: false }] : [],
            [],
            [],
          ],
        };
      if (statement.includes('SELECT revision FROM dbo.AccessWorkspace'))
        return { recordset: [{ revision: revision + version++ }] };
      if (statement.includes('FROM dbo.MasterAmendment'))
        return {
          recordset: [
            {
              revision: 1,
              target: 'cccccccc-cccc-4ccc-8ccc-' + String(++version).padStart(12, '0'),
            },
          ],
        };
      throw Error('Unexpected SCMD operator query');
    }),
    mock.method(
      sql.Request.prototype,
      'execute',
      async function (this: sql.Request, procedure: string) {
        if (procedure === 'dbo.BusinessContext')
          return { recordset: [{ json: JSON.stringify({ canApprove: approval }) }] };
        assert.ok(['dbo.SaveSkillCatalogue', 'dbo.BusinessWorkflow'].includes(procedure));
        const payload = JSON.parse(String(this.parameters.payload.value));
        writes.push({ procedure, payload });
        return { recordset: [] };
      },
    ),
  ];
  const run = async (args: string[]) => {
    process.argv = [argv[0], argv[1], ...args];
    await import(
      new URL('../src/scmd-catalogue-cli.ts?scenario=' + ++sequence, import.meta.url).href
    );
  };
  try {
    await assert.rejects(run([]), /authorized operator/);
    await assert.rejects(run(['--operator=' + actor, '--delete']), /authorized operator/);
    allowed = false;
    await assert.rejects(run(['--operator=' + actor]), /active linked catalogue operator/);
    allowed = true;
    db = 'production';
    await assert.rejects(run(['--operator=' + actor]), /Development database/);
    db = 'catalogue-contract-dev';
    approval = false;
    await assert.rejects(run(['--operator=' + actor]), /approval authority/);
    approval = true;
    retiredProvider = true;
    await assert.rejects(run(['--operator=' + actor]), /provider is retired/);
    retiredProvider = false;
    await run(['--operator=' + actor]);
    assert.equal(commits, 0);
    assert.equal(writes.length, 0);
    assert.ok(virtual.has('receipt'));
    revision++;
    await assert.rejects(run(['--operator=' + actor, '--verify']), /Preview changed/);
    revision--;
    await run(['--operator=' + actor, '--verify']);
    assert.equal(commits, 0);
    assert.ok(writes.some(w => w.procedure === 'dbo.SaveSkillCatalogue'));
    assert.ok(writes.some(w => w.payload?.type === 'PROVIDER'));
    assert.ok(writes.some(w => w.payload?.type === 'CERTIFICATION'));
    assert.ok(logs.some(s => s.includes('rolling back every skill')));
    await run(['--operator=' + actor, '--apply']);
    assert.equal(commits, 1);
    assert.ok(rollbacks > 4);
    assert.ok(logs.some(s => s.includes('employee records preserved')));
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
