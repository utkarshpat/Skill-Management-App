import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseConfig } from '../src/shared/database.js';

test('database setup rejects missing or non-Azure targets and enforces TLS', () => {
  assert.throws(() => databaseConfig({}), /Set AZURE_SQL/);
  assert.throws(() => databaseConfig({ AZURE_SQL_SERVER: 'untrusted.example', AZURE_SQL_DATABASE: 'dev' }), /Azure SQL hostname/);
  const config = databaseConfig({ AZURE_SQL_SERVER: 'sql-dev.database.windows.net', AZURE_SQL_DATABASE: 'dev' });
  assert.equal(config.options?.encrypt, true);
  assert.equal(config.options?.trustServerCertificate, false);
  assert.equal(config.authentication?.type, 'token-credential');
  assert.equal(config.pool?.min, 0);
});
