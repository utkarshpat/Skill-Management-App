import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createApp } from '../src/create-app.js';

function rawGet(url: string, headers: Record<string, string>) {
  return new Promise<{
    status: number;
    headers: import('node:http').IncomingHttpHeaders;
    body: Buffer;
  }>((resolve, reject) => {
    get(url, { headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () =>
        resolve({
          status: response.statusCode!,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      );
    }).on('error', reject);
  });
}

test('same-origin hosting supports deep links without masking API or asset failures', async () => {
  const staging = await mkdtemp(join(tmpdir(), 'skills-web-hosting-'));
  // Deployment/extraction directories can have hidden ancestors; public files
  // must still load without allowing a dotfile inside the public web root.
  const root = join(staging, '.staging', 'web');
  await mkdir(join(root, 'assets'), { recursive: true });
  await mkdir(join(root, 'brand'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Skills</title>');
  const javascript = 'console.log("skills");\n'.repeat(1000);
  await writeFile(join(root, 'assets', 'index-Abc12345.js'), javascript);
  await writeFile(join(root, 'brand', 'logo.svg'), '<svg/>');
  await writeFile(join(root, '.env'), 'PRIVATE_SENTINEL');
  const server = createApp(undefined, { webRoot: root }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const path of ['/', '/my-skills', '/certifications', '/business?tab=insights']) {
      const response = await fetch(base + path, { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(await response.text(), /<title>Skills/);
      const csp = response.headers.get('content-security-policy')!;
      assert.match(csp, /connect-src 'self' blob: https:\/\/login\.microsoftonline\.com/);
      assert.match(csp, /img-src 'self' data: blob:/);
      assert.match(csp, /worker-src 'self' blob:/);
      assert.doesNotMatch(csp, /script-src[^;]*(?:blob:|unsafe-eval|unsafe-inline)/);
    }
    const asset = await fetch(`${base}/assets/index-Abc12345.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control')!, /immutable/);
    assert.equal(await asset.text(), javascript);
    // Use raw HTTP bytes: fetch transparently decompresses encoded responses.
    for (const encoding of ['gzip', 'br']) {
      const compressed = await rawGet(`${base}/assets/index-Abc12345.js`, {
        'Accept-Encoding': encoding,
      });
      assert.equal(compressed.status, 200);
      assert.equal(compressed.headers['content-encoding'], encoding);
      assert.match(compressed.headers.vary!, /Accept-Encoding/i);
      assert.match(compressed.headers['cache-control']!, /immutable/);
      assert.match(compressed.headers['content-type']!, /javascript/);
      assert.ok(compressed.body.length < Buffer.byteLength(javascript));
      const decoded =
        encoding === 'gzip' ? gunzipSync(compressed.body) : brotliDecompressSync(compressed.body);
      assert.equal(decoded.toString(), javascript);
    }
    for (const encoding of ['identity', 'gzip;q=0, br;q=0, deflate;q=0']) {
      const plain = await rawGet(`${base}/assets/index-Abc12345.js`, {
        'Accept-Encoding': encoding,
      });
      assert.equal(plain.headers['content-encoding'], undefined);
      assert.equal(plain.body.toString(), javascript);
    }
    const cached = await rawGet(`${base}/assets/index-Abc12345.js`, {
      'Accept-Encoding': 'gzip',
      'If-None-Match': asset.headers.get('etag')!,
    });
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0);
    const brand = await fetch(`${base}/brand/logo.svg`);
    assert.equal(brand.headers.get('cache-control'), 'no-cache');
    assert.equal(brand.headers.get('content-encoding'), null);
    const health = await fetch(`${base}/api/health`);
    assert.equal((await health.json()).status, 'ok');
    for (const path of ['/api/me', '/api/missing']) {
      const denied = await fetch(base + path, { headers: { Accept: 'text/html' } });
      assert.equal(denied.status, 401);
      assert.equal((await denied.json()).error.code, 'NOT_AUTHORIZED');
    }
    for (const path of ['/assets/missing.js', '/brand/missing', '/.env', '/missing.pdf']) {
      const response = await fetch(base + path, { headers: { Accept: 'text/html' } });
      assert.ok([403, 404].includes(response.status));
      assert.doesNotMatch(await response.text(), /PRIVATE_SENTINEL|<title>Skills/);
    }
    assert.equal((await fetch(`${base}/my-skills`, { method: 'POST' })).status, 404);
    assert.equal(
      (await fetch(`${base}/my-skills`, { headers: { Accept: 'application/json' } })).status,
      404,
    );
    const head = await fetch(`${base}/my-skills`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
    await rm(staging, { recursive: true, force: true });
  }
});

test('same-origin hosting fails at startup if the web build is absent', () => {
  assert.throws(() => createApp(undefined, { webRoot: join(tmpdir(), 'missing-skills-build') }));
});
