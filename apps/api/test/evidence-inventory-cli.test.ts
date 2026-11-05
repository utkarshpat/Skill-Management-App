import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import sql from 'mssql';
import { BlobServiceClient } from '@azure/storage-blob';
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let sequence = 0;
test('evidence inventory is dry-run only, retains registered/history objects, and never claims unverifiable recovery settings', async () => {
  const env = { ...process.env },
    argv = process.argv.slice(),
    exit = process.exitCode,
    output: Record<string, any>[] = [],
    reports: Record<string, any>[] = [],
    queries: string[] = [];
  let done = () => {},
    exists = true,
    publicAccess = false,
    changed = false,
    recoveryAllowed = true;
  Object.assign(process.env, {
    AZURE_SQL_SERVER: 'inventory-contract.database.windows.net',
    AZURE_SQL_DATABASE: 'inventory-contract-dev',
    ACCESS_ACCOUNT_ID: account,
    EVIDENCE_STORAGE_CONNECTION_STRING: 'test-only',
    EVIDENCE_STORAGE_CONTAINER: 'private',
  });
  delete process.env.EVIDENCE_STORAGE_PROVIDER;
  delete process.env.STORAGE_IS_SQL;
  const write = mock.method(
    fs,
    'writeFile',
    async (_file: Parameters<typeof fs.writeFile>[0], data: Parameters<typeof fs.writeFile>[1]) => {
      reports.push(JSON.parse(String(data)));
    },
  );
  const mkdir = mock.method(fs, 'mkdir', async () => undefined);
  syncBuiltinESMExports();
  const mocks = [
    mock.method(console, 'log', (value: string) => {
      output.push(JSON.parse(value));
      done();
    }),
    mock.method(console, 'error', (value: string) => {
      output.push({ error: value });
      done();
    }),
    mock.method(sql.ConnectionPool.prototype, 'connect', async function (this: sql.ConnectionPool) {
      return this;
    }),
    mock.method(sql.ConnectionPool.prototype, 'close', async () => {}),
    mock.method(sql.Request.prototype, 'query', async (statement: string) => {
      queries.push(statement);
      assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP)\b/.test(statement));
      if (statement.includes('PrivateFileObject'))
        return {
          recordsets: [
            [{ file_id: account, bytes: 10, provider: 'sql', file_name: 'oracle-sql.txt' }],
            [{ retained_parts: 1, retained_bytes: 10, expired_parts: 1 }],
          ],
        };
      if (statement.includes('SkillClaimEvidence'))
        return {
          recordsets: [
            exists ? [{ revision: 4 }] : [],
            [{ name: account + '/credential' }],
            [{ document: '{}' }],
          ],
        };
      if (statement.includes('SELECT revision'))
        return { recordset: [{ revision: changed ? 5 : 4 }] };
      throw Error('Unexpected inventory query');
    }),
    mock.method(
      BlobServiceClient,
      'fromConnectionString',
      () =>
        ({
          getProperties: async () => {
            if (!recoveryAllowed) throw Error('Recovery settings unavailable');
            return { deleteRetentionPolicy: { enabled: true, days: 7 } };
          },
          getContainerClient: () => ({
            getProperties: async () => ({ blobPublicAccess: publicAccess ? 'blob' : undefined }),
            listBlobsFlat: async function* ({ prefix }: { prefix: string }) {
              assert.equal(prefix, account + '/');
              yield {
                name: account + '/credential',
                properties: { contentLength: 10, lastModified: new Date('2026-11-04T10:00:00Z') },
              };
              yield { name: account + '/unreferenced', properties: {} };
            },
          }),
        }) as unknown as BlobServiceClient,
    ),
  ];
  const run = async (args: string[]) => {
    process.exitCode = 0;
    process.argv = [argv[0], argv[1], ...args];
    const completion = new Promise<void>(resolve => {
      done = resolve;
    });
    await import(
      new URL('../src/evidence-inventory-cli.ts?scenario=' + ++sequence, import.meta.url).href
    );
    await completion;
  };
  try {
    await run(['--delete']);
    assert.equal(process.exitCode, 1);
    assert.equal(queries.length, 0);
    assert.match(output.at(-1)?.error, /No deletion command/);
    delete process.env.ACCESS_ACCOUNT_ID;
    await run(['--dry-run']);
    assert.equal(process.exitCode, 1);
    process.env.ACCESS_ACCOUNT_ID = account;
    process.env.STORAGE_IS_SQL = 'true';
    await run(['--dry-run']);
    assert.equal(reports.at(-1)?.deleted, 0);
    assert.equal(reports.at(-1)?.staging.expired_parts, 1);
    delete process.env.STORAGE_IS_SQL;
    exists = false;
    await run(['--dry-run']);
    assert.equal(process.exitCode, 1);
    exists = true;
    publicAccess = true;
    await run(['--dry-run']);
    assert.equal(process.exitCode, 1);
    assert.match(output.at(-1)?.error, /not private/);
    publicAccess = false;
    await run(['--dry-run']);
    assert.equal(process.exitCode, 0);
    assert.equal(output.at(-1)?.deleted, 0);
    assert.equal(output.at(-1)?.referenced, 1);
    assert.equal(output.at(-1)?.scanComplete, true);
    changed = true;
    recoveryAllowed = false;
    await run(['--dry-run']);
    assert.equal(output.at(-1)?.scanComplete, false);
    assert.equal(reports.at(-1)?.recovery, 'Storage recovery settings not verified');
  } finally {
    for (const m of mocks) m.mock.restore();
    write.mock.restore();
    mkdir.mock.restore();
    syncBuiltinESMExports();
    process.argv = argv;
    process.exitCode = exit;
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }
});
