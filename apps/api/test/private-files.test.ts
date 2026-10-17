import test from 'node:test';
import assert from 'node:assert/strict';
import { BlockBlobClient, ContainerClient } from '@azure/storage-blob';
import {
  PrivateFileStorage,
  contentDigest,
  verifyFileContent,
  privateStorageConfig,
} from '../src/shared/private-files.js';
import { ManagedEvidenceStore, configuredEvidence } from '../src/modules/skills/evidence.js';
const account = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const record = '33333333-3333-4333-8333-333333333333';
const id = '44444444-4444-4444-8444-444444444444';
const access = { actor, context: 'certification' as const, record };

test('SQL file storage requires no Blob credential; invalid providers and incomplete Blob config fail closed', () => {
  assert.equal(privateStorageConfig({ STORAGE_IS_SQL: 'true' })?.provider, 'sql');
  const blob = {
    EVIDENCE_STORAGE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
    EVIDENCE_STORAGE_CONTAINER: 'private',
  };
  assert.equal(privateStorageConfig({ ...blob, STORAGE_IS_SQL: 'false' })?.provider, 'azure-blob');
  for (const value of ['', 'yes', '1', 'TRUE'])
    assert.throws(() => privateStorageConfig({ STORAGE_IS_SQL: value }));
  assert.throws(() => privateStorageConfig({ STORAGE_IS_SQL: 'false' }));
  assert.throws(() =>
    privateStorageConfig({ STORAGE_IS_SQL: 'true', EVIDENCE_STORAGE_PROVIDER: 'azure-blob' }),
  );
  assert.ok(
    configuredEvidence({ ACCESS_ACCOUNT_ID: account, STORAGE_IS_SQL: 'true' }) instanceof
      ManagedEvidenceStore,
  );
  assert.ok(
    configuredEvidence({ ACCESS_ACCOUNT_ID: account, ...blob, STORAGE_IS_SQL: 'false' }) instanceof
      ManagedEvidenceStore,
  );
  assert.equal(privateStorageConfig({ EVIDENCE_STORAGE_PROVIDER: 'sql' })?.provider, 'sql');
  assert.equal(privateStorageConfig({}), undefined);
  assert.throws(() => privateStorageConfig({ EVIDENCE_STORAGE_PROVIDER: 'disk' }));
  assert.throws(() => privateStorageConfig({ EVIDENCE_STORAGE_PROVIDER: 'azure-blob' }));
  assert.ok(
    configuredEvidence({ ACCESS_ACCOUNT_ID: account, EVIDENCE_STORAGE_PROVIDER: 'sql' }) instanceof
      ManagedEvidenceStore,
  );
});
test('stored checksum and exact size reject corrupt, truncated and same-length substituted bytes', () => {
  const bytes = Buffer.from('certificate');
  assert.deepEqual(verifyFileContent(bytes, bytes.length, contentDigest(bytes)), bytes);
  assert.throws(() => verifyFileContent(bytes, bytes.length + 1, contentDigest(bytes)));
  assert.throws(() =>
    verifyFileContent(Buffer.from('Certificate'), bytes.length, contentDigest(bytes)),
  );
});
test('per-file provider controls reads after changing the default upload provider', async t => {
  const bytes = Buffer.from('certificate');
  const blobConfig = {
    provider: 'azure-blob' as const,
    connection: 'UseDevelopmentStorage=true',
    container: 'private',
  };
  const storage = new PrivateFileStorage(account, blobConfig);
  let downloads = 0;
  t.mock.method(ContainerClient.prototype, 'getProperties', async () => ({}));
  t.mock.method(BlockBlobClient.prototype, 'downloadToBuffer', async () => {
    downloads++;
    return bytes;
  });
  let provider = 'sql';
  t.mock.method(storage as any, 'execute', async () => [
    {
      provider,
      objectKey: 'private/key',
      bytes: bytes.length,
      content: bytes,
      sha256: contentDigest(bytes),
    },
  ]);
  assert.deepEqual(await storage.read(access, id), bytes);
  assert.equal(downloads, 0);
  provider = 'azure-blob';
  assert.deepEqual(await storage.read(access, id), bytes);
  assert.equal(downloads, 1);
  const sqlOnly = new PrivateFileStorage(account, { provider: 'sql' });
  t.mock.method(sqlOnly as any, 'execute', async () => [
    {
      provider: 'azure-blob',
      objectKey: 'private/key',
      bytes: bytes.length,
      content: null,
      sha256: contentDigest(bytes),
    },
  ]);
  await assert.rejects(sqlOnly.read(access, id), /requires the Azure Blob connection/);
});
test('managed evidence download rechecks membership after authorized byte retrieval', async t => {
  const store = new ManagedEvidenceStore(account, { provider: 'sql' }, 'certification');
  const item = { id, blobName: 'private/key', bytes: 3 };
  let reads = 0;
  t.mock.method(store, 'read', async () => ({
    revision: 1,
    canUpload: false,
    items: ++reads === 1 ? [item] : [],
  }));
  t.mock.method((store as any).files, 'read', async () => Buffer.from('pdf'));
  await assert.rejects(store.image(actor, record, id), /changed during download/);
  assert.equal(reads, 2);
});
test('Blob uploads stage in private Blob blocks without copying temporary chunks into SQL', async t => {
  const storage = new PrivateFileStorage(account, {
    provider: 'azure-blob',
    connection: 'UseDevelopmentStorage=true',
    container: 'private',
  });
  const bytes = Buffer.from('file');
  let staged = 0;
  t.mock.method(ContainerClient.prototype, 'getProperties', async () => ({}));
  t.mock.method(BlockBlobClient.prototype, 'stageBlock', async () => {
    staged++;
    return {};
  });
  t.mock.method(BlockBlobClient.prototype, 'commitBlockList', async () => ({}));
  t.mock.method(BlockBlobClient.prototype, 'downloadToBuffer', async () => bytes);
  t.mock.method(storage as any, 'execute', async () => {
    throw Error('Blob staging must not store SQL chunks');
  });
  assert.deepEqual(
    await storage.assemble(
      actor,
      'autofill',
      0,
      { id, index: 0, count: 1, bytes: bytes.length },
      bytes,
      'application/pdf',
      'proof.pdf',
      5 * 1024 * 1024,
    ),
    bytes,
  );
  assert.equal(staged, 1);
});
test('durable upload assembly verifies every chunk and exact total independently of process memory', async t => {
  const first = new PrivateFileStorage(account, { provider: 'sql' });
  const second = new PrivateFileStorage(account, { provider: 'sql' });
  const bytes = 3 * 1024 * 1024 + 2;
  const part = { id, index: 0, count: 2, bytes };
  const chunks = [Buffer.alloc(3 * 1024 * 1024), Buffer.from('ok')];
  t.mock.method(first as any, 'execute', async () => []);
  assert.equal(
    await first.assemble(
      actor,
      'autofill',
      0,
      part,
      chunks[0],
      'application/pdf',
      'proof.pdf',
      5 * 1024 * 1024,
    ),
    undefined,
  );
  t.mock.method(second as any, 'execute', async () =>
    chunks.map(content => ({ content, sha256: contentDigest(content) })),
  );
  assert.equal(
    (
      await second.assemble(
        actor,
        'autofill',
        0,
        { ...part, index: 1 },
        chunks[1],
        'application/pdf',
        'proof.pdf',
        5 * 1024 * 1024,
      )
    )?.length,
    bytes,
  );
  await assert.rejects(
    second.assemble(
      actor,
      'autofill',
      0,
      { ...part, index: 1 },
      Buffer.from('x'),
      'application/pdf',
      'proof.pdf',
      5 * 1024 * 1024,
    ),
  );
});
