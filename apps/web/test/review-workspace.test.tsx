import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reviewView } from '../src/review-navigation';
test('unified review navigation keeps earlier type links and routes analytics and recommendation notifications', () => {
  for (const type of ['skills', 'certifications', 'all'])
    assert.equal(reviewView(new URLSearchParams({ type })), 'queue');
  assert.equal(reviewView(new URLSearchParams('type=certifications&tab=analytics')), 'team');
  assert.equal(reviewView(new URLSearchParams('tab=team')), 'team');
  assert.equal(
    reviewView(
      new URLSearchParams('type=certifications&tab=recommendations&recommendation=fixture'),
    ),
    'recommendations',
  );
  assert.equal(reviewView(new URLSearchParams('tab=unknown')), 'queue');
});
test('manager workspace integrates linked reviews and credential panels without separate type tabs', async () => {
  const source = await readFile(new URL('../src/ReviewWorkspace.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /aria-label="Review type"|review-type-tabs/);
  assert.match(source, /CapabilitySubmissions review showEmpty/);
  assert.match(source, /teamContent=/);
  assert.match(source, /recommendationContent=/);
  assert.match(source, /Assigned certification analytics/);
});
