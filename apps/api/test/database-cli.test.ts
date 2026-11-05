import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sql from 'mssql';
let sequence = 0;
test('database operator checks are read-only; migrations select reviewed files, commit per version and stop on failure', async () => {
  const env = { ...process.env },
    argv = process.argv.slice(),
    previousExit = process.exitCode;
  Object.assign(process.env, {
    AZURE_SQL_SERVER: 'operator-contract.database.windows.net',
    AZURE_SQL_DATABASE: 'operator_contract',
  });
  let initialized = true,
    missing = new Set<number>(),
    rejectBatch = false,
    roleRead = false,
    commits = 0,
    rollbacks = 0;
  const batches: string[] = [],
    logs: string[] = [];
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
      'query',
      async function (this: sql.Request, statement: string) {
        if (statement.includes('AS database_name'))
          return { recordset: [{ database_name: 'operator_contract', connected: 1 }] };
        if (statement.includes('AS initialized'))
          return { recordset: [{ initialized: initialized ? 1 : 0 }] };
        if (statement.includes('AS has_migrations'))
          return { recordset: [{ has_migrations: initialized ? 1 : 0 }] };
        if (statement.includes('WHERE version = @version'))
          return {
            recordset: missing.has(Number(this.parameters.version.value))
              ? []
              : [{ version: this.parameters.version.value }],
          };
        if (statement.includes('INSERT INTO dbo.SchemaMigration')) return { recordset: [] };
        if (statement.includes('ORDER BY version'))
          return { recordset: [{ version: 1 }, { version: 87 }] };
        if (statement.includes('role_count')) {
          roleRead = true;
          return { recordset: [{ role_count: 3 }] };
        }
        if (statement.includes('CREATE TABLE') || statement.includes('CREATE OR ALTER')) {
          initialized = true;
          return { recordset: [] };
        }
        throw Error('Unexpected operator query');
      },
    ),
    mock.method(sql.Request.prototype, 'batch', async (statement: string) => {
      batches.push(statement);
      if (rejectBatch)
        throw Object.assign(new Error('Rejected fixture batch'), { number: 51000, lineNumber: 4 });
      return { recordset: [] };
    }),
  ];
  const run = async (command: string) => {
    process.exitCode = 0;
    process.argv = [argv[0], argv[1], command];
    await import(new URL('../src/database-cli.ts?scenario=' + ++sequence, import.meta.url).href);
  };
  try {
    await run('unknown');
    assert.equal(process.exitCode, 1);
    assert.ok(logs.some(s => s.includes('Usage:')));
    assert.equal(commits, 0);
    initialized = false;
    await run('check');
    assert.ok(logs.some(s => s.includes('Schema is not initialized')));
    assert.equal(roleRead, false);
    assert.equal(batches.length, 0);
    initialized = true;
    await run('check');
    assert.equal(roleRead, true);
    assert.ok(logs.some(s => s.includes('1, 87')));
    missing = new Set([86, 87]);
    await run('migrate');
    assert.equal(process.exitCode, 0);
    assert.ok(commits > 80);
    assert.ok(batches.some(s => s.includes('SaveSkillCatalogue')));
    assert.ok(batches.some(s => s.includes('SaveCatalogueMaster')));
    assert.ok(logs.some(s => s.includes('Migration 87 applied.')));
    const before = commits;
    missing = new Set([2]);
    rejectBatch = true;
    await run('migrate');
    assert.equal(process.exitCode, 1);
    assert.equal(rollbacks, 1);
    assert.equal(commits, before);
    assert.ok(logs.some(s => s.includes('Migration 2 failed: SQL 51000')));
    assert.ok(logs.every(s => !s.includes('DefaultAzureCredential') && !s.includes('Bearer ')));
  } finally {
    for (const m of mocks) m.mock.restore();
    process.argv = argv;
    process.exitCode = previousExit;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
