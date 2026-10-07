import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LearningDraftHandoff } from '../src/learning-draft-handoff';
const draft = { title: 'Azure', goal: 'Deploy an API', steps: ['Practice'] };
test('handoff is actor-bound, single-use and never readable by another account', () => {
  const store = new LearningDraftHandoff(),
    ticket = store.offer('alice', draft, 0);
  assert.equal(store.take('bob', ticket, 1), undefined);
  assert.equal(store.take('alice', ticket, 2), undefined);
  const next = store.offer('alice', draft, 0);
  assert.deepEqual(store.take('alice', next, 1), draft);
  assert.equal(store.take('alice', next, 2), undefined);
});
test('handoff rejects incorrect tickets, expiry and sign-out clearing', () => {
  const store = new LearningDraftHandoff();
  store.offer('alice', draft, 0);
  assert.equal(store.take('alice', 'wrong', 1), undefined);
  const expired = store.offer('alice', draft, 0);
  assert.equal(store.take('alice', expired, 300_000), undefined);
  const cleared = store.offer('alice', draft, 0);
  store.clear();
  assert.equal(store.take('alice', cleared, 1), undefined);
});
test('handoff takes a snapshot of the reviewed draft', () => {
  const store = new LearningDraftHandoff(),
    input = structuredClone(draft),
    ticket = store.offer('alice', input, 0);
  input.steps[0] = 'Changed';
  assert.deepEqual(store.take('alice', ticket, 1), draft);
});
