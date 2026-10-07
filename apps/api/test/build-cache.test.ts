import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('cached outputs from renamed factories cannot replace the deployment entrypoint', async () => {
  const output = new URL('../dist/', import.meta.url),
    stale = new URL('app.js', output);
  await mkdir(output, { recursive: true });
  await writeFile(stale, 'export function createApp() {}');
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('../scripts/build.mjs', import.meta.url))],
    { stdio: 'pipe' },
  );
  await assert.rejects(access(stale), { code: 'ENOENT' });
  await access(new URL('server.js', output));
  await access(new URL('create-app.js', output));
});
