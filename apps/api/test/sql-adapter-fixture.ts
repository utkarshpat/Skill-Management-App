import assert from 'node:assert/strict';
import { mock } from 'node:test';
import sql from 'mssql';
import { closeRuntimeDatabase } from '../src/shared/database.js';

// Test the real adapters and pool lifecycle, stopping at the driver boundary.
// No credentials, socket connection or company database is used.
export function sqlAdapterFixture() {
  const calls: { procedure: string; inputs: Record<string, unknown> }[] = [];
  const queue: { procedure: string; sets?: unknown[][]; error?: unknown }[] = [];
  const previous = { ...process.env };
  Object.assign(process.env, {
    AZURE_SQL_SERVER: 'adapter-contract.database.windows.net',
    AZURE_SQL_DATABASE: 'adapter_contract',
    AZURE_SQL_RUNTIME_AUTH: 'managed-identity',
  });
  const connect = mock.method(
    sql.ConnectionPool.prototype,
    'connect',
    async function (this: sql.ConnectionPool) {
      return this;
    },
  );
  const close = mock.method(sql.ConnectionPool.prototype, 'close', async () => {});
  const request = mock.method(sql.ConnectionPool.prototype, 'request', () => {
    const inputs: Record<string, unknown> = {};
    const request = {
      input(name: string, _type: unknown, value: unknown) {
        inputs[name] = value;
        return request;
      },
      async execute(procedure: string) {
        const next = queue.shift();
        assert.ok(next, 'Unexpected SQL procedure: ' + procedure);
        assert.equal(procedure, next.procedure);
        calls.push({ procedure, inputs });
        if (next.error) throw next.error;
        const sets = next.sets ?? [[]];
        return { recordsets: sets, recordset: sets[0], rowsAffected: [] };
      },
    };
    return request as unknown as sql.Request;
  });
  return {
    calls,
    reply(procedure: string, ...sets: unknown[][]) {
      queue.push({ procedure, sets });
    },
    reject(procedure: string, error: unknown) {
      queue.push({ procedure, error });
    },
    async finish() {
      try {
        assert.equal(queue.length, 0, 'Every expected SQL call must execute');
      } finally {
        await closeRuntimeDatabase();
        request.mock.restore();
        close.mock.restore();
        connect.mock.restore();
        for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
        Object.assign(process.env, previous);
      }
    },
  };
}
