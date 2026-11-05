import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { act } from 'react';
import { closeBrowser, deferred, demoResponse, render, settle } from './support/browser';

const require = createRequire(import.meta.url);
const { refreshDevelopmentLogin } = require('../src/auth.ts') as typeof import('../src/auth');
const { useIntakeFile } =
  require('../src/capabilities/useIntakeFile.ts') as typeof import('../src/capabilities/useIntakeFile');

let state: ReturnType<typeof useIntakeFile>;
let mounted: Awaited<ReturnType<typeof render>> | undefined;
let transport: typeof fetch;
const requests: { path: string; signal?: AbortSignal | null }[] = [];
const revoked: string[] = [];
let created = 0;
const file = { id: 'file-1', fileName: 'evidence.pdf', mimeType: 'application/pdf', bytes: 13 };
const snapshots: { root?: string; url: string; file: unknown; loading: boolean }[] = [];
function Probe({ root }: { root?: string }) {
  state = useIntakeFile(root);
  snapshots.push({ root, url: state.url, file: state.file, loading: state.loading });
  return <p>{state.error || (state.loading ? 'Loading' : state.url || 'Empty')}</p>;
}
beforeEach(async () => {
  requests.length = 0;
  revoked.length = 0;
  created = 0;
  snapshots.length = 0;
  transport = async () => Response.json({ items: [] });
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === '/api/dev-login') return demoResponse();
    requests.push({ path: String(input), signal: init?.signal });
    return transport(input, init);
  });
  mock.method(URL, 'createObjectURL', () => `blob:test-${++created}`);
  mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url));
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  mock.restoreAll();
});
after(closeBrowser);

test('no root and empty metadata finish without downloading or allocating a URL', async () => {
  mounted = await render(<Probe />);
  assert.equal(state.loading, false);
  assert.equal(requests.length, 0);
  await mounted.update(<Probe root="/api/intake/files" />);
  await settle();
  assert.equal(state.url, '');
  assert.equal(state.file, undefined);
  assert.equal(state.error, '');
  assert.equal(state.loading, false);
  assert.equal(requests.length, 1);
  assert.equal(created, 0);
});

test('successful metadata and binary reads expose the file and revoke its URL on removal', async () => {
  transport = async input =>
    String(input).endsWith('/file-1')
      ? new Response(new Blob(['private bytes']))
      : Response.json({ items: [file] });
  mounted = await render(<Probe root="/api/intake/files" />);
  await settle();
  assert.equal(snapshots.find(s => s.root === '/api/intake/files')?.loading, true);
  assert.deepEqual(state.file, file);
  assert.equal(state.url, 'blob:test-1');
  assert.equal(state.loading, false);
  assert.deepEqual(
    requests.map(r => r.path),
    ['/api/intake/files', '/api/intake/files/file-1'],
  );
  await mounted.update(<Probe />);
  assert.equal(state.url, '');
  assert.deepEqual(revoked, ['blob:test-1']);
});

for (const stage of ['metadata', 'download'] as const) {
  for (const status of [401, 403, 404, 500]) {
    test(`${stage} HTTP ${status} is visible and retry can recover`, async () => {
      transport = async input => {
        if (stage === 'download' && !String(input).endsWith('/file-1'))
          return Response.json({ items: [file] });
        return Response.json({ error: { message: `${stage} denied ${status}` } }, { status });
      };
      mounted = await render(<Probe root="/api/intake/files" />);
      await settle();
      assert.equal(state.loading, false);
      assert.equal(state.url, '');
      assert.equal(state.file, undefined);
      assert.equal(state.error, `${stage} denied ${status}`);
      // Re-establish the demo cookie after an intentional 401 response.
      await refreshDevelopmentLogin();
      transport = async () => Response.json({ items: [] });
      await act(async () => state.retry());
      await settle();
      assert.equal(state.error, '');
      assert.equal(state.loading, false);
    });
  }
}

test('transport errors and invalid JSON are surfaced without a success-shaped file', async () => {
  transport = async () => {
    throw Error('Offline');
  };
  mounted = await render(<Probe root="/api/intake/files" />);
  await settle();
  assert.equal(state.error, 'Offline');
  transport = async () => new Response('not json');
  await act(async () => state.retry());
  await settle();
  assert.equal(state.error, 'Draft file unavailable.');
  assert.equal(state.file, undefined);
});

