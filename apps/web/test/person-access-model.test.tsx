import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exceptionPermissions,
  exceptionSelection,
  exceptionExpiry,
  localDate,
  templateAssignable,
} from '../src/person-access-model';
const catalogue = [
  { code: 'profile.view', label: 'Profile', implemented: true, scopes: ['OWN'] as const },
  { code: 'users.manage', label: 'People', implemented: true, scopes: ['ORGANIZATION'] as const },
  { code: 'reports.view', label: 'Bound analytics', implemented: true, scopes: [] },
  { code: 'future', label: 'Unavailable', implemented: false, scopes: ['OWN'] as const },
  { code: 'missing', label: 'Missing metadata' },
] as any;
test('direct exception choices fail closed and never infer bound or unavailable actions', () => {
  assert.deepEqual(
    exceptionPermissions(catalogue).map(p => p.code),
    ['profile.view', 'users.manage'],
  );
  assert.deepEqual(
    exceptionPermissions([
      { code: 'bad', label: 'bad', implemented: true, scopes: ['PROJECT'] as any },
    ]),
    [],
  );
  const first = exceptionSelection(catalogue, 'profile.view', 'ORGANIZATION');
  assert.equal(first.permission?.code, 'profile.view');
  assert.equal(first.scope, 'OWN');
  assert.equal(exceptionSelection(catalogue, 'users.manage', 'OWN').scope, 'ORGANIZATION');
  assert.equal(
    exceptionSelection(catalogue, 'reports.view', 'ORGANIZATION').permission?.code,
    'profile.view',
  );
  assert.equal(exceptionSelection([], 'profile.view', 'OWN').scope, undefined);
});
test('catalogue updates normalize a stale selection without preserving an unsupported scope', () => {
  const updated = [
    { code: 'skill.view', label: 'Skills', implemented: true, scopes: ['OWN'] as any },
  ];
  assert.equal(exceptionSelection(updated, 'users.manage', 'ORGANIZATION').scope, 'OWN');
  assert.equal(
    exceptionSelection(updated, 'users.manage', 'ORGANIZATION').permission?.code,
    'skill.view',
  );
});
test('historical unsupported templates cannot be offered as new assignments', () => {
  assert.equal(templateAssignable([{ permission: 'profile.view', scope: 'OWN' }], catalogue), true);
  assert.equal(
    templateAssignable([{ permission: 'profile.view', scope: 'ORGANIZATION' }], catalogue),
    false,
  );
  assert.equal(templateAssignable([{ permission: 'future', scope: 'OWN' }], catalogue), false);
  assert.equal(
    templateAssignable([{ permission: 'reports.view', scope: 'ORGANIZATION' }], catalogue),
    false,
  );
});
test('expiry uses the chosen local end of day in India and across a daylight-saving transition', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['Asia/Kolkata', 'America/New_York', 'UTC']) {
      process.env.TZ = zone;
      const iso = exceptionExpiry('2026-11-12', new Date(2026, 10, 1));
      assert.equal(localDate(new Date(iso)), '2026-11-12');
      assert.equal(new Date(iso).getHours(), 23);
      assert.equal(new Date(iso).getMinutes(), 59);
      const dst = exceptionExpiry('2026-11-01', new Date(2026, 9, 1));
      assert.equal(localDate(new Date(dst)), '2026-11-01');
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
test('invalid calendar dates and elapsed expiries are rejected before preview', () => {
  const now = new Date(2026, 0, 1);
  for (const value of ['', '2026-02-30', '2026-13-01', 'not-a-date', '0001-01-01', '2025-12-31'])
    assert.throws(() => exceptionExpiry(value, now));
  assert.equal(localDate(new Date(exceptionExpiry('2028-02-29', now))), '2028-02-29');
});
