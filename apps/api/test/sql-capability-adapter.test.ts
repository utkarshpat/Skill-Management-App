import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { sqlAdapterFixture } from './sql-adapter-fixture.js';
import { SqlCapabilitySubmissionStore } from '../src/modules/skills/sql-capability-submissions.js';
import { PrivateFileStorage } from '../src/shared/private-files.js';
import { BlobServiceClient } from '@azure/storage-blob';
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  cert = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  fileId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const source = Buffer.from('Oracle SQL credential for Aditi Menon'),
  item = {
    id: fileId,
    bytes: source.length,
    blobName: 'private/credential',
    fileName: 'oracle-sql.txt',
    mimeType: 'text/plain',
  };
test('combined submission adapter binds actor/account and normalizes omitted arrays and SQL failure states', async () => {
  const f = sqlAdapterFixture();
  try {
    const store = new SqlCapabilitySubmissionStore(account);
    f.reply(
      'dbo.CapabilitySubmissionWorkspace',
      [{ unrelated: 'preceding metadata' }],
      [{ json: JSON.stringify({ records: [{ id: id.toUpperCase() }] }) }],
    );
    assert.equal((await store.run(actor, 'MINE', {})).records[0].id, id);
    f.reply('dbo.CapabilitySubmissionWorkspace');
    assert.deepEqual(await store.run(actor, 'OPTIONS', {}), {
      claims: [],
      certifications: [],
      definitions: [],
    });
    assert.deepEqual(f.calls[0].inputs, {
      account_id: account,
      actor_id: actor,
      operation: 'MINE',
      payload: '{}',
    });
    for (const [number, status] of [
      [51014, 409],
      [51003, 403],
      [51004, 404],
      [51009, 409],
      [51010, 409],
      [2601, 409],
      [2627, 409],
      [51011, 409],
      [51000, 400],
      [51012, 400],
      [547, 400],
      [2812, 503],
      [208, 503],
      [207, 503],
    ]) {
      f.reject('dbo.CapabilitySubmissionWorkspace', { number });
      await assert.rejects(store.run(actor, 'SAVE', {}), { status });
    }
    const fault = new Error('connection lost');
    f.reject('dbo.CapabilitySubmissionWorkspace', fault);
    await assert.rejects(store.run(actor, 'MINE', {}), e => e === fault);
    f.reply('dbo.CapabilityIntakeFiles', [{ json: '{}' }]);
    assert.deepEqual((await store.stagedFiles(actor, id, cert)).items, []);
    for (const [number, status] of [
      [51003, 403],
      [51009, 409],
      [51000, 400],
    ]) {
      f.reject('dbo.CapabilityIntakeFiles', { number });
      await assert.rejects(store.stagedFiles(actor, id, cert), { status });
    }
    f.reject('dbo.CapabilityIntakeFiles', fault);
    await assert.rejects(store.stagedFiles(actor, id, cert), e => e === fault);
    f.reply('dbo.CapabilitySubmissionFiles', []);
    assert.deepEqual((await store.files(actor, id, cert)).items, []);
    for (const [number, status] of [
      [51003, 403],
      [51010, 409],
    ]) {
      f.reject('dbo.CapabilitySubmissionFiles', { number });
      await assert.rejects(store.files(actor, id, cert), { status });
    }
    f.reject('dbo.CapabilitySubmissionFiles', fault);
    await assert.rejects(store.files(actor, id, cert), e => e === fault);
    assert.equal(store.storageConfigured, false);
    for (const run of [
      () => store.autofillPart(actor, source, 'text/plain', 'credential.txt', {} as never),
      () => store.stage(actor, id, cert, 2, source, 'text/plain', 'credential.txt'),
      () => store.stagedFile(actor, id, cert, fileId),
      () => store.file(actor, id, cert, fileId),
    ])
      await assert.rejects(run(), { status: 503 });
  } finally {
    await f.finish();
  }
});

