import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { zipSync, strToU8 } from 'fflate';
import { BlockBlobClient, ContainerClient } from '@azure/storage-blob';
import {
  compressEvidence,
  prepareCertificateFile,
  SqlBlobEvidenceStore,
  type EvidenceState,
} from '../src/modules/skills/evidence.js';
import { AccessError } from '../src/shared/errors.js';
import { readFile } from 'node:fs/promises';
test('certificate attachments allow validated PDF, DOCX and text, while images stay compressed', async () => {
  const document = await PDFDocument.create();
  document.addPage();
  const pdf = await prepareCertificateFile(
    Buffer.from(await document.save()),
    'application/pdf',
    '../../private\r\nname.pdf',
  );
  assert.equal(pdf.mimeType, 'application/pdf');
  assert.equal(pdf.fileName, '.._.._private__name.pdf');
  assert.equal(pdf.width, null);
  assert.equal(pdf.data.toString('ascii', 0, 5), '%PDF-');
  const docx = await prepareCertificateFile(
      Buffer.from(
        zipSync({
          '[Content_Types].xml': strToU8(
            '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
          ),
          '_rels/.rels': strToU8(
            '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
          ),
          'word/document.xml': strToU8(
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
          ),
        }),
      ),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'credential.docx',
    ),
    text = await prepareCertificateFile(
      Buffer.from('Issuer credential reference', 'utf8'),
      'text/plain',
      'credential.txt',
    );
  assert.equal(
    docx.mimeType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  assert.equal(text.fileName, 'credential.txt');
  await assert.rejects(
    prepareCertificateFile(Buffer.from('not a pdf'), 'application/pdf', 'fake.pdf'),
    /valid, readable PDF/,
  );
  await assert.rejects(
    prepareCertificateFile(Buffer.from([0, 1]), 'text/plain', 'bad.txt'),
    /UTF-8/,
  );
  await assert.rejects(
    prepareCertificateFile(Buffer.alloc(5 * 1024 * 1024 + 1), 'application/pdf', 'large.pdf'),
    /up to 5 MB/,
  );
});
test('Evidence compression validates decoded image, limits dimensions and strips metadata', async () => {
  const input = await sharp({
    create: { width: 2500, height: 1200, channels: 3, background: '#198596' },
  })
    .jpeg()
    .withMetadata()
    .toBuffer();
  const out = await compressEvidence(input),
    meta = await sharp(out.data).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(out.width, 1920);
  assert.ok(out.height <= 1920);
  assert.ok(out.data.length <= 1048576);
  assert.equal(meta.exif, undefined);
});
test('Evidence rejects active SVG content, non-images and oversized input', async () => {
  for (const data of [
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>',
    ),
    Buffer.from('not an image'),
    Buffer.alloc(1048577),
  ])
    await assert.rejects(compressEvidence(data));
});
test('Evidence SQL resolves claim ownership, matching review policy and transactional revision', async () => {
  const source = await readFile(
    new URL('../../../database/migrations/050_skill_evidence.sql', import.meta.url),
    'utf8',
  );
  for (const guard of [
    'AccessRuntimeAccount',
    'AccessCanReviewClaim',
    '@owner=@actor_id',
    '@revision<>@expected_revision',
    'Maximum six images',
    'claim.evidence.added',
    'UPDLOCK,HOLDLOCK',
  ])
    assert.ok(source.includes(guard), guard);
});
test('Submitted evidence migration retains access guards and uses claim-bound audit ordering', async () => {
  const source = await readFile(
    new URL('../../../database/migrations/051_submitted_skill_evidence.sql', import.meta.url),
    'utf8',
  );
  for (const guard of [
    'AccessRuntimeAccount',
    'AccessCanReviewClaim(@account_id,@actor_id,@claim_id,0)',
    '@owner=@actor_id',
    '@revision<>@expected_revision',
    'Maximum six images',
    'UPDLOCK,HOLDLOCK',
    "action='claim.submitted'",
    "a.action='claim.evidence.added'",
    'a.revision<@submission',
    'a.account_id=e.account_id AND a.target_id=e.claim_id',
    "JSON_VALUE(a.after_json,'$.evidenceId')",
    '@submission IS NULL',
  ])
    assert.ok(source.includes(guard), guard);
  assert.doesNotMatch(source, /DELETE|UPDATE dbo\.AccessAudit|ALTER TABLE|created_at\s*[<>=]/i);
  const runner = await readFile(new URL('../src/database-cli.ts', import.meta.url), 'utf8');
  assert.ok(runner.replace(/\s+/g, '').includes("[51,'051_submitted_skill_evidence.sql']"));
});
const item = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  blobName: 'private/claim/image.webp',
  bytes: 3,
  width: 1,
  height: 1,
};
const visible: EvidenceState = { revision: 4, canUpload: false, items: [item] };
function store() {
  return new SqlBlobEvidenceStore('account', 'UseDevelopmentStorage=true', 'evidence');
}
test('A hidden draft image is rejected before any Blob download', async t => {
  const evidence = store();
  let downloads = 0;
  t.mock.method(evidence, 'read', async () => ({ ...visible, items: [] }));
  t.mock.method(BlockBlobClient.prototype, 'downloadToBuffer', async () => {
    downloads++;
    return Buffer.from('img');
  });
  await assert.rejects(
    evidence.image('manager', 'claim', item.id),
    e => e instanceof AccessError && e.status === 404,
  );
  assert.equal(downloads, 0);
});
test('Image bytes are returned only after current item membership is rechecked', async t => {
  const evidence = store();
  let reads = 0;
  t.mock.method(evidence, 'read', async () => {
    reads++;
    return visible;
  });
  t.mock.method(BlockBlobClient.prototype, 'downloadToBuffer', async () => Buffer.from('img'));
  assert.deepEqual(
    await evidence.image('manager', 'claim', item.id.toUpperCase()),
    Buffer.from('img'),
  );
  assert.equal(reads, 2);
});
test('Image snapshot removal or changed reference during download never returns bytes', async t => {
  const evidence = store();
  t.mock.method(BlockBlobClient.prototype, 'downloadToBuffer', async () => Buffer.from('img'));
  for (const current of [
    { ...visible, items: [] },
    { ...visible, items: [{ ...item, blobName: 'changed.webp' }] },
  ]) {
    let reads = 0;
    const read = t.mock.method(evidence, 'read', async () => (++reads === 1 ? visible : current));
    await assert.rejects(
      evidence.image('manager', 'claim', item.id),
      e => e instanceof AccessError && e.status === 404,
    );
    assert.equal(reads, 2);
    read.mock.restore();
  }
});
test('Revoked reviewer access after Blob download is not swallowed', async t => {
  const evidence = store();
  let reads = 0;
  t.mock.method(evidence, 'read', async () => {
    if (++reads === 2) throw new AccessError(403, 'Evidence access is unavailable.');
    return visible;
  });
  t.mock.method(BlockBlobClient.prototype, 'downloadToBuffer', async () => Buffer.from('img'));
  await assert.rejects(
    evidence.image('manager', 'claim', item.id),
    e => e instanceof AccessError && e.status === 403,
  );
});

