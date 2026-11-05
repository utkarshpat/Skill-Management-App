import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

type Call = { url: string; headers: Headers; size: number };

async function load(respond: (call: Call, index: number) => Response) {
  const source = await fs.readFile(
    new URL('../src/private-file-upload.ts', import.meta.url),
    'utf8',
  );
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs' });
  const calls: Call[] = [];
  const module = { exports: {} as any };
  const authenticatedFetch = async (url: string, init: RequestInit & { body: Blob }) => {
    const call = { url, headers: new Headers(init.headers), size: init.body.size };
    calls.push(call);
    return respond(call, calls.length - 1);
  };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: () => ({ authenticatedFetch }),
    Headers,
    Error,
    Math,
    String,
    crypto,
  });
  return {
    upload: module.exports.uploadPrivateFile as (u: string, i: any) => Promise<Response>,
    calls,
  };
}

const big = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
const MB = 1024 * 1024;

test('small files are sent in one request without chunk headers', async () => {
  const { upload, calls } = await load(() => new Response('ok', { status: 200 }));
  const response = await upload('/api/files', { method: 'POST', body: big(MB) });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.has('X-Upload-Id'), false);
});

test('large files are split into 3 MB chunks with consistent headers', async () => {
  const { upload, calls } = await load((_c, i) => new Response('', { status: i < 2 ? 202 : 200 }));
  const response = await upload('/api/files', { method: 'POST', body: big(7 * MB) });
  assert.equal(response.status, 200);
  assert.deepEqual(
    calls.map(c => c.size),
    [3 * MB, 3 * MB, MB],
  );
  assert.deepEqual(
    calls.map(c => c.headers.get('X-Upload-Index')),
    ['0', '1', '2'],
  );
  assert.equal(new Set(calls.map(c => c.headers.get('X-Upload-Id'))).size, 1);
  assert.ok(calls.every(c => c.headers.get('X-Upload-Count') === '3'));
  assert.ok(calls.every(c => c.headers.get('X-Upload-Bytes') === String(7 * MB)));
});

test('a failed chunk stops the upload and returns that response', async () => {
  const { upload, calls } = await load(() => new Response('no', { status: 413 }));
  const response = await upload('/api/files', { method: 'POST', body: big(7 * MB) });
  assert.equal(response.status, 413);
  assert.equal(calls.length, 1);
});

test('an unconfirmed intermediate chunk is reported instead of continuing', async () => {
  const { upload, calls } = await load(() => new Response('', { status: 200 }));
  await assert.rejects(
    upload('/api/files', { method: 'POST', body: big(7 * MB) }),
    /not confirmed/,
  );
  assert.equal(calls.length, 1);
});
