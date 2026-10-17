import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/create-app.js';

test('same-origin hosting supports deep links without masking API or asset failures', async () => {
  const staging = await mkdtemp(join(tmpdir(), 'skills-web-hosting-'));
  // Deployment/extraction directories can have hidden ancestors; public files
  // must still load without allowing a dotfile inside the public web root.
  const root = join(staging, '.staging', 'web');
  await mkdir(join(root, 'assets'), { recursive: true });
  await mkdir(join(root, 'brand'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Skills</title>');
  await writeFile(join(root, 'assets', 'index-Abc12345.js'), 'console.log("skills")');
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
    const brand = await fetch(`${base}/brand/logo.svg`);
    assert.equal(brand.headers.get('cache-control'), 'no-cache');
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
