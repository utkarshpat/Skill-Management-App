import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  relatedSkillIds,
  submissionPayload,
  mergeCertificateSuggestions,
} from '../src/capabilities/capability-model';
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

test('AI suggestions retain independent certificate sources and refreshing one does not erase the other', () => {
  const choice = (id: string) => ({
    id,
    name: id,
    category: 'Cloud',
    definitionRevision: 1,
    levels: [],
  });
  const first = mergeCertificateSuggestions([], 'certificate-a', [
    { skill: choice('azure'), reason: 'Azure topic' },
    { skill: choice('api'), reason: 'API topic' },
  ]);
  const both = mergeCertificateSuggestions(first, 'certificate-b', [
    { skill: choice('azure'), reason: 'Second Azure evidence' },
  ]);
  assert.equal(both.length, 3);
  assert.deepEqual(
    both.filter(v => v.skill.id === 'azure').map(v => v.certificateId),
    ['certificate-a', 'certificate-b'],
  );
  const refreshed = mergeCertificateSuggestions(both, 'certificate-a', [
    { skill: choice('security'), reason: 'Corrected extraction' },
  ]);
  assert.deepEqual(
    refreshed.map(v => [v.certificateId, v.skill.id]),
    [
      ['certificate-b', 'azure'],
      ['certificate-a', 'security'],
    ],
  );
});
