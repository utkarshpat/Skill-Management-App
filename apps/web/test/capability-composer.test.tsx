import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { relatedSkillIds, submissionPayload } from '../src/capabilities/capability-model';
import { CertificateFilePreview } from '../src/certifications/CertificateFilePreview';
test('one credential can support several canonical skills without duplicating a file or credential', () => {
  const skills = ['azure', 'api'].map(id => ({
    id: 'claim-' + id,
    revision: 0,
    choice: { id, name: id, category: 'Cloud', definitionRevision: 1, levels: [] },
    reuse: false,
    rank: 2,
    experienceMonths: 6,
    description: 'Worked on services',
    projects: '',
    evidence: '',
    lastUsedOn: '',
  }));
  const certificate = {
    id: 'certificate',
    revision: 0,
    reuse: false,
    fields: {
      certificationName: 'Azure Developer',
      provider: 'Microsoft',
      category: 'Cloud',
      certificationDate: '2026-01-01',
      expiryDate: null,
      credentialId: '',
      credentialUrl: '',
      notes: '',
    },
    skillIds: ['azure', 'api', 'api', 'invented'],
    uploaded: false,
  };
  const payload = submissionPayload('request', 0, skills, [certificate]);
  assert.equal(payload.skills.length, 2);
  assert.equal(payload.certifications.length, 1);
  assert.deepEqual(payload.certifications[0].skillIds, ['azure', 'api']);
  assert.deepEqual(relatedSkillIds(certificate.skillIds, ['api']), ['api']);
  assert.equal('file' in payload.certifications[0], false);
});
test('supporting file previews identify evidence without calling it a certificate', () => {
  const html = renderToStaticMarkup(
    <CertificateFilePreview
      url="blob:fixture"
      mimeType="image/webp"
      fileName="project.webp"
      noun="evidence"
    />,
  );
  assert.match(html, /View evidence/);
  assert.match(html, /Evidence preview/);
  assert.doesNotMatch(html, /View certificate/);
});
