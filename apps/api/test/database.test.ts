import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseConfig } from '../src/shared/database.js';

test('database setup rejects missing or non-Azure targets and enforces TLS', () => {
  assert.throws(() => databaseConfig({}), /Set AZURE_SQL/);
  assert.throws(
    () => databaseConfig({ AZURE_SQL_SERVER: 'untrusted.example', AZURE_SQL_DATABASE: 'dev' }),
    /Azure SQL hostname/,
  );
  const config = databaseConfig({
    AZURE_SQL_SERVER: 'sql-dev.database.windows.net',
    AZURE_SQL_DATABASE: 'dev',
  });
  assert.equal(config.options?.encrypt, true);
  assert.equal(config.options?.trustServerCertificate, false);
  assert.equal(config.authentication?.type, 'token-credential');
  assert.equal(config.pool?.min, 0);
  assert.equal(config.pool?.max, 2);
  assert.equal(config.pool?.idleTimeoutMillis, 60_000);
  assert.equal(config.validateConnection, 'socket');
});

test('SQL idle retention is bounded and configurable without changing pool capacity or health checks', () => {
  const env = { AZURE_SQL_SERVER: 'sql-dev.database.windows.net', AZURE_SQL_DATABASE: 'dev' };
  for (const value of ['1000', '10000', '60000', '300000', ' 15000 ']) {
    const config = databaseConfig({ ...env, AZURE_SQL_POOL_IDLE_TIMEOUT_MS: value });
    assert.equal(config.pool?.idleTimeoutMillis, Number(value));
    assert.equal(config.pool?.min, 0);
    assert.equal(config.pool?.max, 2);
    assert.equal(config.validateConnection, 'socket');
  }
  assert.equal(
    databaseConfig({ ...env, AZURE_SQL_POOL_IDLE_TIMEOUT_MS: ' ' }).pool?.idleTimeoutMillis,
    60_000,
  );
  for (const value of ['0', '999', '-1', '1000.5', '300001', 'NaN', 'Infinity', '1e4', '0x2710'])
    assert.throws(
      () => databaseConfig({ ...env, AZURE_SQL_POOL_IDLE_TIMEOUT_MS: value }),
      /must be an integer from 1000 to 300000/,
    );
});

test('database validation can retain query probes and rejects unsupported modes', () => {
  const env = { AZURE_SQL_SERVER: 'sql-dev.database.windows.net', AZURE_SQL_DATABASE: 'dev' };
  assert.equal(
    databaseConfig({ ...env, AZURE_SQL_CONNECTION_VALIDATION: 'query' }).validateConnection,
    true,
  );
  assert.throws(
    () => databaseConfig({ ...env, AZURE_SQL_CONNECTION_VALIDATION: 'false' }),
    /must be socket or query/,
  );
});
