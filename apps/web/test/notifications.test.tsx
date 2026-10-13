import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationDestination, notificationDay } from '../src/notification-model';
test('notification actions target implemented internal destinations without granting workflow actions', () => {
  assert.equal(notificationDestination('/requests?record=123')?.label, 'View request');
  assert.equal(
    notificationDestination('/learning?tab=recommendations&recommendation=123&direction=sent')
      ?.label,
    'Open recommendation',
  );
  assert.equal(notificationDestination('/skill-reviews?claim=123')?.kind, 'Skills & reviews');
  assert.equal(
    notificationDestination('/certifications?tab=recommendations&recommendation=123')?.label,
    'Open certification recommendation',
  );
  assert.equal(
    notificationDestination(
      '/skill-reviews?type=certifications&tab=recommendations&recommendation=123',
    )?.label,
    'Open certification recommendation',
  );
  assert.equal(notificationDestination('/my-skills?claim=123')?.label, 'View skill claim');
  assert.equal(notificationDestination('/profile')?.label, 'View profile');
});
test('combined outcomes, catalogue requests and renewal updates have distinct actionable destinations', () => {
  assert.equal(notificationDestination('/my-skills?submission=123')?.label, 'View review outcome');
  assert.equal(
    notificationDestination('/skill-reviews?submission=123')?.label,
    'Open review request',
  );
  assert.equal(notificationDestination('/skills?tab=amendments')?.label, 'View catalogue request');
  assert.equal(notificationDay('invalid'), 'Earlier updates');
  const now = new Date(2026, 9, 13, 12);
  assert.equal(notificationDay(new Date(2026, 9, 13, 1).toISOString(), now), 'Today');
  assert.equal(notificationDay(new Date(2026, 9, 12, 23).toISOString(), now), 'Yesterday');
});
test('notification actions reject external, protocol relative and unsupported destinations', () => {
  for (const href of [
    'https://example.com',
    '//example.com',
    'javascript:alert(1)',
    '/unknown',
    '/requests\\evil',
    '/requests/other',
  ])
    assert.equal(notificationDestination(href), undefined);
});

test('control characters cannot turn an internal notification into an external redirect', () => {
  for (const href of [
    '/\n/example.com/profile',
    '/\t/example.com/requests',
    '/\r/example.com/learning',
    '/profile\u0000',
  ])
    assert.equal(notificationDestination(href), undefined);
});
