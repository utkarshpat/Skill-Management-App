import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { generateCertificationsCsv, csvCell } from '../src/certifications/certification-reports';
import { issuerLink, type CertificationRecord } from '../src/certifications/types';
import type { WorkspaceState } from '../src/Workspace';
import { personalNavigationItems } from '../src/WorkspaceNavigation';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
  export async function load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export {}' };
    if (url.endsWith('/auth.ts')) return {
      format: 'module', shortCircuit: true,
      source: 'export const authenticatedFetch = (...args) => globalThis.fetch(...args);'
    };
    return nextLoad(url, context);
  }
`),
);
const { Certifications } = await import('../src/certifications/Certifications');
const { parseCertificationPage } = await import('../src/certifications/certification-api');

const record: CertificationRecord = {
  id: '00000000-0000-4000-8000-000000000003',
  personId: '00000000-0000-4000-8000-000000000001',
  reviewerId: null,
  revision: 1,
  name: '=SUM(1,1)',
  employeeCode: 'E1',
  du: 'Unit A',
  certificationName: 'Cloud "credential"',
  provider: 'Issuer',
  category: 'Cloud',
  certificationDate: '2025-01-01',
  expiryDate: null,
  doesNotExpire: 'Yes',
  active: 'N',
  status: 'SUBMITTED',
  verified: false,
  credentialId: 'TEST',
  credentialUrl: 'https://issuer.example/record',
  feedbackNote: '',
  reviewedBy: null,
  reviewedAt: null,
  submittedAt: null,
  canEdit: false,
  canReview: false,
  routingMismatch: false,
  reviewReason: 'SELF_REVIEW',
  history: [],
};
const workspace: WorkspaceState = {
  person: {
    id: record.personId,
    displayName: 'Employee',
    employeeCode: 'E1',
    roles: ['Administrator Capability Lead'],
  },
  authentication: 'microsoft',
  capabilities: {
    ownProfile: true,
    ownSkills: false,
    claimSkills: false,
    catalogue: false,
    administration: true,
    manageCatalogue: true,
    certifications: true,
    ownCertifications: true,
    manageCertifications: true,
  },
  upcoming: [],
};
test('credential views consume explicit backend capabilities, not administrator/lead role names', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/certifications?tab=directory']}>
      <Certifications workspace={workspace} />
    </MemoryRouter>,
  );
  assert.match(html, /My certifications/);
  assert.doesNotMatch(
    html,
    /Organization directory|Assigned verification queue|Export filtered report|97%|Anupriya/,
  );
  assert.match(html, /Loading current certifications/);
  const denied = renderToStaticMarkup(
    <MemoryRouter>
      <Certifications
        workspace={{
          ...workspace,
          capabilities: { ...workspace.capabilities, ownCertifications: false },
        }}
      />
    </MemoryRouter>,
  );
  assert.match(denied, /Certification access is not assigned/);
  assert.doesNotMatch(denied, /Add certification/);
});
test('directory and review controls appear only with independently allowed credential actions', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/certifications?tab=directory']}>
      <Certifications
        workspace={{
          ...workspace,
          capabilities: {
            ...workspace.capabilities,
            certificationDirectory: true,
            exportCertifications: true,
            reviewCertifications: true,
          },
        }}
      />
    </MemoryRouter>,
  );
  assert.match(html, /Organization directory/);
  assert.match(html, /Assigned verification queue/);
  assert.match(html, /Export filtered report/);
  assert.doesNotMatch(html, /Add certification/);
  assert.match(html, /for="cert-search"/);
  assert.match(html, /for="cert-du-filter"/);
  assert.equal(
    personalNavigationItems({ ownProfile: false, ownSkills: false, certifications: false }).some(
      item => item.id === 'certifications',
    ),
    false,
  );
});
test('credential CSV discloses review and compliance separately, uses sequential rows and genuine expiry', () => {
  const csv = generateCertificationsCsv([record, { ...record, id: 'other' }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"Review Status","Verified"/);
  assert.match(csv, /"1",/);
  assert.match(csv, /"2",/);
  assert.match(csv, /"'=SUM\(1,1\)"/);
  assert.match(csv, /Cloud ""credential""/);
  assert.match(csv, /"Yes","","N"/);
  assert.doesNotMatch(csv, /2050-12-31|soprasteria/);
  for (const value of ['=x', ' +x', '\t@x', '-x', '\r=x'])
    assert.ok(csvCell(value).startsWith('"\''));
});
test('issuer links reject unsafe protocols and embedded credentials without pretending to resolve vendor metadata', () => {
  assert.ok(issuerLink('https://issuer.example/credential'));
  for (const url of [
    'javascript:alert(1)',
    'http://issuer.example',
    'not a URL',
    'https://user:secret@issuer.example',
  ])
    assert.equal(issuerLink(url), undefined);
});
test('malformed successful API data cannot produce rows, false empty states or unresolved action controls', () => {
  const valid = {
    items: [record],
    total: 1,
    activeCount: 0,
    expiringSoonCount: 0,
    page: 1,
    pageSize: 20,
    revision: 1,
  };
  assert.equal(parseCertificationPage(valid).items[0].canReview, false);
  for (const value of [
    undefined,
    {},
    { ...valid, items: [{}] },
    { ...valid, total: 0 },
    { ...valid, items: [{ ...record, canReview: undefined }] },
    { ...valid, items: [{ ...record, reviewedAt: undefined }] },
    { ...valid, items: [{ ...record, reviewerId: 'not an id' }] },
    { ...valid, items: [{ ...record, certificationDate: '2025-02-30' }] },
    { ...valid, items: [{ ...record, expiryDate: '2050-12-31' }] },
    { ...valid, items: [{ ...record, verified: true }] },
    { ...valid, items: [{ ...record, active: 'Y' }] },
    { ...valid, activeCount: 2 },
    { ...valid, items: [{ ...record, history: [{ action: 'APPROVED' }] }] },
  ])
    assert.throws(() => parseCertificationPage(value));
});
