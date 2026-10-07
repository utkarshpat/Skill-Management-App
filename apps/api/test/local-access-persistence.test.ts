import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';

test('local access retries transient replacement locks without losing the audited save', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'access-atomic-')),
    path = join(dir, 'access.json');
  const store = await LocalAccessStore.open(path),
    actor = store.snapshot().people[0].id,
    rename = fs.rename;
  let attempts = 0;
  const stub = mock.method(fs, 'rename', async (...args: Parameters<typeof rename>) => {
    if (++attempts < 3) throw Object.assign(Error('Locked'), { code: 'EBUSY' });
    return rename(...args);
  });
  syncBuiltinESMExports();
  try {
    const saved = await store.save(actor, {
      kind: 'role',
      revision: 1,
      name: 'Test template',
      permissions: [],
    });
    assert.equal(attempts, 3);
    assert.equal(saved.revision, 2);
    assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf8')), store.snapshot());
    assert.equal(saved.audit.length, 1);
    assert.deepEqual(await fs.readdir(dir), ['access.json']);
  } finally {
    stub.mock.restore();
    syncBuiltinESMExports();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('failed atomic replacement preserves disk and memory, cleans temp files and permits a retry', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'access-atomic-')),
    path = join(dir, 'access.json');
  const store = await LocalAccessStore.open(path),
    before = store.snapshot(),
    disk = await fs.readFile(path, 'utf8'),
    actor = before.people[0].id;
  let attempts = 0;
  const stub = mock.method(fs, 'rename', async () => {
    attempts++;
    throw Object.assign(Error('Locked'), { code: 'EPERM' });
  });
  syncBuiltinESMExports();
  const change = { kind: 'role', revision: 1, name: 'Test template', permissions: [] };
  try {
    await assert.rejects(store.save(actor, change), /Locked/);
    assert.equal(attempts, 5);
    assert.deepEqual(store.snapshot(), before);
    assert.equal(await fs.readFile(path, 'utf8'), disk);
    assert.deepEqual(await fs.readdir(dir), ['access.json']);
    stub.mock.restore();
    syncBuiltinESMExports();
    assert.equal((await store.save(actor, change)).revision, 2);
  } finally {
    stub.mock.restore();
    syncBuiltinESMExports();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