test('managed intake upload rechecks draft revision and recovers an ambiguous committed file without deleting it', async () => {
  const f = sqlAdapterFixture(),
    store = new SqlCapabilitySubmissionStore(account, { provider: 'sql' });
  const writes: Parameters<PrivateFileStorage['save']>[] = [];
  const save = mock.method(
    PrivateFileStorage.prototype,
    'save',
    async (...args: Parameters<PrivateFileStorage['save']>) => {
      writes.push(args);
    },
  );
  const assemble = mock.method(
    PrivateFileStorage.prototype,
    'assemble',
    async () => undefined as Buffer | undefined,
  );
  const reply = (data: object) =>
    f.reply('dbo.CapabilityIntakeFiles', [{ json: JSON.stringify(data) }]);
  try {
    assert.equal(store.storageConfigured, true);
    reply({ canUpload: false, revision: 2 });
    await assert.rejects(store.stage(actor, id, cert, 2, source, 'text/plain', 'credential.txt'), {
      status: 403,
    });
    assert.equal(writes.length, 0);
    reply({ canUpload: true, revision: 3 });
    await assert.rejects(store.stage(actor, id, cert, 2, source, 'text/plain', 'credential.txt'), {
      status: 409,
    });
    assert.equal(writes.length, 0);
    reply({ canUpload: true, revision: 2 });
    assert.deepEqual(
      await store.stage(actor, id, cert, 2, source, 'text/plain', 'credential.txt', {} as never),
      { pending: true },
    );
    assemble.mock.mockImplementation(async () => source);
    reply({ canUpload: true, revision: 2 });
    reply({ revision: 3, items: [item] });
    await store.stage(actor, id, cert, 2, source, 'text/plain', 'credential.txt', {} as never);
    assert.deepEqual(writes[0][0], { actor, context: 'intake', record: cert, submission: id });
    assert.equal(writes[0][1].revision, 2);
    assert.equal(writes[0][1].data.toString(), source.toString());
    const ambiguous = new Error('lost acknowledgement');
    save.mock.mockImplementation(async (_access, file) => {
      reply({ revision: 3, items: [{ ...item, id: file.id }] });
      throw ambiguous;
    });
    reply({ canUpload: true, revision: 2 });
    const recovered = await store.stage(actor, id, cert, 2, source, 'text/plain', 'credential.txt');
    assert.equal(recovered.items.length, 1);
    save.mock.mockImplementation(async () => {
      reply({ revision: 2, items: [] });
      throw ambiguous;
    });
    reply({ canUpload: true, revision: 2 });
    await assert.rejects(
      store.stage(actor, id, cert, 2, source, 'text/plain', 'credential.txt'),
      e => e === ambiguous,
    );
    assert.equal(
      await store.autofillPart(actor, source, 'text/plain', 'credential.txt', {} as never),
      source,
    );
  } finally {
    save.mock.restore();
    assemble.mock.restore();
    await f.finish();
  }
});

test('submitted and draft downloads refuse missing, oversized, changed or truncated files after authorization recheck', async () => {
  const f = sqlAdapterFixture(),
    store = new SqlCapabilitySubmissionStore(account, { provider: 'sql' }),
    read = mock.method(PrivateFileStorage.prototype, 'read', async () => source);
  const reply = (proc: string, data: object) => f.reply(proc, [{ json: JSON.stringify(data) }]);
  try {
    for (const context of ['draft', 'submission']) {
      const proc =
          context === 'draft' ? 'dbo.CapabilityIntakeFiles' : 'dbo.CapabilitySubmissionFiles',
        run = () =>
          context === 'draft'
            ? store.stagedFile(actor, id, cert, fileId)
            : store.file(actor, id, cert, fileId);
      for (const bytes of [0, 11 * 1024 * 1024]) {
        reply(proc, { items: [{ ...item, bytes }] });
        await assert.rejects(run(), { status: 404 });
      }
      reply(proc, { items: [] });
      await assert.rejects(run(), { status: 404 });
      reply(proc, { revision: 2, workspaceRevision: 4, items: [item] });
      reply(proc, { revision: 2, workspaceRevision: 4, items: [item] });
      assert.equal((await run()).data, source);
      reply(proc, { revision: 2, workspaceRevision: 4, items: [item] });
      reply(proc, { revision: 3, workspaceRevision: 5, items: [] });
      await assert.rejects(run(), { status: 409 });
      read.mock.mockImplementation(async () => source.subarray(1));
      reply(proc, { revision: 2, workspaceRevision: 4, items: [item] });
      reply(proc, { revision: 2, workspaceRevision: 4, items: [item] });
      await assert.rejects(run(), { status: 503 });
      read.mock.mockImplementation(async () => source);
    }
  } finally {
    read.mock.restore();
    await f.finish();
  }
});

