import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { parseMigrationFiles } from '../src/migration-files.js';

test('migration discovery orders contiguous versions and rejects gaps or bad names', () => {
  assert.deepEqual(
    parseMigrationFiles(['002_b.sql', '001_a.sql', 'notes.txt']).map(m => m.version),
    [1, 2],
  );
  assert.throws(() => parseMigrationFiles(['001_a.sql', '003_c.sql']), /contiguous/);
  assert.throws(() => parseMigrationFiles(['1_a.sql']), /Invalid migration filename/);
});

test('repository migrations are contiguous and cover the legacy baseline', async () => {
  const files = await readdir(new URL('../../../database/migrations/', import.meta.url));
  assert.ok(parseMigrationFiles(files).length >= 52);
});
