import test from 'node:test';
import assert from 'node:assert/strict';
import type { ContainerClient } from '@azure/storage-blob';
import {
  assembleUpload,
  uploadChunk,
  uploadChunkBytes,
} from '../src/modules/skills/upload-chunks.js';
const id = '11111111-1111-1111-1111-111111111111';
test('upload part parser bounds total size, exact count and complete headers', () => {
  assert.equal(uploadChunk({}), undefined);
  const h = {
    'x-upload-id': id,
    'x-upload-index': '0',
    'x-upload-count': '2',
    'x-upload-bytes': String(uploadChunkBytes + 10),
  };
  assert.equal(uploadChunk(h)?.count, 2);
  for (const bad of [
    { ...h, 'x-upload-bytes': '10485761' },
    { ...h, 'x-upload-count': '4' },
    { ...h, 'x-upload-index': '2' },
    { ...h, 'x-upload-id': 'foreign/path' },
    { 'x-upload-id': id },
  ])
    assert.throws(() => uploadChunk(bad));
});
test('private upload parts assemble exact bytes, isolate actors and reject incomplete or oversized parts', async () => {
  const keys: string[] = [],
    blocks = new Map<string, Buffer>();
  const container = {
    getProperties: async () => ({}),
    getBlockBlobClient: (key: string) => {
      keys.push(key);
      return {
        stageBlock: async (id: string, data: Buffer) => {
          blocks.set(id, data);
        },
        commitBlockList: async (ids: string[]) => {
          if (ids.some(id => !blocks.has(id))) throw Error();
        },
        downloadToBuffer: async () => Buffer.concat([...blocks.entries()].sort().map(([, b]) => b)),
      };
    },
  } as unknown as ContainerClient;
  const bytes = uploadChunkBytes + 10,
    first = { id, index: 0, count: 2, bytes },
    last = { ...first, index: 1 };
  assert.equal(
    await assembleUpload(
      container,
      id,
      'owner',
      'claim',
      2,
      first,
      Buffer.alloc(uploadChunkBytes),
      'application/pdf',
      'proof.pdf',
      10485760,
    ),
    undefined,
  );
  const full = await assembleUpload(
    container,
    id,
    'owner',
    'claim',
    2,
    last,
    Buffer.alloc(10),
    'application/pdf',
    'proof.pdf',
    10485760,
  );
  assert.equal(full?.length, bytes);
  assert.equal(keys[0], keys[1]);
  await assembleUpload(
    container,
    id,
    'other',
    'claim',
    2,
    first,
    Buffer.alloc(uploadChunkBytes),
    'application/pdf',
    'proof.pdf',
    10485760,
  );
  assert.notEqual(keys[0], keys[2]);
  await assert.rejects(
    assembleUpload(
      container,
      id,
      'owner',
      'claim',
      2,
      last,
      Buffer.alloc(9),
      'application/pdf',
      'proof.pdf',
      10485760,
    ),
  );
  await assert.rejects(
    assembleUpload(
      container,
      id,
      'owner',
      'claim',
      2,
      first,
      Buffer.alloc(uploadChunkBytes),
      'application/pdf',
      'proof.pdf',
      100,
    ),
  );
  blocks.clear();
  await assert.rejects(
    assembleUpload(
      container,
      id,
      'owner',
      'claim',
      2,
      last,
      Buffer.alloc(10),
      'application/pdf',
      'proof.pdf',
      10485760,
    ),
    /complete upload/,
  );
  const publicContainer = {
    getProperties: async () => ({ blobPublicAccess: 'blob' }),
  } as unknown as ContainerClient;
  await assert.rejects(
    assembleUpload(
      publicContainer,
      id,
      'owner',
      'claim',
      2,
      first,
      Buffer.alloc(uploadChunkBytes),
      'application/pdf',
      'proof.pdf',
      10485760,
    ),
    /Private/,
  );
});
