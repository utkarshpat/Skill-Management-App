import test from 'node:test';
import assert from 'node:assert/strict';
import { BusinessDraftHandoff } from '../src/business/business-draft-handoff';
import { businessFilters, updateBusinessFilters } from '../src/business/business-model';
import { personalNavigationItems, isSupportedWorkspacePath } from '../src/WorkspaceNavigation';
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
test('business sidebar discovery uses canonical capability projections and supports manager amendment-only access', () => {
  assert.ok(
    !personalNavigationItems({ ownProfile: true, ownSkills: true }).some(
      i => i.href === '/business',
    ),
  );
  for (const capabilities of [
    { businessOperations: true },
    { businessAdministration: true },
    { amendments: true },
  ])
    assert.ok(
      personalNavigationItems(
        { ownProfile: true, ownSkills: true, ...capabilities },
        '/business',
      ).some(i => i.href === '/business' && i.active),
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
