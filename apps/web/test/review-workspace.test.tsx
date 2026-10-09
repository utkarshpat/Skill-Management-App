import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('review workspace offers dedicated skill and certification review tabs', async () => {
  const source = await readFile(new URL('../src/ReviewWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /aria-label="Review type"/);
  assert.match(source, /to="\/skill-reviews\?type=skills"/);
  assert.match(source, /to="\/skill-reviews\?type=certifications"/);
  assert.doesNotMatch(source, /'all'|Skill history & team/);
  assert.match(source, /<h2>Certification reviews<\/h2>/);
  assert.match(source, /Team analytics/);
  assert.match(source, /Recommendations/);
  assert.match(source, /Assigned certification analytics/);
  assert.match(source, /CertificationRecommendations sentOnly/);
  assert.match(source, /Search employee or certification/);
  assert.match(source, /<SkillReviews \/>/);
});
