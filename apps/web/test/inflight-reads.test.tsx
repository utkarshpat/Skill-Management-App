import test from 'node:test';
import assert from 'node:assert/strict';
import { InflightReads } from '../src/inflight-reads';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('streaming downloads consume the original body without retaining an unused copy', async () => {
  for (const consumers of [1, 2]) {
    let original: Response | undefined;
    const reads = new InflightReads(async () => {
      let remaining = 16;
      original = new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (remaining-- > 0) controller.enqueue(new Uint8Array(1024 * 1024));
            else controller.close();
          },
        }),
      );
      return original;
    });
    const responses = await Promise.all(
      Array.from({ length: consumers }, () => reads.fetch('/api/business/export')),
    );
    const sizes = await Promise.all(
      responses.map(async response => {
        const reader = response.body!.getReader();
        let bytes = 0;
        for (;;) {
          const part = await reader.read();
          if (part.done) return bytes;
          bytes += part.value.byteLength;
        }
      }),
    );
    assert.deepEqual(sizes, Array(consumers).fill(16 * 1024 * 1024));
    assert.equal(original!.bodyUsed, true, 'The original stream must be consumed too');
  }
});

test('a cancelled last subscriber does not leave an unread original response', async () => {
  let deliver!: (response: Response) => void;
  const reads = new InflightReads(
    () =>
      new Promise(resolve => {
        deliver = resolve;
      }),
  );
  const abort = new AbortController();
  const active = reads.fetch('/api/file');
  const cancelled = reads.fetch('/api/file', { signal: abort.signal });
  await tick();
  abort.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  const original = new Response('complete');
  deliver(original);
  assert.equal(await (await active).text(), 'complete');
  assert.equal(original.bodyUsed, true);
});

