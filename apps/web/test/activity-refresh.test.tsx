import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startActivityRefresh } from '../src/activity-refresh';
const settle = () => new Promise(resolve => setImmediate(resolve));
function environment() {
  let time = 0;
  return {
    window: new EventTarget(),
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
test('idle time makes no requests; activity and focus refresh only when stale', async () => {
  const env = environment();
  let calls = 0;
  const stop = startActivityRefresh(
    async () => {
      calls++;
    },
    ['changed'],
    env,
  );
  await settle();
  assert.equal(calls, 1);
  env.advance(3_600_000);
  await settle();
  assert.equal(calls, 1);
  env.document.dispatchEvent(new Event('pointerdown'));
  await settle();
  assert.equal(calls, 2);
  env.document.dispatchEvent(new Event('keydown'));
  env.window.dispatchEvent(new Event('focus'));
  await settle();
  assert.equal(calls, 2);
  env.advance(60_000);
  env.window.dispatchEvent(new Event('focus'));
  await settle();
  assert.equal(calls, 3);
  stop();
  env.window.dispatchEvent(new Event('changed'));
  await settle();
  assert.equal(calls, 3);
});
test('concurrent mutation events coalesce but still recheck after in-flight response', async () => {
  const env = environment();
  let calls = 0,
    release: () => void = () => {};
  const stop = startActivityRefresh(
    async () => {
      calls++;
      if (calls === 1)
        await new Promise<void>(resolve => {
          release = resolve;
        });
    },
    ['changed'],
    env,
  );
  await settle();
  env.window.dispatchEvent(new Event('changed'));
  env.window.dispatchEvent(new Event('changed'));
  await settle();
  assert.equal(calls, 1);
  release();
  await settle();
  assert.equal(calls, 2);
  stop();
});
test('hidden tabs do not query; deferred changes refresh when visible again', async () => {
  const env = environment();
  let calls = 0;
  const stop = startActivityRefresh(
    async () => {
      calls++;
    },
    ['changed'],
    env,
  );
  await settle();
  env.document.visibilityState = 'hidden';
  env.window.dispatchEvent(new Event('changed'));
  env.window.dispatchEvent(new Event('focus'));
  await settle();
  assert.equal(calls, 1);
  env.document.visibilityState = 'visible';
  env.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(calls, 2);
  stop();
});
test('failed refresh does not start a retry loop and cleanup suppresses queued work', async () => {
  const env = environment();
  let calls = 0;
  const stop = startActivityRefresh(
    async () => {
      calls++;
      throw Error('offline');
    },
    ['changed'],
    env,
  );
  await settle();
  env.advance(3_600_000);
  await settle();
  assert.equal(calls, 1);
  stop();
  env.window.dispatchEvent(new Event('changed'));
  await settle();
  assert.equal(calls, 1);
});
function timedEnvironment() {
  const env = environment();
  let id = 0,
    cancels = 0;
  const tasks = new Map<number, { at: number; callback: () => void }>();
  return {
    ...env,
    schedule: (callback: () => void, ms: number) => {
      const key = ++id;
      tasks.set(key, { at: env.now() + ms, callback });
      return key;
    },
    cancel: (key: unknown) => {
      cancels++;
      tasks.delete(key as number);
    },
    pending: () => tasks.size,
    schedules: () => id,
    cancellations: () => cancels,
    tick: async (ms: number) => {
      const end = env.now() + ms;
      for (;;) {
        const next = [...tasks.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        env.advance(next[1].at - env.now());
        tasks.delete(next[0]);
        next[1].callback();
        await settle();
      }
      env.advance(end - env.now());
      await settle();
    },
  };
}
test('adaptive timer refreshes active users then stops entirely after idle timeout', async () => {
  const env = timedEnvironment();
  let calls = 0;
  const modes: string[] = [];
  const stop = startActivityRefresh(
    async () => {
      calls++;
    },
    ['changed'],
    env,
    { pollMs: 90_000, onStatus: s => modes.push(s.mode) },
  );
  await settle();
  await env.tick(90_000);
  assert.equal(calls, 2);
  await env.tick(30_000);
  assert.equal(modes.at(-1), 'idle');
  assert.equal(env.pending(), 0);
  await env.tick(3_600_000);
  assert.equal(calls, 2);
  env.document.dispatchEvent(new Event('pointerdown'));
  await settle();
  assert.equal(calls, 3);
  assert.equal(modes.at(-1), 'live');
  stop();
  assert.equal(env.pending(), 0);
});

test('scroll storms reuse one timer while extending idle time without additional network reads', async () => {
  const env = timedEnvironment();
  let calls = 0;
  const modes: string[] = [];
  const stop = startActivityRefresh(
    async () => {
      calls++;
    },
    [],
    env,
    { pollMs: 300_000, onStatus: status => modes.push(status.mode) },
  );
  await settle();
  for (let i = 0; i < 1000; i++) {
    env.advance(1);
    env.document.dispatchEvent(new Event('scroll'));
  }
  assert.equal(env.schedules(), 1);
  assert.equal(env.cancellations(), 0);
  assert.equal(env.pending(), 1);
  assert.equal(calls, 1);
  await env.tick(119_000);
  assert.equal(modes.at(-1), 'live');
  assert.equal(env.pending(), 1);
  await env.tick(1_000);
  assert.equal(modes.at(-1), 'idle');
  assert.equal(env.pending(), 0);
  assert.equal(calls, 1);
  stop();
});
test('background tabs cancel timers and resume with a fresh check on return', async () => {
  const env = timedEnvironment();
  let calls = 0;
  const stop = startActivityRefresh(
    async () => {
      calls++;
    },
    [],
    env,
    { pollMs: 90_000 },
  );
  await settle();
  env.window.dispatchEvent(new Event('blur'));
  assert.equal(env.pending(), 0);
  await env.tick(180_000);
  assert.equal(calls, 1);
  env.window.dispatchEvent(new Event('focus'));
  await settle();
  assert.equal(calls, 2);
  stop();
});
test('failure backoff survives interaction storms, timestamps update only after success', async () => {
  const env = timedEnvironment();
  let calls = 0;
  const checked: (number | null)[] = [];
  const stop = startActivityRefresh(
    async () => {
      calls++;
      return calls > 2;
    },
    ['changed'],
    env,
    { pollMs: 90_000, onStatus: s => checked.push(s.checkedAt) },
  );
  await settle();
  await env.tick(30_000);
  env.window.dispatchEvent(new Event('changed'));
  env.document.dispatchEvent(new Event('pointerdown'));
  await settle();
  assert.equal(calls, 1);
  assert.equal(checked.at(-1), null);
  await env.tick(60_000);
  assert.equal(calls, 2);
  for (let i = 0; i < 3; i++) {
    await env.tick(30_000);
    env.document.dispatchEvent(new Event('keydown'));
    await settle();
  }
  assert.equal(calls, 2);
  await env.tick(30_000);
  assert.equal(calls, 3);
  assert.equal(checked.at(-1), 210_000);
  stop();
});
