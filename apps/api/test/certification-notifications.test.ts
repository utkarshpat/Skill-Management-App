import test from 'node:test';
import assert from 'node:assert/strict';
import sql from 'mssql';
import { SqlCertificationStore } from '../src/modules/skills/sql-certification-store.js';
import { loadNotificationFeed } from '../src/modules/identity/notification-feed.js';
import { AccessError } from '../src/shared/errors.js';

test('certification feed reads review outcomes and expiry reminders independently', async t => {
  const pool = new sql.ConnectionPool({ server: 'fixture' });
  let calls = 0;
  const store = new SqlCertificationStore(
    '00000000-0000-4000-8000-000000000001',
    async callback => {
      calls++;
      return callback(pool);
    },
  );
  const row = { at: new Date('2026-10-10'), title: 'Update', body: 'Notice', href: '/my-skills' };
  t.mock.method(sql.Request.prototype, 'execute', async (procedure: string) => ({
    recordset: [
      { ...row, id: procedure === 'dbo.ReadCertificationNotifications' ? 'review' : 'expiry' },
    ],
  }));
  const actor = '00000000-0000-4000-8000-000000000002';
  const items = [
    ...(await store.notifications(actor)),
    ...(await store.expiryNotifications(actor, 2)),
  ];
  assert.equal(calls, 2);
  assert.deepEqual(
    items.map(item => item.id),
    ['review', 'expiry'],
  );
  assert.equal(items[0].at, row.at.toISOString());
});

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
    const review = {
      id: 'review',
      at: '2026-10-10',
      title: 'Approved',
      body: 'Update',
      href: '/my-skills',
    };
    t.mock.method(sql.Request.prototype, 'execute', async function (procedure: string) {
      if (procedure === 'dbo.ReadCertificationNotifications') return { recordset: [review] };
      assert.equal(procedure, 'dbo.CertificationExpiryNotifications');
      throw Object.assign(Error('Private SQL diagnostic'), { number });
    });
    await assert.rejects(
      store.expiryNotifications('00000000-0000-4000-8000-000000000002', 1),
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
        {
          name: 'certification-expiry',
          load: () => store.expiryNotifications('00000000-0000-4000-8000-000000000002', 1),
        },
      ]);
    if (status === 403) await assert.rejects(load(), (e: any) => e.status === 403);
    else {
      const feed = await load();
      assert.equal(feed.partial, true);
      assert.deepEqual(feed.failedSources, ['certification-expiry']);
      assert.deepEqual(feed.items, [...base.items, review]);
    }
  });
}
