import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  relatedSkillIds,
  submissionPayload,
  mergeCertificateSuggestions,
  submissionLevelName,
  submissionReviewState,
  credentialSkillDefaults,
  activeCertificateSuggestions,
} from '../src/capabilities/capability-model';
import { CertificateFilePreview } from '../src/certifications/CertificateFilePreview';

test('continuing a draft restores current catalogue suggestions and removes deleted certificate sources', () => {
  const skill = {
    id: 'oic',
    name: 'Oracle OIC',
    category: 'Oracle Platform',
    definitionRevision: 1,
    levels: [],
  };
  const definition = { name: 'Oracle Integration', provider: 'Oracle', relatedSkills: [skill] };
  const fields = {
    certificationName: 'Oracle Integration',
    provider: 'Oracle',
    category: 'Oracle Platform',
    certificationDate: '2026-10-01',
    expiryDate: null,
    credentialId: '',
    credentialUrl: '',
    notes: '',
  };
  const recovered = JSON.parse(JSON.stringify([{ id: 'certificate', fields }]));
  assert.deepEqual(
    activeCertificateSuggestions(recovered, [definition], []).map(s => [
      s.certificateId,
      s.skill.id,
    ]),
    [['certificate', 'oic']],
  );
  const stale = { certificateId: 'deleted', skill, reason: 'Old result' };
  assert.deepEqual(activeCertificateSuggestions([], [definition], [stale]), []);
  assert.equal(activeCertificateSuggestions(recovered, [], [stale]).length, 0);
});

test('catalogue mappings propose multiple canonical skills only for matching credential and issuer', () => {
  const skills = ['oic', 'oci'].map(id => ({
    id,
    name: id,
    category: 'Oracle Platform',
    definitionRevision: 1,
    levels: [{ rank: 1, name: 'Foundation', description: 'Guided work' }],
  }));
  const definitions = [{ name: 'Oracle Integration', provider: 'Oracle', relatedSkills: skills }];
  assert.deepEqual(
    credentialSkillDefaults(definitions, {
      certificationName: '  oracle   integration ',
      provider: 'ORACLE',
    }).map(s => s.skill.id),
    ['oic', 'oci'],
  );
  assert.deepEqual(
    credentialSkillDefaults(definitions, {
      certificationName: 'Oracle Integration',
      provider: 'Other issuer',
    }),
    [],
  );
  assert.deepEqual(
    credentialSkillDefaults(definitions, {
      certificationName: 'Other credential',
      provider: 'Oracle',
    }),
    [],
  );
  assert.ok(
    credentialSkillDefaults(definitions, {
      certificationName: 'Oracle Integration',
      provider: 'Oracle',
    }).every(s => !('rank' in s)),
  );
});

test('review proficiency comes from the saved version and never relabels historical ranks', () => {
  assert.equal(
    submissionLevelName({ rank: 2, levels: [{ rank: 2, name: 'Beginner' }] }),
    'Beginner',
  );
  assert.equal(
    submissionLevelName({ rank: 2, levels: [{ rank: 2, name: 'Autonomous' }] }),
    'Autonomous',
  );
  assert.equal(submissionLevelName({ rank: 5, levels: [{ rank: 5, name: 'Expert' }] }), 'Expert');
  assert.equal(submissionLevelName({ rank: 2 }), '');
});

test('historical review states distinguish decisions from immutable needs-review flags', () => {
  assert.equal(submissionReviewState('APPROVED', true, false), 'Manager reviewed');
  assert.equal(submissionReviewState('CHANGES_REQUESTED', true, false), 'Changes requested');
  assert.equal(submissionReviewState('REJECTED', true, false), 'Not approved');
  assert.equal(submissionReviewState('SUBMITTED', true, true), 'Needs decision');
  assert.equal(submissionReviewState('SUBMITTED', true, false), 'Awaiting review');
});
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
