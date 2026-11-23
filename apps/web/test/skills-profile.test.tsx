import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { SkillsProfileView } from '../src/SkillsProfileView';
import type { Claim } from '../src/MySkills';
const statuses: Claim['status'][] = [
  'DRAFT',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
];
const claims = statuses.map((status, index) => ({
  id: String(index),
  revision: 1,
  skillId: String(index),
  skillName: 'Skill ' + index,
  category: index % 2 ? 'Cloud & DevOps' : 'Programming',
  definitionRevision: 1,
  rank: 3,
  levelName: 'Intermediate',
  experienceMonths: 24,
  description: 'Synthetic experience',
  status,
  updatedAt: '2026-10-03T12:00:00Z',
}));
function render(canClaim = true) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SkillsProfileView
        claims={claims}
        canClaim={canClaim}
        loading={false}
        onView={() => {}}
        onEdit={() => {}}
        onSubmit={() => {}}
      />
    </MemoryRouter>,
  );
}
test('skill profile totals and overview account for every status without claiming verified capability', () => {
  const html = render();
  assert.match(html, /Total skills: 5/);
  assert.match(html, /Approved: 1/);
  assert.match(html, /Pending approval: 1/);
  assert.match(html, /Self-assessed: 1/);
  assert.match(html, /2 Needs attention/);
  assert.doesNotMatch(html, />Verified</);
  assert.match(html, /Filter skill category/);
  assert.match(html, /Filter proficiency level/);
});
test('skill profile exposes editing only for editable statuses and suppresses mutations without permission', () => {
  const html = render();
  for (const index of [0, 2, 4]) assert.match(html, new RegExp('Edit Skill ' + index + ' draft'));
  for (const index of [1, 3])
    assert.doesNotMatch(html, new RegExp('Edit Skill ' + index + ' draft'));
  const readOnly = render(false);
  assert.doesNotMatch(
    readOnly,
    /Edit Skill \d draft|Submit Skill \d for approval|Reroute Skill \d for approval/,
  );
  assert.match(readOnly, /View Skill 0 claim/);
});

test('unified portfolio shows Skills, Certifications, Pending and Needs attention KPIs with merged Needs action chip', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SkillsProfileView
        unified
        claims={claims}
        certificates={[
          {
            id: 'cert-1',
            revision: 1,
            personId: 'p1',
            name: 'Aditi',
            employeeCode: 'E1',
            certificationName: 'Azure Administrator',
            provider: 'Microsoft',
            category: 'Cloud & DevOps',
            certificationDate: '2025-01-10',
            expiryDate: '2026-11-30',
            credentialId: 'AZ-104',
            credentialUrl: '',
            notes: '',
            status: 'APPROVED',
            feedback: '',
            canEdit: false,
            canSubmit: false,
            canReview: false,
          },
          {
            id: 'cert-2',
            revision: 1,
            personId: 'p1',
            name: 'Aditi',
            employeeCode: 'E1',
            certificationName: 'AWS Practitioner',
            provider: 'AWS',
            category: 'Cloud & DevOps',
            certificationDate: '2026-06-01',
            expiryDate: null,
            credentialId: 'AWS-1',
            credentialUrl: '',
            notes: '',
            status: 'SUBMITTED',
            feedback: '',
            canEdit: false,
            canSubmit: false,
            canReview: false,
          },
        ]}
        certificatesToday="2026-11-23"
        canClaim
        canManageCertificates
        loading={false}
        onView={() => {}}
        onEdit={() => {}}
        onSubmit={() => {}}
        onCertificate={() => {}}
      />
    </MemoryRouter>,
  );
  assert.match(html, /Skills: 5/);
  assert.match(html, /Certifications: 2/);
  assert.match(html, /Pending: 2/);
  assert.match(html, /Needs attention: 4/);
  assert.match(html, /Needs action<span>6<\/span>/);
  assert.match(html, /Approved<span>2<\/span>/);
  assert.doesNotMatch(html, /Total skills:/);
  assert.match(html, /Azure Administrator/);
  assert.match(html, /AWS Practitioner/);
});

test('unified portfolio does not double-count pending expiring certifications in Needs attention', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SkillsProfileView
        unified
        claims={[]}
        certificates={[
          {
            id: 'cert-pending-expiring',
            revision: 1,
            personId: 'p1',
            name: 'Aditi',
            employeeCode: 'E1',
            certificationName: 'Pending Expiring Cert',
            provider: 'Microsoft',
            category: 'Cloud & DevOps',
            certificationDate: '2025-01-10',
            expiryDate: '2026-11-30',
            credentialId: 'AZ-999',
            credentialUrl: '',
            notes: '',
            status: 'SUBMITTED',
            feedback: '',
            canEdit: false,
            canSubmit: false,
            canReview: false,
          },
        ]}
        certificatesToday="2026-11-23"
        canClaim
        canManageCertificates
        loading={false}
        onView={() => {}}
        onEdit={() => {}}
        onSubmit={() => {}}
        onCertificate={() => {}}
      />
    </MemoryRouter>,
  );
  assert.match(html, /Pending: 1/);
  assert.match(html, /Needs attention: 0/);
  assert.match(html, /Needs action<span>1<\/span>/);
});