test('legacy Blob uploads require private containers, conditional create and authorized registration', async () => {
  const f = sqlAdapterFixture(),
    store = new SqlCapabilitySubmissionStore(account, {
      connection: 'test-only',
      container: 'private',
    });
  let isPublic = false,
    uploaded: Buffer | undefined,
    options: unknown;
  const blob = {
    uploadData: async (data: Buffer, value: unknown) => {
      uploaded = data;
      options = value;
    },
    downloadToBuffer: async () => source,
  };
  const client = mock.method(
    BlobServiceClient,
    'fromConnectionString',
    () =>
      ({
        getContainerClient: () => ({
          getProperties: async () => ({ blobPublicAccess: isPublic ? 'blob' : undefined }),
          getBlockBlobClient: () => blob,
        }),
      }) as unknown as BlobServiceClient,
  );
  const reply = (proc: string, data: object) => f.reply(proc, [{ json: JSON.stringify(data) }]);
  try {
    reply('dbo.CapabilityIntakeFiles', { canUpload: false, revision: 2 });
    await assert.rejects(store.stage(actor, id, cert, 2, source, 'text/plain', 'credential.txt'), {
      status: 403,
    });
    reply('dbo.CapabilityIntakeFiles', { canUpload: true, revision: 3 });
    await assert.rejects(store.stage(actor, id, cert, 2, source, 'text/plain', 'credential.txt'), {
      status: 409,
    });
    isPublic = true;
    reply('dbo.CapabilityIntakeFiles', { canUpload: true, revision: 2 });
    await assert.rejects(store.stage(actor, id, cert, 2, source, 'text/plain', 'credential.txt'), {
      status: 503,
    });
    assert.equal(uploaded, undefined);
    isPublic = false;
    reply('dbo.CapabilityIntakeFiles', { canUpload: true, revision: 2 });
    reply('dbo.CapabilityIntakeFiles', { revision: 3, items: [item] });
    await store.stage(actor, id, cert, 2, source, 'text/plain', 'credential.txt');
    assert.equal(uploaded, source);
    assert.deepEqual(options, {
      conditions: { ifNoneMatch: '*' },
      blobHTTPHeaders: { blobContentType: 'text/plain' },
    });
    assert.equal(f.calls.at(-1)?.inputs.operation, 'ADD');
    for (const proc of ['dbo.CapabilityIntakeFiles', 'dbo.CapabilitySubmissionFiles']) {
      reply(proc, { revision: 2, workspaceRevision: 3, items: [item] });
      reply(proc, { revision: 2, workspaceRevision: 3, items: [item] });
      const result = proc.includes('Intake')
        ? await store.stagedFile(actor, id, cert, fileId)
        : await store.file(actor, id, cert, fileId);
      assert.equal(result.data, source);
    }
    isPublic = true;
    reply('dbo.CapabilityIntakeFiles', { items: [item] });
    await assert.rejects(store.stagedFile(actor, id, cert, fileId), { status: 503 });
  } finally {
    client.mock.restore();
    await f.finish();
  }
});
