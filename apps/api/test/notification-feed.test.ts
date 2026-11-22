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
test('approval wording updates stored notification labels and preserves reviewer comments', async () => {
  const comment = 'Please review the attached evidence.';
  const feed = await loadNotificationFeed({ personId: 'owner', items: [] }, [
    {
      name: 'reviews',
      load: async () => [
        {
          ...item('capability'),
          title: 'Capability review completed',
          actionLabel: 'Review completed',
          body: comment,
        },
      ],
    },
    {
      name: 'certifications',
      load: async () => [
        {
          ...item('certification'),
          title: 'Certificate review requested',
          actionLabel: 'Submitted for review',
        },
      ],
    },
  ]);
  assert.deepEqual(
    feed.items.map(({ title, actionLabel }) => [title, actionLabel]),
    [
      ['Capability decision recorded', 'Decision recorded'],
      ['Certificate approval requested', 'Submitted for approval'],
    ],
  );
  assert.equal(feed.items[0].body, comment);
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
test('skill staleness copy matches the read-only claim destination', async () => {
  const href = '/my-skills?claim=9e105227-8a6c-47aa-b25f-001000000001';
  const feed = await loadNotificationFeed({ personId: 'owner', items: [] }, [
    {
      name: 'skill-staleness',
      load: async () => [
        {
          ...item('skill-stale-1'),
          title: 'Review your skill',
          body: 'SQL has not been updated for 18 months. Do you want to update or retire this skill?',
          href,
        },
      ],
    },
  ]);
  assert.equal(feed.items[0].href, href);
  assert.equal(
    feed.items[0].body,
    'SQL has not been updated for 18 months. Open the claim to review your recorded proficiency and experience.',
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

for (const [source, prefix] of [
  ['certifications', 'cert-expiry-'],
  ['skill-staleness', 'skill-stale-'],
]) {
  test(`${source} reminder pages stay visible alongside a full activity feed`, async () => {
    const activity = Array.from({ length: 35 }, (_, i) => item('activity-' + i));
    const reminders = Array.from({ length: 31 }, (_, i) => item(prefix + i));
    const feed = await loadNotificationFeed({ personId: 'owner', items: activity }, [
      { name: source, load: async () => reminders },
    ]);
    assert.equal(feed.items.length, 60);
    assert.equal(feed.hasMoreReminders, true);
    assert.ok(feed.items.some(entry => entry.id === prefix + 29));
    assert.ok(!feed.items.some(entry => entry.id === prefix + 30));
  });
}

test('active announcement links remain accessible alongside full activity and reminder pages', async () => {
  const activity = Array.from({ length: 35 }, (_, i) => ({
    ...item('activity-' + i),
    at: '2099-01-01T00:00:00Z',
  }));
  const announcements = Array.from({ length: 20 }, (_, i) => item('announcement-' + i));
  const feed = await loadNotificationFeed({ personId: 'owner', items: activity }, [
    { name: 'announcements', load: async () => announcements },
    { name: 'certifications', load: async () => [item('cert-expiry-1')] },
  ]);
  assert.equal(feed.items.filter(i => i.id.startsWith('announcement-')).length, 20);
  assert.ok(feed.items.some(i => i.id === 'cert-expiry-1'));
  assert.equal(feed.items.length, 51);
});
