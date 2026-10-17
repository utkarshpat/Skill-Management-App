import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { appServicePackage } from './package-appservice.mjs';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { unzipSync } = require('fflate');
const repository = new URL('../', import.meta.url);

test('hosting archive excludes local secrets/dependencies and preserves workspace root layout', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'skills-release-'));
  try {
    const seed = await appServicePackage(fileURLToPath(repository));
    const entries = unzipSync(seed.archive);
    for (const [path, data] of Object.entries(entries)) {
      if (path === 'release-manifest.json') continue;
      const destination = join(fixture, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, data);
    }
    for (const path of [
      '.env',
      'apps/api/.env',
      'apps/web/.env.local',
      'apps/api/src/.env',
      'apps/web/src/.local/secret.json',
      'node_modules/secret.txt',
      'apps/web/dist/secret.txt',
      '.local/backup.bacpac',
    ]) {
      const destination = join(fixture, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, 'PRIVATE_PACKAGE_CANARY');
    }
    const first = await appServicePackage(fixture, {
      sourceCommit: 'test',
      workingTreeDirty: true,
    });
    const second = await appServicePackage(fixture, {
      sourceCommit: 'test',
      workingTreeDirty: true,
    });
    assert.equal(first.sha256, second.sha256);
    const unpacked = unzipSync(first.archive);
    assert.ok(unpacked['package.json']);
    assert.ok(unpacked['apps/web/index.html']);
    assert.ok(unpacked['apps/api/src/server.ts']);
    assert.ok(unpacked['apps/api/src/shared/web-hosting.ts']);
    assert.equal(
      JSON.parse(Buffer.from(unpacked['package.json']).toString()).scripts.start,
      'npm run start -w apps/api',
    );
    for (const [path, data] of Object.entries(unpacked)) {
      assert.doesNotMatch(path, /(?:^|\/)(?:\.env|\.local|node_modules|dist)(?:\/|$|\.)/);
      assert.doesNotMatch(Buffer.from(data).toString(), /PRIVATE_PACKAGE_CANARY/);
    }
    const manifest = JSON.parse(Buffer.from(unpacked['release-manifest.json']).toString());
    for (const file of manifest.files) {
      assert.equal(unpacked[file.path].length, file.bytes);
      assert.equal(createHash('sha256').update(unpacked[file.path]).digest('hex'), file.sha256);
    }
    assert.equal(manifest.requiredSettings.NPM_CONFIG_INCLUDE, 'dev');
    // The archived lockfile is the reviewed repository lockfile, not a regenerated one.
    assert.deepEqual(
      Buffer.from(unpacked['package-lock.json']),
      await readFile(new URL('package-lock.json', repository)),
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
