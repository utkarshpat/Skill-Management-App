import test from 'node:test';
import assert from 'node:assert/strict';
import { readBusinessFile } from '../src/modules/business/files.js';
import { AccessError } from '../src/shared/errors.js';
const id = '00000000-0000-4000-8000-000000000001';
const state = () => ({
  revision: 2,
  workspaceRevision: 7,
  references: '',
  items: [
    { id, blobName: 'private', bytes: 3, mimeType: 'application/pdf', fileName: 'certificate.pdf' },
  ],
});
test('scoped file reads reject missing/oversized items before Blob IO', async () => {
  for (const items of [[], [{ ...state().items[0], bytes: 10485761 }]]) {
    let downloads = 0;
    await assert.rejects(
      readBusinessFile(
        async () => ({ ...state(), items }),
        async () => {
          downloads++;
          return Buffer.from('pdf');
        },
        id,
      ),
    );
    assert.equal(downloads, 0);
  }
});

test('scoped skill PDF evidence above 5 MB remains readable within the 10 MB evidence limit', async () => {
  const data = Buffer.alloc(6 * 1024 * 1024);
  const metadata = {
    ...state(),
    items: [{ ...state().items[0], bytes: data.length, fileName: 'skill-proof.pdf' }],
  };
  const result = await readBusinessFile(
    async () => metadata,
    async () => data,
    id,
  );
  assert.equal(result.data.length, data.length);
});
test('scoped file delivery fails closed on revocation, changed snapshot, replaced object and partial bytes', async () => {
  for (const after of [
    new AccessError(403, 'Revoked'),
    { ...state(), workspaceRevision: 8 },
    { ...state(), revision: 3 },
    { ...state(), items: [] },
    { ...state(), items: [{ ...state().items[0], blobName: 'replaced' }] },
  ]) {
    let reads = 0;
    await assert.rejects(
      readBusinessFile(
        async () => {
          if (++reads === 1) return state();
          if (after instanceof Error) throw after;
          return after;
        },
        async () => Buffer.from('pdf'),
        id,
      ),
    );
  }
  await assert.rejects(
    readBusinessFile(
      async () => state(),
      async () => Buffer.from('p'),
      id,
    ),
    /Complete file/,
  );
  const success = await readBusinessFile(
    async () => state(),
    async () => Buffer.from('pdf'),
    id,
  );
  assert.equal(success.data.toString(), 'pdf');
});
