import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { closeBrowser, demoResponse } from './support/browser';

const require = createRequire(import.meta.url);
const { refreshDevelopmentLogin } = require('../src/auth.ts') as typeof import('../src/auth');
const { uploadPrivateFile } =
  require('../src/private-file-upload.ts') as typeof import('../src/private-file-upload');

type Call = { url: string; init: RequestInit; body: Blob; headers: Headers };
const calls: Call[] = [];
let respond: (call: Call, index: number) => Response | Promise<Response>;
const MB = 1024 * 1024;
const body = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
beforeEach(async () => {
  calls.length = 0;
  respond = () => new Response('ok');
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === '/api/dev-login') return demoResponse();
    assert.ok(init?.body instanceof Blob);
    const call = { url: String(input), init, body: init.body, headers: new Headers(init.headers) };
    calls.push(call);
    return respond(call, calls.length - 1);
  });
  await refreshDevelopmentLogin();
});
afterEach(() => mock.restoreAll());
after(closeBrowser);

for (const size of [0, 1, 3 * MB]) {
  test(`file of ${size} bytes uses a single unchanged request without chunk headers`, async () => {
    const file = body(size);
    const response = await uploadPrivateFile('/api/files', {
      method: 'PUT',
      body: file,
      headers: { 'X-Revision': '7' },
    });
    assert.equal(await response.text(), 'ok');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body, file);
    assert.equal(calls[0].headers.has('X-Upload-Id'), false);
    assert.equal(calls[0].headers.get('X-Revision'), '7');
    assert.equal(calls[0].init.method, 'PUT');
  });
}

for (const size of [3 * MB + 1, 6 * MB, 7 * MB]) {
  test(`${size}-byte upload preserves MIME, headers, byte totals and ordered chunk boundaries`, async () => {
    const count = Math.ceil(size / (3 * MB));
    respond = (_call, index) => new Response('', { status: index === count - 1 ? 201 : 202 });
    const headers = new Headers({ 'Content-Type': 'application/pdf', 'X-Revision': '4' });
    const response = await uploadPrivateFile('/api/files', {
      method: 'POST',
      headers,
      body: body(size),
    });
    assert.equal(response.status, 201);
    assert.equal(calls.length, count);
    assert.equal(
      calls.reduce((sum, c) => sum + c.body.size, 0),
      size,
    );
    assert.deepEqual(
      calls.map(c => c.body.size),
      Array.from({ length: count }, (_, i) => Math.min(3 * MB, size - i * 3 * MB)),
    );
    const ids = new Set(calls.map(c => c.headers.get('X-Upload-Id')));
    assert.equal(ids.size, 1);
    assert.match([...ids][0]!, /^[a-f\d-]{36}$/);
    for (const [index, call] of calls.entries()) {
      assert.equal(call.headers.get('X-Upload-Index'), String(index));
      assert.equal(call.headers.get('X-Upload-Count'), String(count));
      assert.equal(call.headers.get('X-Upload-Bytes'), String(size));
      assert.equal(call.headers.get('X-Revision'), '4');
      assert.equal(call.body.type, 'application/pdf');
      assert.equal(call.url, '/api/files');
    }
    assert.equal(headers.has('X-Upload-Id'), false, 'caller-owned headers must not be mutated');
  });
}

for (const index of [0, 1, 2]) {
  test(`failure on chunk ${index} returns the real failure and stops later chunks`, async () => {
    respond = (_call, n) =>
      n === index
        ? Response.json({ error: { message: 'Rejected' } }, { status: 413 })
        : new Response('', { status: 202 });
    const response = await uploadPrivateFile('/api/files', { method: 'POST', body: body(7 * MB) });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.message, 'Rejected');
    assert.equal(calls.length, index + 1);
  });
}

test('an intermediate success without 202 acknowledgement is not treated as a completed upload', async () => {
  respond = () => new Response('', { status: 200 });
  await assert.rejects(uploadPrivateFile('/api/files', { body: body(7 * MB) }), /not confirmed/);
  assert.equal(calls.length, 1);
});

test('transport rejection stops chunks without retrying an uncertain mutation', async () => {
  respond = () => {
    throw Error('Connection lost');
  };
  await assert.rejects(uploadPrivateFile('/api/files', { body: body(7 * MB) }), /Connection lost/);
  assert.equal(calls.length, 1);
});

test('cancellation after a chunk prevents further network writes', async () => {
  const abort = new AbortController();
  respond = () => {
    abort.abort();
    return new Response('', { status: 202 });
  };
  await assert.rejects(
    uploadPrivateFile('/api/files', { body: body(7 * MB), signal: abort.signal }),
    { name: 'AbortError' },
  );
  assert.equal(calls.length, 1);
});

test('separate uploads use distinct staging IDs', async () => {
  respond = (_call, index) => new Response('', { status: index % 2 ? 200 : 202 });
  for (let i = 0; i < 2; i++) await uploadPrivateFile('/api/files', { body: body(3 * MB + 1) });
  assert.notEqual(calls[0].headers.get('X-Upload-Id'), calls[2].headers.get('X-Upload-Id'));
});

test('chunk concatenation exactly reproduces the original bytes at split boundaries', async () => {
  const bytes = new Uint8Array(3 * MB + 3);
  bytes[0] = 17;
  bytes[3 * MB - 1] = 23;
  bytes[3 * MB] = 42;
  bytes[bytes.length - 1] = 255;
  respond = (_call, index) => new Response('', { status: index ? 200 : 202 });
  await uploadPrivateFile('/api/files', { body: new Blob([bytes]) });
  const actual = Buffer.concat(
    await Promise.all(calls.map(async c => Buffer.from(await c.body.arrayBuffer()))),
  );
  assert.deepEqual(actual, Buffer.from(bytes));
});

test('a broken acknowledgement stream is not retried as a successful chunk', async () => {
  respond = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(Error('Acknowledgement interrupted'));
        },
      }),
      { status: 202 },
    );
  await assert.rejects(
    uploadPrivateFile('/api/files', { body: body(7 * MB) }),
    /Acknowledgement interrupted/,
  );
  assert.equal(calls.length, 1);
});
