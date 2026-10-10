import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedDatabasePool } from '../src/shared/shared-database-pool.js';

test('concurrent callers share one connection; failure is retried only by a later caller', async () => {
  let connects = 0,
    closes = 0;
  const pool = {
    close: async () => {
      closes++;
    },
  };
  const failure = Error('Failed connection');
  const shared = new SharedDatabasePool(async () => {
    connects++;
    if (connects === 1) throw failure;
    return pool;
  });
  const first = shared.get(),
    second = shared.get();
  assert.equal(first, second);
  await assert.rejects(first, error => error === failure);
  assert.equal(connects, 1);
  const results = await Promise.all([shared.get(), shared.get(), shared.get()]);
  assert.deepEqual(results, [pool, pool, pool]);
  assert.equal(connects, 2);
  assert.equal(await shared.get(), pool);
  await shared.close();
  assert.equal(closes, 1);
});

test('failure of a closing connection cannot evict its replacement', async () => {
  let rejectFirst!: (reason: Error) => void,
    connects = 0,
    closes = 0;
  const replacement = {
    close: async () => {
      closes++;
    },
  };
  const shared = new SharedDatabasePool(() => {
    connects++;
    return connects === 1
      ? new Promise<typeof replacement>((_resolve, reject) => {
          rejectFirst = reject;
        })
      : Promise.resolve(replacement);
  });
  const first = shared.get();
  const closing = shared.close();
  const failure = Error('Detached connection failed');
  const firstFailed = assert.rejects(first, error => error === failure);
  const closeFailed = assert.rejects(closing, error => error === failure);
  assert.equal(await shared.get(), replacement);
  rejectFirst(failure);
  await Promise.all([firstFailed, closeFailed]);
  assert.equal(await shared.get(), replacement);
  assert.equal(connects, 2);
  await shared.close();
  assert.equal(closes, 1);
});

test('a closing connection that succeeds is closed without closing its replacement', async () => {
  let resolveFirst!: (value: { close(): Promise<void> }) => void;
  let connects = 0,
    oldCloses = 0,
    newCloses = 0;
  const oldPool = {
    close: async () => {
      oldCloses++;
    },
  };
  const replacement = {
    close: async () => {
      newCloses++;
    },
  };
  const shared = new SharedDatabasePool(() =>
    ++connects === 1
      ? new Promise<typeof oldPool>(resolve => {
          resolveFirst = resolve;
        })
      : Promise.resolve(replacement),
  );
  const first = shared.get();
  const closing = shared.close();
  assert.equal(await shared.get(), replacement);
  resolveFirst(oldPool);
  await first;
  await closing;
  assert.equal(oldCloses, 1);
  assert.equal(newCloses, 0);
  assert.equal(await shared.get(), replacement);
  await shared.close();
  assert.equal(newCloses, 1);
});
