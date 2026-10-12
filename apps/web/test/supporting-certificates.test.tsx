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
