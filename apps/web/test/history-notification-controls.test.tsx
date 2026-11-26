import './support/phase-two';
import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { component, MemoryRouter, refreshDevelopmentLogin, click } from './support/interactions';
const { ReviewHistory } = component<typeof import('../src/ReviewHistory')>('ReviewHistory.tsx');
const { Notifications } = component<typeof import('../src/Notifications')>('Notifications.tsx');
const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: window.localStorage,
});
let view: Awaited<ReturnType<typeof render>> | undefined;
let failure = 0,
  empty = false,
  partial = false,
  reads: string[] = [];
let expiryReminders = false;
const entries = [
  {
    revision: 5,
    action: 'claim.approved',
    at: '2026-11-08T10:00:00Z',
    actorName: 'Rohan Mehta',
    feedback: 'A'.repeat(650) + 'B'.repeat(650) + 'Reviewed delivery evidence.',
  },
  {
    revision: 4,
    action: 'claim.changes_requested',
    at: '2026-11-07T10:00:00Z',
    actorName: 'Rohan Mehta',
    feedback: '',
  },
  {
    revision: 3,
    action: 'claim.submitted',
    at: '2026-11-06T10:00:00Z',
    actorName: 'Aditi Menon',
    feedback: 'Original submission',
  },
];
beforeEach(async () => {
  failure = 0;
  empty = false;
  partial = false;
  expiryReminders = false;
  reads = [];
  window.localStorage.clear();
  mock.method(document, 'hasFocus', () => true);
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    reads.push(url);
    if (
      expiryReminders &&
      (url === '/api/notifications' || url === '/api/notifications?reminderPage=2')
    ) {
      const first = url === '/api/notifications';
      return Response.json({
        personId: 'aditi',
        hasMoreReminders: first,
        items: Array.from({ length: first ? 30 : 1 }, (_, index) => {
          const number = first ? index + 1 : 31;
          return {
            id: 'cert-expiry-direct-report-' + number,
            at: '2026-11-08T10:00:00Z',
            title: 'Expiry reminder ' + number,
            body: 'Credential expires soon.',
            href: '/skill-reviews?tab=team&person=2b5a1c9e-1111-4a2b-8c3d-000000000031',
          };
        }),
      });
    }
    if (failure)
      return Response.json(
        { error: { message: 'Current activity access denied' } },
        { status: failure },
      );
    if (url.startsWith('/api/skill-reviews/')) {
      const page = Number(new URL(url, 'http://localhost').searchParams.get('page'));
      return Response.json({
        history: empty ? [] : entries.slice((page - 1) * 2, page * 2),
        total: empty ? 0 : 3,
        pageSize: 2,
      });
    }
    if (url === '/api/notifications')
      return Response.json({
        personId: 'aditi',
        partial,
        items: empty
          ? []
          : [
              {
                id: 'request',
                at: '2026-11-08T10:00:00Z',
                title: 'Request updated',
                body: 'Your reporting request has a new comment.',
                href: '/requests?record=r1',
                actorName: 'Rohan Mehta',
                subject: 'Reporting assignment',
              },
              {
                id: 'learning',
                at: '2026-11-07T10:00:00Z',
                title: 'Learning plan updated',
                body: 'Review your next learning task.',
                href: '/learning?tab=paths&openPlan=p1',
              },
            ],
      });
    throw Error('Unexpected history request ' + url);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(async () => {
  if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  await closeBrowser();
});

test('approval history pages through authorized events and long feedback without exposing private edits', async () => {
  view = await render(<ReviewHistory id="aditi-sql" />);
  await settle();
  assert.match(document.body.textContent!, /Approved/);
  assert.equal(document.querySelector('.claim-level-description')!.textContent, 'A'.repeat(650));
  await click('More feedback');
  assert.equal(document.querySelector('.claim-level-description')!.textContent, 'B'.repeat(650));
  await click('More feedback');
  assert.equal(
    document.querySelector('.claim-level-description')!.textContent,
    'Reviewed delivery evidence.',
  );
  await click('Previous feedback');
  await click('Older');
  assert.match(document.body.textContent!, /Changes requested/);
  assert.match(document.body.textContent!, /No decision feedback/);
  await click('Older');
  assert.ok(reads.some(url => url.endsWith('page=2')));
  assert.match(document.body.textContent!, /Original submission/);
  await click('Newer');
  assert.match(document.body.textContent!, /Changes requested/);
  await click('Newer');
  assert.equal(document.querySelector('.claim-level-description')!.textContent, 'A'.repeat(650));
  assert.match(document.body.textContent!, /Employee draft edits are private/);
});

test('approval history denial retries explicitly and an empty history never invents an event', async () => {
  failure = 403;
  view = await render(<ReviewHistory id="aditi-sql" />);
  await settle();
  assert.match(document.body.textContent!, /Current activity access denied/);
  assert.equal(document.querySelector('.review-event'), null);
  failure = 0;
  empty = true;
  await click('Retry');
  assert.match(document.body.textContent!, /No submission or decision events/);
  assert.equal(document.querySelector('.catalogue-pagination'), null);
});

test('notifications retain per-person read state, filter categories and allow explicit unread restoration', async () => {
  view = await render(
    <MemoryRouter>
      <Notifications id="test-notifications" />
    </MemoryRouter>,
  );
  await settle();
  await settle();
  assert.ok(document.querySelector('[aria-label="Notifications, 2 unread"]'));
  await click('Mark read', document.querySelector('.notification-item-actions')!);
  assert.deepEqual(JSON.parse(window.localStorage.getItem('skill-notifications-read:aditi')!), [
    'request',
  ]);
  await click('Unread', document.querySelector('[aria-label="Notification filter"]')!);
  assert.equal(document.querySelectorAll('.notification-list li').length, 1);
  assert.match(document.querySelector('.notification-list')!.textContent!, /Learning plan updated/);
  await click('Read all');
  assert.match(document.body.textContent!, /No unread notifications/);
  await click('View all updates');
  await click('Mark unread', document.querySelector('.notification-item-actions')!);
  assert.ok(document.querySelector('[aria-label="Notifications, 1 unread"]'));
  const category = document.querySelector('[aria-label="Notification category"]')!;
  const choose = [...category.querySelectorAll<HTMLButtonElement>('button')].find(
    b => b.textContent !== 'All updates',
  )!;
  await act(async () => choose.click());
  assert.equal(document.querySelectorAll('.notification-list li').length, 1);
  await click('All updates', category);
  assert.equal(document.querySelectorAll('.notification-list li').length, 2);
});

test('manager expiry reminder opens the employee and the drawer reaches reminder 31', async () => {
  expiryReminders = true;
  view = await render(
    <MemoryRouter>
      <Notifications id="test-reminders" />
    </MemoryRouter>,
  );
  await settle();
  await settle();
  assert.equal(document.querySelectorAll('.notification-list li').length, 30);
  const reviewLinks = [
    ...document.querySelectorAll(
      'a[href="/skill-reviews?tab=team&person=2b5a1c9e-1111-4a2b-8c3d-000000000031"]',
    ),
  ];
  assert.ok(reviewLinks.some(link => link.textContent?.includes('View employee')));
  assert.ok(document.querySelector('[aria-label="Notifications, 30 unread"]'));
  await click('More reminders');
  await settle();
  // The badge keeps first-page unread updates while a later page is shown.
  assert.ok(document.querySelector('[aria-label="Notifications, 30 unread"]'));
  await click('Read all on this page');
  assert.ok(document.querySelector('[aria-label="Notifications, 30 unread"]'));
  assert.ok(reads.includes('/api/notifications?reminderPage=2'));
  assert.match(
    document.querySelector('.notification-list')?.textContent ?? '',
    /Expiry reminder 31/,
  );
  assert.equal(document.querySelectorAll('.notification-list li').length, 1);
  await click('Previous reminders');
  await settle();
  assert.equal(document.querySelectorAll('.notification-list li').length, 30);
});

test('read marks beyond the first hundred stay read', async () => {
  window.localStorage.setItem(
    'skill-notifications-read:aditi',
    JSON.stringify(['request', ...Array.from({ length: 150 }, (_, index) => 'old-' + index)]),
  );
  view = await render(
    <MemoryRouter>
      <Notifications id="test-notifications" />
    </MemoryRouter>,
  );
  await settle();
  assert.ok(document.querySelector('[aria-label="Notifications, 1 unread"]'));
});

test('notification refresh keeps session read marks when storage writes fail', async t => {
  const write = t.mock.fn(() => {
    throw Error('Storage unavailable');
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: window.localStorage.getItem.bind(window.localStorage), setItem: write },
  });
  t.after(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: window.localStorage,
    });
  });
  view = await render(
    <MemoryRouter>
      <Notifications id="test-notifications" />
    </MemoryRouter>,
  );
  await settle();
  await click('Mark read', document.querySelector('.notification-item-actions')!);
  assert.ok(write.mock.callCount() > 0);
  assert.ok(document.querySelector('[aria-label="Notifications, 1 unread"]'));
  await click('Refresh notifications');
  await settle();
  assert.ok(document.querySelector('[aria-label="Notifications, 1 unread"]'));
});

