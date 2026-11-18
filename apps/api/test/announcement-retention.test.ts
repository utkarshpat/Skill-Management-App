import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqlAnnouncementRetention } from '../src/modules/announcements/announcement-retention.js';
import type { withRuntimeDatabase } from '../src/shared/database.js';
function adapter(batches: object[]) {
  const calls: { account?: string; execute?: boolean; procedure?: string }[] = [];
  const database: typeof withRuntimeDatabase = async work =>
    work({
      request: () => {
        const call: { account?: string; execute?: boolean; procedure?: string } = {};
        calls.push(call);
        const request = {
          input(name: string, _type: unknown, value: unknown) {
            if (name === 'account_id') call.account = String(value);
            if (name === 'execute') call.execute = Boolean(value);
            return request;
          },
          execute: async (name: string) => {
            call.procedure = name;
            return { recordset: [batches.shift()] };
          },
        };
        return request;
      },
    } as never);
  return { database, calls };
}
test('retention defaults to preview and binds the configured account', async () => {
  const a = adapter([
    { eligible: 3, deletedAnnouncements: 0, deletedResponses: 0, hasMore: false },
  ]);
  assert.deepEqual(await new SqlAnnouncementRetention('account', a.database).run(), {
    eligible: 3,
    deletedAnnouncements: 0,
    deletedResponses: 0,
  });
  assert.deepEqual(a.calls, [
    { account: 'account', execute: false, procedure: 'dbo.PurgeExpiredAnnouncements' },
  ]);
});
test('retention executes bounded batches and stops on no progress', async () => {
  const a = adapter([
    { eligible: 200, deletedAnnouncements: 200, deletedResponses: 7, hasMore: true },
    { eligible: 2, deletedAnnouncements: 2, deletedResponses: 1, hasMore: false },
  ]);
  assert.deepEqual(await new SqlAnnouncementRetention('account', a.database).run(true), {
    eligible: 202,
    deletedAnnouncements: 202,
    deletedResponses: 8,
  });
  assert.ok(a.calls.every(c => c.execute));
  const stuck = adapter([
    { eligible: 1, deletedAnnouncements: 0, deletedResponses: 0, hasMore: true },
  ]);
  await assert.rejects(
    new SqlAnnouncementRetention('account', stuck.database).run(true),
    /no progress/,
  );
});
test('retention SQL keeps drafts, current records and other accounts out of deletion', async () => {
  const sql = await readFile(
    new URL(
      '../../../database/migrations/106_announcement_pagination_retention.sql',
      import.meta.url,
    ),
    'utf-8',
  );
  const cleanup = sql.slice(sql.indexOf('CREATE OR ALTER PROCEDURE dbo.PurgeExpiredAnnouncements'));
  assert.match(cleanup, /DATEADD\(day,-45,SYSUTCDATETIME\(\)\)/);
  assert.match(cleanup, /state IN\('PUBLISHED','CLOSED'\) AND ends_at<@cutoff/);
  assert.match(cleanup, /SELECT TOP\(200\)/);
  assert.match(cleanup, /DELETE r[\s\S]*r.account_id=@account_id/);
  assert.match(cleanup, /DELETE a[\s\S]*a.account_id=@account_id/);
  assert.ok(cleanup.indexOf('DELETE r') < cleanup.indexOf('DELETE a'));
  assert.match(cleanup, /AccessRuntimeAccount[\s\S]*account_id=@account_id/);
});

test('retention rejects missing or corrupt counts and propagates database failures', async () => {
  for (const result of [
    undefined,
    { eligible: -1, deletedAnnouncements: 0, deletedResponses: 0 },
    { eligible: 1, deletedAnnouncements: 0.5, deletedResponses: 0 },
    { eligible: 1, deletedAnnouncements: 0, deletedResponses: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    const a = adapter([result as object]);
    await assert.rejects(
      new SqlAnnouncementRetention('account', a.database).run(true),
      /Invalid retention/,
    );
  }
  const database: typeof withRuntimeDatabase = async () => {
    throw Error('database unavailable');
  };
  await assert.rejects(
    new SqlAnnouncementRetention('account', database).run(true),
    /database unavailable/,
  );
});
