import test from 'node:test';
import assert from 'node:assert/strict';
import {
  restoreIntakeCertificates,
  certificateForAutofill,
  mergeCertificateAutofillFields,
} from '../src/capabilities/certificate-intake';
import type { SelectedCertificate, Submission } from '../src/capabilities/capability-model';
import { emptyCertification } from '../src/certifications/certification-model';

const certificate = (): SelectedCertificate => ({
  id: 'cert',
  revision: 0,
  reuse: false,
  fields: {} as any,
  skillIds: ['skill'],
  uploaded: false,
});

test('autofill applies explicit no-expiry to blank and dated forms without treating unknown expiry as lifetime', () => {
  for (const expiryDate of ['', '2027-01-01']) {
    const cert = { ...certificate(), fields: { ...emptyCertification(), expiryDate } };
    assert.equal(mergeCertificateAutofillFields(cert, { expiryDate: null }).expiryDate, null);
    assert.equal(mergeCertificateAutofillFields(cert, { expiryDate: '' }).expiryDate, expiryDate);
    assert.equal(mergeCertificateAutofillFields(cert, {}).expiryDate, expiryDate);
    assert.equal(
      mergeCertificateAutofillFields(cert, { expiryDate: '2028-02-01' }).expiryDate,
      '2028-02-01',
    );
  }
  const renewed = {
    ...certificate(),
    renewedFromId: 'original',
    fields: { ...emptyCertification(), certificationName: 'Existing family', provider: 'Issuer' },
  };
  const fields = mergeCertificateAutofillFields(renewed, {
    certificationName: 'Different family',
    provider: 'Other issuer',
    expiryDate: null,
    credentialId: 'New ID',
  });
  assert.equal(fields.certificationName, 'Existing family');
  assert.equal(fields.provider, 'Issuer');
  assert.equal(fields.expiryDate, null);
  assert.equal(fields.credentialId, 'New ID');
});

test('recovery discards unconfirmed local replacements and identifies only the saved staged file', () => {
  const local = new File(['new'], 'NEW.pdf', { type: 'application/pdf' });
  const value = {
    intake: { skills: [], certifications: [{ ...certificate(), file: local }] },
    stagedFiles: [{ certificationId: 'CERT', id: 'old', fileName: 'OLD.pdf' }],
  } as unknown as Submission;
  const [restored] = restoreIntakeCertificates(value);
  assert.equal(restored.file, undefined);
  assert.equal(restored.uploaded, true);
  assert.equal(restored.staged, true);
  const [missing] = restoreIntakeCertificates({ ...value, stagedFiles: [] });
  assert.equal(missing.file, undefined);
  assert.equal(missing.uploaded, false);
  assert.equal(missing.staged, false);
});

test('explicit autofill reads a saved staged or materialized file through exact authorized endpoints', async () => {
  for (const staged of [true, false]) {
    const paths: string[] = [];
    const signal = new AbortController().signal;
    const result = await certificateForAutofill(
      { ...certificate(), uploaded: true, staged },
      'submission',
      async (path, init) => {
        assert.equal(init.signal, signal);
        paths.push(path);
        return paths.length === 1
          ? Response.json({
              items: [{ id: 'file', fileName: 'saved.pdf', mimeType: 'application/pdf', bytes: 4 }],
            })
          : new Response('data');
      },
      signal,
    );
    assert.equal(result.name, 'saved.pdf');
    assert.equal(result.type, 'application/pdf');
    assert.equal(await result.text(), 'data');
    assert.deepEqual(
      paths,
      staged
        ? [
            '/api/capability-submissions/submission/staged/cert',
            '/api/capability-submissions/submission/staged/cert/file',
          ]
        : ['/api/certifications/cert/image', '/api/certifications/cert/image/file'],
    );
  }
});

test('autofill preserves local replacements and fails closed on denied, incomplete, oversized or cancelled reads', async () => {
  const local = new File(['new'], 'new.pdf', { type: 'application/pdf' });
  assert.equal(
    await certificateForAutofill(
      { ...certificate(), file: local },
      'submission',
      async () => {
        throw Error('must not fetch');
      },
      new AbortController().signal,
    ),
    local,
  );
  for (const bytes of [0, 5 * 1024 * 1024 + 1, 4]) {
    let reads = 0;
    await assert.rejects(
      certificateForAutofill(
        certificate(),
        'submission',
        async () => {
          reads++;
          return reads === 1
            ? Response.json({
                items: [{ id: 'file', fileName: 'saved.pdf', mimeType: 'application/pdf', bytes }],
              })
            : new Response('incomplete');
        },
        new AbortController().signal,
      ),
    );
    assert.equal(reads, bytes === 4 ? 2 : 1);
  }
  await assert.rejects(
    certificateForAutofill(
      certificate(),
      'submission',
      async () => Response.json({ error: { message: 'Access revoked' } }, { status: 403 }),
      new AbortController().signal,
    ),
    /Access revoked/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    certificateForAutofill(
      certificate(),
      'submission',
      async () => {
        throw Error('must not fetch');
      },
      controller.signal,
    ),
    { name: 'AbortError' },
  );
});
