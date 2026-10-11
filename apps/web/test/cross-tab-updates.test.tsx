import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subscribeWorkspaceUpdates } from '../src/cross-tab-updates';

test('committed changes notify same-person tabs once without echoing or crossing identities', async () => {
  const tabs = [new EventTarget(), new EventTarget(), new EventTarget()];
  const channels: {
    onmessage: BroadcastChannel['onmessage'];
    postMessage: (data: unknown) => void;
    close: () => void;
  }[] = [];
  let sent = 0;
  const createChannel = () => {
    const channel = {
      onmessage: null as BroadcastChannel['onmessage'],
      postMessage(data: unknown) {
        sent++;
        for (const other of channels)
          if (other !== channel)
            other.onmessage?.call(other as BroadcastChannel, { data } as MessageEvent);
      },
      close() {
        channels.splice(channels.indexOf(channel), 1);
      },
    };
    channels.push(channel);
    return channel;
  };
  const received = [0, 0, 0];
  tabs.forEach((tab, index) =>
    tab.addEventListener('notifications-remote-updated', () => received[index]++),
  );
  const stops = tabs.map((tab, index) =>
    subscribeWorkspaceUpdates(index === 2 ? 'other-person' : 'same-person', tab, createChannel),
  );
  tabs[0].dispatchEvent(new Event('notifications-updated'));
  tabs[0].dispatchEvent(new Event('own-skills-updated'));
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(sent, 1);
  assert.deepEqual(received, [0, 1, 0]);
  stops.forEach(stop => stop());
  tabs[0].dispatchEvent(new Event('notifications-updated'));
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(sent, 1);
  assert.equal(channels.length, 0);
});