test('a transport that resolves after all subscribers cancel releases its unused stream', async () => {
  let deliver!: (response: Response) => void;
  let released = false;
  const reads = new InflightReads(
    () =>
      new Promise(resolve => {
        deliver = resolve;
      }),
  );
  const abort = new AbortController();
  const pending = reads.fetch('/api/file', { signal: abort.signal });
  await tick();
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  deliver(
    new Response(
      new ReadableStream({
        cancel() {
          released = true;
        },
      }),
    ),
  );
  await tick();
  assert.equal(released, true);
});
function transport() {
  const calls: {
    path: string;
    signal?: AbortSignal | null;
    resolve: (r: Response) => void;
    reject: (e: Error) => void;
  }[] = [];
  const reads = new InflightReads(
    (path, init) =>
      new Promise((resolve, reject) => {
        calls.push({ path: String(path), signal: init?.signal, resolve, reject });
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      }),
  );
  return { calls, reads };
}
test('overlapping identical GETs use one request and independent bodies, with no settled cache', async () => {
  const { reads, calls } = transport();
  const a = reads.fetch('/api/me'),
    b = reads.fetch('/api/me');
  await tick();
  assert.equal(calls.length, 1);
  calls[0].resolve(Response.json({ current: 1 }));
  assert.deepEqual(await (await a).json(), { current: 1 });
  assert.deepEqual(await (await b).json(), { current: 1 });
  const fresh = reads.fetch('/api/me');
  await tick();
  assert.equal(calls.length, 2);
  calls[1].resolve(Response.json({ current: 2 }));
  assert.deepEqual(await (await fresh).json(), { current: 2 });
});
test('consumer cancellation does not cancel another consumer, all cancellations stop transport', async () => {
  const { reads, calls } = transport();
  const first = new AbortController(),
    second = new AbortController();
  const a = reads.fetch('/api/me', { signal: first.signal }),
    b = reads.fetch('/api/me', { signal: second.signal });
  await tick();
  first.abort();
  await assert.rejects(a, { name: 'AbortError' });
  assert.equal(calls[0].signal?.aborted, false);
  calls[0].resolve(Response.json({ ok: true }));
  assert.equal((await b).status, 200);
  const third = new AbortController(),
    c = reads.fetch('/api/me', { signal: third.signal });
  await tick();
  third.abort();
  await assert.rejects(c, { name: 'AbortError' });
  assert.equal(calls[1].signal?.aborted, true);
});
test('tokens, query, transport options and failed reads stay isolated', async () => {
  const { reads, calls } = transport();
  const pending = [
    reads.fetch('/api/me', { headers: { Authorization: 'Bearer A' } }),
    reads.fetch('/api/me', { headers: { Authorization: 'Bearer B' } }),
    reads.fetch('/api/me?other=1'),
    reads.fetch('/api/me', { credentials: 'omit' }),
  ];
  await tick();
  assert.equal(calls.length, 4);
  calls.forEach(call => call.resolve(new Response('ok')));
  await Promise.all(pending);
  const failed = reads.fetch('/api/me');
  await tick();
  calls[4].reject(Error('offline'));
  await assert.rejects(failed, /offline/);
  const retry = reads.fetch('/api/me');
  await tick();
  assert.equal(calls.length, 6);
  calls[5].resolve(new Response('fresh'));
  await retry;
});
test('mutations are never shared and reads after mutation boundaries use a fresh request', async () => {
  const { reads, calls } = transport();
  const old = reads.fetch('/api/me');
  await tick();
  const one = reads.fetch('/api/me', { method: 'POST', body: '{}' }),
    two = reads.fetch('/api/me', { method: 'POST', body: '{}' });
  await tick();
  assert.equal(calls.length, 3);
  const during = reads.fetch('/api/me');
  await tick();
  assert.equal(calls.length, 4);
  calls[1].resolve(Response.json({ saved: true }));
  await one;
  const after = reads.fetch('/api/me');
  await tick();
  assert.equal(calls.length, 5);
  for (const i of [0, 2, 3, 4]) calls[i].resolve(Response.json({ ok: true }));
  await Promise.all([old, two, during, after]);
});
test('an already aborted read never reaches the transport', async () => {
  const { reads, calls } = transport();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(reads.fetch('/api/me', { signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(calls.length, 0);
});

test('sharing response headers does not abort a body that is still streaming', async () => {
  let complete: () => void = () => {};
  const reads = new InflightReads(
    async (_path, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(Error('Body aborted')));
            controller.enqueue(new TextEncoder().encode('first'));
            complete = () => {
              controller.enqueue(new TextEncoder().encode('last'));
              controller.close();
            };
          },
        }),
      ),
  );
  const [a, b] = await Promise.all([reads.fetch('/api/me'), reads.fetch('/api/me')]);
  const bodyA = a.text(),
    bodyB = b.text();
  complete();
  assert.equal(await bodyA, 'firstlast');
  assert.equal(await bodyB, 'firstlast');
});

test('cancellation after headers rejects only that consumer body and stops transport when all cancel', async () => {
  let transportSignal: AbortSignal | null | undefined;
  let complete = () => {};
  const reads = new InflightReads(async (_path, init) => {
    transportSignal = init?.signal;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('first'));
          complete = () => {
            controller.enqueue(new TextEncoder().encode('last'));
            controller.close();
          };
        },
      }),
    );
  });
  const first = new AbortController(),
    second = new AbortController();
  const [a, b] = await Promise.all([
    reads.fetch('/api/file', { signal: first.signal }),
    reads.fetch('/api/file', { signal: second.signal }),
  ]);
  const cancelled = a.text(),
    continuing = b.text();
  first.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(transportSignal?.aborted, false);
  complete();
  assert.equal(await continuing, 'firstlast');

  const third = new AbortController();
  const response = await reads.fetch('/api/file', { signal: third.signal });
  const body = response.text();
  third.abort();
  await assert.rejects(body, { name: 'AbortError' });
  assert.equal(transportSignal?.aborted, true);
});
