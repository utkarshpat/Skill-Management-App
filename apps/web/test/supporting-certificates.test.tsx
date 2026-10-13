import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SupportingCertificates,
  certificatesForSkill,
  uniqueCertificates,
} from '../src/capabilities/SupportingCertificates';
import type { CertificationRecord } from '../src/certifications/types';

const certificate = {
  id: 'certificate-one',
  certificationName: 'Cloud Developer',
  provider: 'QA',
  status: 'APPROVED',
  expiryDate: '2026-10-01',
  relatedSkills: [
    { id: 'azure', name: 'Azure' },
    { id: 'api', name: 'API' },
  ],
} as CertificationRecord;
test('approved renewal replaces supporting display; expired unrenewed records remain', () => {
  const renewed = { ...certificate, id: 'new', credentialId: 'new-id', expiryDate: '2028-10-01' };
  const old = { ...certificate, supersededById: 'new' };
  assert.deepEqual(
    certificatesForSkill([old, renewed], 'azure').map(c => c.id),
    ['new'],
  );
  assert.deepEqual(
    certificatesForSkill([certificate], 'azure').map(c => c.id),
    [certificate.id],
  );
  assert.equal(uniqueCertificates([old, renewed]).length, 2);
});
test('one certificate supports multiple skill rows while certificate totals remain distinct', () => {
  const records = [certificate, { ...certificate, id: certificate.id.toUpperCase() }];
  assert.equal(uniqueCertificates(records).length, 1);
  assert.equal(certificatesForSkill(records, 'AZURE').length, 1);
  assert.equal(certificatesForSkill(records, 'api').length, 1);
  assert.equal(certificatesForSkill(records, 'unrelated').length, 0);
});
test('supporting certificates preserve independent reviewed and expired states and a view action', () => {
  const html = renderToStaticMarkup(
    <SupportingCertificates
      records={[certificate]}
      skillId="azure"
      onOpen={() => {}}
      today="2026-10-12"
    />,
  );
  assert.match(html, /Manager reviewed/);
  assert.match(html, /Expired/);
  assert.match(html, /Cloud Developer/);
  assert.match(html, /<button/);
  assert.equal(
    renderToStaticMarkup(
      <SupportingCertificates records={[certificate]} skillId="other" onOpen={() => {}} />,
    ),
    '',
  );
});