test('certificate documents reject signature-only, truncated and unrelated ZIP files', async () => {
  for (const source of [
    Buffer.from('not a document %PDF-'),
    Buffer.from('%PDF-1.7\ncredential'),
    Buffer.from('%PDF-1.7\nstartxref\n0\n%%EOF'),
  ])
    await assert.rejects(prepareCertificateFile(source, 'application/pdf', 'broken.pdf'));
  for (const source of [
    Buffer.from('504b0304', 'hex'),
    Buffer.from(zipSync({ 'random.txt': strToU8('not a credential') })),
    Buffer.from(zipSync({ 'word/document.xml': strToU8('<broken>') })),
  ])
    await assert.rejects(
      prepareCertificateFile(
        source,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'broken.docx',
      ),
    );
});

for (const outcome of ['committed', 'unknown', 'rejected'] as const)
  test(`Upload ${outcome} outcome never deletes a possibly committed attachment`, async t => {
    const evidence = new SqlBlobEvidenceStore(
      'account',
      'UseDevelopmentStorage=true',
      'evidence',
      'certification',
    );
    let saved: typeof item | undefined;
    let deleted = 0;
    t.mock.method(ContainerClient.prototype, 'getProperties', async () => ({}));
    t.mock.method(BlockBlobClient.prototype, 'uploadData', async () => ({}));
    t.mock.method(BlockBlobClient.prototype, 'deleteIfExists', async () => {
      deleted++;
      return {};
    });
    t.mock.method(
      evidence as any,
      'run',
      async (
        _actor: string,
        _claim: string,
        action: string,
        _revision: number,
        attachment: typeof item,
      ) => {
        if (action === 'CHECK') return { revision: 4, canUpload: true, items: [] };
        if (action === 'ADD') {
          saved = attachment;
          throw outcome === 'rejected'
            ? new AccessError(409, 'Changed')
            : new Error('Connection lost after SQL execution');
        }
        if (outcome === 'unknown') throw new Error('Database unavailable');
        return { revision: 5, canUpload: true, items: [saved] };
      },
    );
    const uploading = evidence.upload('actor', 'claim', 4, Buffer.from('Certificate facts'), {
      mimeType: 'text/plain',
      fileName: 'certificate.txt',
    });
    if (outcome === 'committed') assert.equal((await uploading).revision, 5);
    else await assert.rejects(uploading);
    assert.equal(deleted, outcome === 'rejected' ? 1 : 0);
  });