test('notification storage synchronization is isolated to the current person and denied refresh clears content', async () => {
  window.localStorage.setItem('skill-notifications-read:aditi', '[7,"request"]');
  view = await render(
    <MemoryRouter>
      <Notifications id="test-notifications" />
    </MemoryRouter>,
  );
  await settle();
  assert.ok(document.querySelector('[aria-label="Notifications, 1 unread"]'));
  window.localStorage.setItem('skill-notifications-read:aditi', '["request","learning"]');
  await act(async () =>
    window.dispatchEvent(
      new window.StorageEvent('storage', { key: 'skill-notifications-read:another-person' }),
    ),
  );
  assert.ok(document.querySelector('[aria-label="Notifications, 1 unread"]'));
  await act(async () =>
    window.dispatchEvent(
      new window.StorageEvent('storage', { key: 'skill-notifications-read:aditi' }),
    ),
  );
  assert.ok(document.querySelector('button[aria-label="Notifications"]'));
  failure = 403;
  await click('Refresh notifications');
  assert.match(document.body.textContent!, /Current activity access denied/);
  assert.equal(document.querySelector('.notification-list'), null);
  failure = 0;
  empty = true;
  await click('Retry');
  assert.match(document.body.textContent!, /No notifications yet/);
});

test('workspace access changes refresh notifications and clear old module links', async () => {
  view = await render(
    <MemoryRouter>
      <Notifications id="test-notifications" />
    </MemoryRouter>,
  );
  await settle();
  assert.match(document.body.textContent!, /Request updated|Learning plan updated/);
  const previousReads = reads.length;
  empty = true;
  await act(async () => {
    window.dispatchEvent(new window.Event('workspace-access-updated'));
  });
  assert.ok(reads.length > previousReads);
  assert.doesNotMatch(document.body.textContent!, /Request updated|Learning plan updated/);
});

test('partial notification feed reports incomplete data without treating it as an empty success', async () => {
  partial = true;
  window.localStorage.setItem('skill-notifications-read:aditi', 'invalid-json');
  view = await render(
    <MemoryRouter>
      <Notifications id="test-notifications" />
    </MemoryRouter>,
  );
  await settle();
  assert.match(document.body.textContent!, /Some updates could not be loaded/);
  assert.ok(document.querySelector('[aria-label="Notifications, 2 unread"]'));
  assert.equal(document.querySelectorAll('.notification-list li').length, 2);
});
