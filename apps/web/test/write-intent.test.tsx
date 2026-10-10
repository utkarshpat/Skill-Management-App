import test from 'node:test';
import assert from 'node:assert/strict';
import { WriteIntent } from '../src/write-intent';
test('double-clicks cannot start concurrent writes and uncertain retries retain their ID', () => {
  let ids = 0;
  const intent = new WriteIntent(() => String(++ids));
  const payload = { recipient: 'A', name: 'Cloud' };
  assert.equal(intent.begin(payload), '1');
  assert.equal(intent.begin(payload), undefined);
  intent.finish(false);
  assert.equal(intent.begin(payload), '1');
  intent.finish(true);
  assert.equal(intent.begin(payload), '2');
  intent.finish(false);
  assert.equal(intent.begin({ ...payload, recipient: 'B' }), '3');
});
