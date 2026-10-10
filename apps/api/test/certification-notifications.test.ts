import test from 'node:test';
import assert from 'node:assert/strict';
import sql from 'mssql';
import { SqlCertificationStore } from '../src/modules/skills/sql-certification-store.js';
import { loadNotificationFeed } from '../src/modules/identity/notification-feed.js';
import { AccessError } from '../src/shared/errors.js';

for (const [number, status] of [
  [51003, 403],
  [51004, 404],
  [2812, 503],
  [208, 503],
]) {
  test(`expiry SQL ${number} maps to ${status}; revoked access withholds the whole feed`, async t => {
    const pool = new sql.ConnectionPool({ server: 'fixture' });
    const store = new SqlCertificationStore(
      '00000000-0000-4000-8000-000000000001',
      async callback => callback(pool),
    );
    t.mock.method(sql.Request.prototype, 'execute', async function (procedure: string) {
      if (procedure === 'dbo.CertificationExpiryNotifications')
        throw Object.assign(Error('Private SQL diagnostic'), { number });
      assert.equal(procedure, 'dbo.CertificationWorkspace');
      return { recordsets: [[]] };
    });
    await assert.rejects(
      store.notifications('00000000-0000-4000-8000-000000000002'),
      (e: any) =>
        e instanceof AccessError && e.status === status && !e.message.includes('Private SQL'),
    );
    const base = {
      personId: 'own',
      items: [
        { id: 'profile', at: '2026-10-10', title: 'Profile', body: 'Update', href: '/profile' },
      ],
    };
    const load = () =>
      loadNotificationFeed(base, [
        {
          name: 'certifications',
          load: () => store.notifications('00000000-0000-4000-8000-000000000002'),
        },
      ]);
    if (status === 403) await assert.rejects(load(), (e: any) => e.status === 403);
    else {
      const feed = await load();
      assert.equal(feed.partial, true);
      assert.deepEqual(feed.failedSources, ['certifications']);
      assert.deepEqual(feed.items, base.items);
    }
  });
}
