import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssistantSession } from '../src/assistant-session';
test('collapse preserves an in-flight chat and reopening resumes without restarting', () => {
  const session = new AssistantSession();
  assert.equal(session.open(), false);
  const request = session.epoch;
  session.collapse();
  assert.deepEqual(session.completion(request), { current: true, notify: true });
  assert.equal(session.open(), false);
  assert.deepEqual(session.completion(request), { current: true, notify: false });
});
test('close starts a new chat on the next opening and late replies cannot enter it', () => {
  const session = new AssistantSession();
  session.open();
  const request = session.epoch;
  session.close();
  assert.deepEqual(session.completion(request), { current: true, notify: true });
  assert.equal(session.open(), true);
  session.newConversation();
  assert.deepEqual(session.completion(request), { current: false, notify: true });
  assert.equal(session.open(), false);
});
test('separate widget sessions cannot share UI lifecycle or request epochs', () => {
  const first = new AssistantSession(),
    second = new AssistantSession();
  first.open();
  first.close();
  first.newConversation();
  assert.equal(second.restartOnOpen, false);
  assert.equal(second.epoch, 0);
  assert.equal(second.visible, false);
});
