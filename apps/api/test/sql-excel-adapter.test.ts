import test from 'node:test';
import assert from 'node:assert/strict';
import { sqlAdapterFixture } from './sql-adapter-fixture.js';
import { SqlExcelBulkData } from '../src/modules/skills/excel-bulk-routes.js';
import { AccessError } from '../src/shared/errors.js';

test('Excel SQL adapter binds the exact actor, payload and revision and preserves failure categories', async t => {
  const fixture = sqlAdapterFixture();
  t.after(() => fixture.finish());
  const store = new SqlExcelBulkData('account');
  fixture.reply('dbo.ExcelBulkData', [], [{ json: JSON.stringify({ changed: 1, unchanged: 2 }) }]);
  const payload = { rows: [{ section: 'SKILL', targetId: 'skill' }] };
  assert.deepEqual(await store.execute('person', 'catalogue', 'IMPORT', payload, 9), {
    changed: 1,
    unchanged: 2,
  });
  assert.deepEqual(fixture.calls[0].inputs, {
    account_id: 'account',
    actor_id: 'person',
    kind: 'catalogue',
    operation: 'IMPORT',
    payload: JSON.stringify(payload),
    revision: 9,
  });
  fixture.reply('dbo.ExcelBulkData', [{ json: '{"canImport":false}' }]);
  assert.deepEqual(await store.execute('person', 'catalogue', 'ACCESS'), { canImport: false });
  assert.equal(fixture.calls[1].inputs.revision, null);
  for (const [number, status] of [
    [51003, 403],
    [51009, 409],
    [51000, 400],
  ]) {
    fixture.reject('dbo.ExcelBulkData', Object.assign(Error('Invalid workbook row'), { number }));
    await assert.rejects(
      store.execute('person', 'certifications', 'PREVIEW'),
      error => error instanceof AccessError && error.status === status,
    );
  }
  fixture.reply('dbo.ExcelBulkData', []);
  await assert.rejects(
    store.execute('person', 'catalogue', 'ACCESS'),
    /Workbook result was missing/,
  );
  fixture.reply('dbo.ExcelBulkData', [{ json: 'not json' }]);
  await assert.rejects(store.execute('person', 'catalogue', 'ACCESS'), SyntaxError);
  const outage = Object.assign(Error('Database timeout'), { number: 12345 });
  fixture.reject('dbo.ExcelBulkData', outage);
  await assert.rejects(store.execute('person', 'catalogue', 'ACCESS'), error => error === outage);
});
