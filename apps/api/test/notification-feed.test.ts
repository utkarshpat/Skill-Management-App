import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadNotificationFeed } from '../src/modules/identity/notification-feed.js';
import { AccessError } from '../src/shared/errors.js';
const item = (id: string) => ({
  id,
  at: '2026-10-05T10:00:00Z',
  title: id,
  body: 'Update',
  href: '/profile',
});
test('one notification source failure preserves successful sources and marks partial results', async () => {
  const feed = await loadNotificationFeed({ personId: 'owner', items: [item('profile')] }, [
    { name: 'requests', load: async () => [item('request')] },
    {
      name: 'reviews',
      load: async () => {
        throw Error('Unavailable');
      },
    },
  ]);
  assert.equal(feed.partial, true);
  assert.deepEqual(feed.failedSources, ['reviews']);
  assert.deepEqual(
    feed.items.map(i => i.id),
    ['profile', 'request'],
  );
});
test('notification permission failures fail closed and synchronous failures are isolated', async () => {
  await assert.rejects(
    loadNotificationFeed({ personId: 'owner', items: [] }, [
      {
        name: 'reviews',
        load: async () => {
          throw new AccessError(403, 'Revoked');
        },
      },
    ]),
    (e: unknown) => e instanceof AccessError && e.status === 403,
  );
  const feed = await loadNotificationFeed({ personId: 'owner', items: [] }, [
    {
      name: 'reviews',
      load: () => {
        throw Error('Unavailable');
      },
    },
  ]);
  assert.equal(feed.partial, true);
});
