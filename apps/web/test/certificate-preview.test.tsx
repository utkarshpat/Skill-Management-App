import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CertificateFilePreview } from '../src/certifications/CertificateFilePreview';
import { certificatePreviewUrl } from '../src/certifications/certificate-preview-url';

test('a closed preview allocates no URL when a late download completes', async () => {
  const controller = new AbortController();
  let resolve: (value: Blob) => void = () => {};
  let created = 0;
  const read = new Promise<Blob>(done => {
    resolve = done;
  });
  const result = certificatePreviewUrl(() => read, controller.signal, {
    createObjectURL: () => {
      created++;
      return 'blob:file';
    },
    revokeObjectURL: () => {},
  });
  controller.abort();
  resolve(new Blob(['certificate']));
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(created, 0);
});
test('a URL allocated during cancellation is immediately released', async () => {
  const controller = new AbortController();
  const released: string[] = [];
  await assert.rejects(
    certificatePreviewUrl(async () => new Blob(['certificate']), controller.signal, {
      createObjectURL: () => {
        controller.abort();
        return 'blob:file';
      },
      revokeObjectURL: url => released.push(url),
    }),
    { name: 'AbortError' },
  );
  assert.deepEqual(released, ['blob:file']);
});
test('DOCX downloads retain filenames; PDF/image previews retain their open action', () => {
  const word = renderToStaticMarkup(
    <CertificateFilePreview
      url="blob:file"
      mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      fileName="Azure credential.docx"
    />,
  );
  assert.match(word, /download="Azure credential.docx"/);
  assert.match(word, /Download file/);
  assert.doesNotMatch(word, /target="_blank"|Open file/);
  const pdf = renderToStaticMarkup(
    <CertificateFilePreview url="blob:file" mimeType="application/pdf" fileName="credential.pdf" />,
  );
  assert.match(pdf, /Open file/);
  assert.match(pdf, /download="credential.pdf"/);
  const image = renderToStaticMarkup(
    <CertificateFilePreview url="blob:file" mimeType="image/webp" fileName="credential.webp" />,
  );
  assert.match(image, /Open certificate image/);
  assert.match(image, /alt="Certificate preview"/);
});
