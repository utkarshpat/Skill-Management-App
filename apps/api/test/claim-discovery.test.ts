import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimCategory, claimResultSize } from '../src/modules/skills/claims.js';
test('claim discovery rejects repeated query parameters and unbounded result sizes', () => {
  assert.equal(claimCategory(undefined), '');
  assert.equal(claimCategory(' Programming '), 'Programming');
  assert.equal(claimResultSize(undefined), 25);
  assert.equal(claimResultSize('3'), 3);
  for (const value of [['Programming'], {}, 'x'.repeat(81)])
    assert.throws(() => claimCategory(value));
  for (const value of [null, [], ['3'], 0, 26, 1.5, 'Infinity', 'NaN'])
    assert.throws(() => claimResultSize(value));
});
