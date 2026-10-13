import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDemoSessionChanges } from '../src/demo-session-sync';

test('identity switch invalidates other-tab UI once without transmitting identity, credentials or writes', () => {
  let invalidations = 0;
  const sent: unknown[] = [];
  const channel = {
    onmessage: null as BroadcastChannel['onmessage'],
    postMessage: (value: unknown) => sent.push(value),
    close: () => {},
  };
  const sync = connectDemoSessionChanges(
    () => invalidations++,
    () => channel,
  );
  sync.changed();
  assert.deepEqual(sent, ['demo-session-changed']);
  assert.equal(invalidations, 0);
  const deliver = (data: unknown) =>
    channel.onmessage?.call({} as BroadcastChannel, new MessageEvent('message', { data }));
  deliver({ actorId: 'forged', role: 'Admin' });
  assert.equal(invalidations, 0);
  deliver('demo-session-changed');
  deliver('demo-session-changed');
  assert.equal(invalidations, 1);
  assert.equal(sent.length, 1, 'Receivers do not echo or create a reload loop');
  sync.close();
  assert.equal(channel.onmessage, null);
});

test('unsupported browser channel leaves ordinary server-authenticated sign-in usable', () => {
  const sync = connectDemoSessionChanges(
    () => assert.fail('No event should be invented'),
    () => undefined,
  );
  assert.doesNotThrow(() => sync.changed());
  assert.doesNotThrow(() => sync.close());
});
