import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { BusinessRecordDate } from '../src/business/BusinessRecordDate';
import { BusinessDraftHandoff } from '../src/business/business-draft-handoff';
import {
  businessFilters,
  updateBusinessFilters,
  businessCoverageRows,
  businessPeriod,
  businessPeoplePage,
} from '../src/business/business-model';
import { personalNavigationItems, isSupportedWorkspacePath } from '../src/WorkspaceNavigation';

test('activity presets use UTC year and day boundaries, including positive-offset New Year', () => {
  const now = new Date('2026-01-01T00:30:00+05:30');
  assert.deepEqual(businessPeriod('ytd', now), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(businessPeriod('ytd', new Date('2026-10-13T10:00:00Z')), {
    from: '2026-01-01',
    to: '2026-10-13',
  });
  assert.deepEqual(businessPeriod('30', new Date('2026-03-01T00:00:00Z')), {
    from: '2026-01-30',
    to: '2026-03-01',
  });
  assert.deepEqual(businessPeriod('all', now), { from: '', to: '' });
});

test('people comparison ranks only supplied page rows without mutating the server page', () => {
  const rows = [
    { employee: 'First alphabetically', currentCertifications: 1, reviewedSkills: 2 },
    { employee: 'Current page holder', currentCertifications: 3, reviewedSkills: 1 },
    { employee: 'Tie with more skills', currentCertifications: 3, reviewedSkills: 4 },
  ];
  assert.deepEqual(
    businessPeoplePage(rows).map(row => row.employee),
    ['Tie with more skills', 'Current page holder', 'First alphabetically'],
  );
  assert.equal(rows[0].employee, 'First alphabetically');
});
test('business record dates show readable dates and escaped attribution only for an existing event', () => {
  const html = renderToStaticMarkup(<BusinessRecordDate value="2026-10-11" by="Reviewer <QA>" />);
  assert.match(html, /11 Oct 2026/);
  assert.match(html, /<small>by Reviewer &lt;QA&gt;<\/small>/);
  for (const value of [null, 'invalid']) {
    const pending = renderToStaticMarkup(
      <BusinessRecordDate value={value} by="Assigned manager" />,
    );
    assert.doesNotMatch(pending, /Assigned manager|by /);
    assert.match(pending, /—/);
  }
});
test('business deep-link filters are bounded to recognized keys and reset pagination on filter changes', () => {
  const params = new URLSearchParams(
    'dataset=certifications&page=3&validity=EXPIRED&actorId=forged&tab=insights',
  );
  assert.equal(businessFilters(params).has('actorId'), false);
  assert.equal(updateBusinessFilters(params, { issuer: 'Microsoft' }).has('page'), false);
  assert.equal(updateBusinessFilters(params, { page: '4' }).get('page'), '4');
  assert.equal(isSupportedWorkspacePath('/business'), true);
  const sorted = new URLSearchParams('dataset=certifications&sort=expiry_asc');
  assert.equal(updateBusinessFilters(sorted, { dataset: 'people' }).has('sort'), false);
  assert.equal(
    updateBusinessFilters(sorted, { dataset: 'skills', sort: 'name_asc' }).get('sort'),
    'name_asc',
  );
});
test('business sidebar requires analytics; administration and amendment-only access stay in their own workspaces', () => {
  assert.ok(
    !personalNavigationItems({ ownProfile: true, ownSkills: true }).some(
      i => i.href === '/business',
    ),
  );
  for (const capabilities of [
    { businessOperations: true },
    { businessOperations: true, businessAdministration: true },
  ])
    assert.ok(
      personalNavigationItems(
        { ownProfile: true, ownSkills: true, ...capabilities },
        '/business',
      ).some(i => i.href === '/business' && i.active),
    );
  assert.ok(
    !personalNavigationItems({
      ownProfile: true,
      ownSkills: true,
      businessAdministration: true,
    }).some(i => i.href === '/business'),
  );
  assert.ok(
    !personalNavigationItems(
      { ownProfile: true, ownSkills: true, amendments: true },
      '/business',
    ).some(i => i.href === '/business'),
  );
});
test('business AI handoff is single-use, actor-bound, expiring and cleared on sign-out', () => {
  const handoff = new BusinessDraftHandoff(),
    draft = {
      kind: 'demand_draft' as const,
      title: 'Cloud delivery',
      body: 'Reviewed cloud capability needed',
      summary: 'Staffing proposal',
    };
  const ticket = handoff.offer('actor', draft, 1000);
  assert.equal(handoff.take('other', ticket, 1001), undefined);
  assert.equal(handoff.take('actor', ticket, 1002), undefined);
  const next = handoff.offer('actor', draft, 1000);
  assert.equal(handoff.take('actor', next, 301000), undefined);
  const valid = handoff.offer('actor', draft, 1000);
  assert.deepEqual(handoff.take('actor', valid, 1001), draft);
  assert.equal(handoff.take('actor', valid, 1002), undefined);
  const cleared = handoff.offer('actor', draft, 1000);
  handoff.clear();
  assert.equal(handoff.take('actor', cleared, 1001), undefined);
});

test('coverage keeps reused names separate and renamed snapshots under the same skill ID', () => {
  const rows = businessCoverageRows([
    { id: 'original', label: 'Cloud', rank: 2, holders: 3 },
    { id: 'replacement', label: 'Cloud', rank: 2, holders: 1 },
    { id: 'original', label: 'Renamed Cloud', rank: 3, holders: 2 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cells.get(2)?.holders, 3);
  assert.equal(rows[0].cells.get(3)?.id, 'original');
  assert.equal(rows[1].cells.get(2)?.id, 'replacement');
  assert.equal(rows[1].cells.get(3), undefined);
});