test('retries revoke previous object URLs and unmount releases the replacement', async () => {
  transport = async input =>
    String(input).endsWith('/file-1') ? new Response('bytes') : Response.json({ items: [file] });
  mounted = await render(<Probe root="/api/intake/files" />);
  await settle();
  await act(async () => state.retry());
  await settle();
  assert.deepEqual(revoked, ['blob:test-1']);
  assert.equal(state.url, 'blob:test-2');
  await mounted.unmount();
  mounted = undefined;
  assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2']);
});

for (const stage of ['metadata', 'download'] as const) {
  test(`switching roots ignores a late ${stage} response and aborts its request`, async () => {
    const pending = deferred<Response>();
    transport = async input => {
      if (String(input) === '/api/old' && stage === 'download')
        return Response.json({ items: [{ ...file, id: 'old-file' }] });
      if (String(input).startsWith('/api/old')) return pending.promise;
      return Response.json({ items: [] });
    };
    mounted = await render(<Probe root="/api/old" />);
    await settle();
    await mounted.update(<Probe root="/api/new" />);
    await settle();
    await act(async () =>
      pending.resolve(
        stage === 'metadata'
          ? Response.json({ items: [{ ...file, id: 'old-file' }] })
          : new Response('old bytes'),
      ),
    );
    await settle();
    assert.equal(state.file, undefined);
    assert.equal(state.url, '');
    assert.equal(state.error, '');
    assert.equal(created, 0);
    assert.equal(
      requests.find(r => r.path === (stage === 'metadata' ? '/api/old' : '/api/old/old-file'))
        ?.signal?.aborted,
      true,
    );
    if (stage === 'metadata')
      assert.equal(
        requests.some(r => r.path.endsWith('/old-file')),
        false,
      );
  });
}

test('unmount aborts a pending read and ignores its later rejection', async () => {
  const pending = deferred<Response>();
  transport = () => pending.promise;
  mounted = await render(<Probe root="/api/intake/files" />);
  await mounted.unmount();
  mounted = undefined;
  pending.reject(Error('Late network failure'));
  await settle();
  assert.equal(created, 0);
  assert.equal(requests[0].signal?.aborted, true);
});

test('switching drafts never renders the previous private file even before effects run', async () => {
  transport = async input =>
    String(input).endsWith('/file-1')
      ? new Response('private bytes')
      : Response.json({ items: [file] });
  mounted = await render(<Probe root="/api/first" />);
  await settle();
  assert.equal(state.url, 'blob:test-1');
  transport = async () => Response.json({ items: [] });
  await mounted.update(<Probe root="/api/second" />);
  assert.ok(snapshots.filter(s => s.root === '/api/second').every(s => !s.file && !s.url));
  assert.deepEqual(revoked, ['blob:test-1']);
});

for (const metadata of [
  {},
  { items: null },
  { items: {} },
  { items: [null] },
  { items: [{}] },
  { items: [{ ...file, id: '' }] },
  { items: [{ ...file, fileName: 1 }] },
  { items: [{ ...file, mimeType: null }] },
  { items: [{ ...file, bytes: -1 }] },
]) {
  test(`invalid staged-file metadata is rejected before fetching binary: ${JSON.stringify(metadata)}`, async () => {
    transport = async () => Response.json(metadata);
    mounted = await render(<Probe root="/api/intake/files" />);
    await settle();
    assert.equal(state.error, 'Draft file unavailable.');
    assert.equal(state.file, undefined);
    assert.equal(state.loading, false);
    assert.equal(requests.length, 1);
    assert.equal(created, 0);
  });
}

test('file identifiers are encoded as one path segment', async () => {
  transport = async input =>
    String(input) === '/api/intake/files'
      ? Response.json({ items: [{ ...file, id: 'file/id?version=1' }] })
      : new Response('bytes');
  mounted = await render(<Probe root="/api/intake/files" />);
  await settle();
  assert.equal(requests[1].path, '/api/intake/files/file%2Fid%3Fversion%3D1');
  assert.equal(state.error, '');
});

test('binary stream errors are visible without allocating a preview URL', async () => {
  transport = async input =>
    String(input).endsWith('/file-1')
      ? new Response(
          new ReadableStream({
            start(controller) {
              controller.error(Error('Download interrupted'));
            },
          }),
        )
      : Response.json({ items: [file] });
  mounted = await render(<Probe root="/api/intake/files" />);
  await settle();
  assert.equal(state.error, 'Download interrupted');
  assert.equal(state.file, undefined);
  assert.equal(created, 0);
});

test('non-Error transport rejection still presents a useful error message', async () => {
  transport = async () => {
    throw 'disconnected';
  };
  mounted = await render(<Probe root="/api/intake/files" />);
  await settle();
  assert.equal(state.error, 'Draft file unavailable.');
  assert.equal(state.loading, false);
});
