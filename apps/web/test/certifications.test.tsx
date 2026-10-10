import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  certificationFieldError,
  certificationIdentityError,
  addCredentialMonths,
  credentialValidity,
  certificationRenewalFields,
  certificationStatusLabels,
} from '../src/certifications/certification-model';
import { notificationDestination } from '../src/notification-model';
import { renderToStaticMarkup } from 'react-dom/server';
import { CertificationProfileView } from '../src/certifications/CertificationProfileView';
import { loadCertificationPortfolio } from '../src/certifications/certification-portfolio';
import { prepareCertificateFile } from '../src/certifications/certificate-file';
import type { CertificationRecord, CertificationPage } from '../src/certifications/types';

const fields = {
  certificationName: 'Azure Fundamentals',
  provider: 'Microsoft',
  category: 'Cloud',
  certificationDate: '2026-01-01',
  expiryDate: '2026-09-01',
  credentialId: '',
  credentialUrl: 'https://issuer.example/badge',
  notes: '',
};
test('credential expiry remains independent of approval and includes the complete expiry day', () => {
  assert.equal(credentialValidity('2026-10-08', '2026-10-09'), 'Expired');
  assert.equal(credentialValidity('2026-10-09', '2026-10-09'), 'Expires soon');
  assert.equal(credentialValidity('2027-10-09', '2026-10-09'), 'Current');
  assert.equal(credentialValidity(null, '2026-10-09'), 'No expiry');
  assert.equal(certificationStatusLabels.APPROVED, 'Manager reviewed');
});
test('expiry quick-fill clamps month ends and leap years without rolling into another month', () => {
  assert.equal(addCredentialMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addCredentialMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addCredentialMonths('2026-10-09', 12), '2027-10-09');
  assert.equal(addCredentialMonths('2026-02-30', 6), '');
});
test('credential form validates dates, required issuer fields and safe links before advancing', () => {
  assert.equal(certificationFieldError(fields, '2026-10-09'), '');
  for (const patch of [
    { provider: '' },
    { certificationDate: '2026-02-30' },
    { certificationDate: '2027-01-01' },
    { expiryDate: '2025-12-31' },
    { expiryDate: '' },
    { credentialUrl: 'javascript:alert(1)' },
    { credentialUrl: 'https://user:password@issuer.example/' },
  ])
    assert.ok(certificationFieldError({ ...fields, ...patch }, '2026-10-09'));
  assert.equal(notificationDestination('/certifications?tab=queue')?.kind, 'Certifications');
  assert.equal(
    notificationDestination('/certifications?renew=credential-id')?.label,
    'Record renewal',
  );
});
test('renewal draft keeps credential identity but resets dates, attachment-specific details and notes', () => {
  assert.deepEqual(certificationRenewalFields(record('previous'), '2026-10-09'), {
    ...fields,
    certificationDate: '2026-10-09',
    expiryDate: '',
    credentialId: '',
    credentialUrl: '',
    notes: '',
  });
});

test('credential wizard allows identity step before dates while draft saving still requires a complete credential', () => {
  const incomplete = { ...fields, certificationDate: '', expiryDate: null };
  assert.equal(certificationIdentityError(incomplete), '');
  assert.ok(certificationFieldError(incomplete, '2026-10-09'));
  for (const patch of [
    { certificationName: ' ' },
    { provider: '' },
    { category: ' ' },
    { provider: 'x'.repeat(121) },
  ]) {
    assert.ok(certificationIdentityError({ ...incomplete, ...patch }));
  }
});

test('certificate picker accepts common document formats and keeps the 5 MB limit', async () => {
  for (const [name, type] of [
    ['credential.pdf', 'application/pdf'],
    ['credential.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['credential.txt', 'text/plain'],
  ]) {
    const file = await prepareCertificateFile(new File(['credential'], name, { type }));
    assert.equal(file.name, name);
    assert.equal(file.type, type);
  }
  await assert.rejects(
    prepareCertificateFile(
      new File(['credential'], 'credential.exe', { type: 'application/octet-stream' }),
    ),
    /PDF, JPEG, PNG, WebP, DOCX or TXT/,
  );
  await assert.rejects(
    prepareCertificateFile(
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' }),
    ),
    /up to 5 MB/,
  );
});

const record = (id: string): CertificationRecord => ({
  ...fields,
  id,
  revision: 1,
  personId: 'owner',
  name: 'Employee',
  employeeCode: 'QA',
  status: 'APPROVED',
  feedback: 'Issuer transcript checked',
  canEdit: false,
  canSubmit: false,
  canReview: false,
});
const page = (records: CertificationRecord[], total = records.length): CertificationPage => ({
  records,
  total,
  page: 1,
  pageSize: 25,
  canManage: true,
  canSubmitNew: true,
  canReview: false,
});
test('portfolio counts use every authorized page and reject changing, incomplete or duplicate results', async () => {
  const records = Array.from({ length: 26 }, (_, i) => record(String(i)));
  const requested: number[] = [];
  const result = await loadCertificationPortfolio(async n => {
    requested.push(n);
    return page(records.slice((n - 1) * 25, n * 25), 26);
  }, new AbortController().signal);
  assert.equal(result.records.length, 26);
  assert.deepEqual(requested, [1, 2]);
  await assert.rejects(
    loadCertificationPortfolio(
      async n => page(n === 1 ? records.slice(0, 25) : [], n === 1 ? 26 : 25),
      new AbortController().signal,
    ),
    /changed while loading/,
  );
  await assert.rejects(
    loadCertificationPortfolio(
      async n => page(n === 1 ? records.slice(0, 25) : [records[0]], 26),
      new AbortController().signal,
    ),
    /changed while loading/,
  );
  await assert.rejects(
    loadCertificationPortfolio(async () => page([], 1), new AbortController().signal),
    /changed while loading/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadCertificationPortfolio(async () => page([], 0), controller.signal),
    { name: 'AbortError' },
  );
});
test('skills-style certification profile keeps review and expiry separate and obeys record controls', () => {
  const html = renderToStaticMarkup(
    <CertificationProfileView
      records={[
        record('reviewed'),
        {
          ...record('draft'),
          certificationName: 'Draft credential',
          status: 'DRAFT',
          canEdit: true,
          canSubmit: true,
        },
      ]}
      today="2026-10-09"
      canManage
      canRenew
      onAdd={() => {}}
      onView={() => {}}
      onEdit={() => {}}
      onRenew={() => {}}
      onSubmit={() => {}}
      onReview={() => {}}
    />,
  );
  assert.match(html, /Total certifications: 2/);
  assert.match(html, /Manager reviewed: 1/);
  assert.match(html, /Filter certification review status/);
  assert.match(html, /Filter credential validity/);
  assert.match(html, /Expired/);
  assert.match(
    html,
    /Manager reviewed<\/span><span class="cert-review-validity cert-expired">Expired<\/span>/,
  );
  assert.match(html, /Certification profile overview/);
  assert.doesNotMatch(html, /Edit Azure Fundamentals draft/);
  assert.doesNotMatch(html, /Submit Azure Fundamentals for review/);
  assert.match(html, /Edit Draft credential draft/);
  assert.match(html, /Submit Draft credential for review/);
  assert.match(html, /Record renewal for Azure Fundamentals/);
});

test('portfolio pages load in bounded parallel batches and preserve page ordering', async () => {
  const records = Array.from({ length: 101 }, (_, i) => record(String(i)));
  const waiting = new Map<number, () => void>();
  let active = 0,
    maximum = 0;
  const pending = loadCertificationPortfolio(async n => {
    if (n > 1) {
      active++;
      maximum = Math.max(active, maximum);
      await new Promise<void>(resolve => waiting.set(n, resolve));
      active--;
    }
    return page(records.slice((n - 1) * 25, n * 25), 101);
  }, new AbortController().signal);
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));
  await tick();
  assert.deepEqual([...waiting.keys()], [2, 3]);
  waiting.get(3)!();
  await tick();
  assert.deepEqual([...waiting.keys()], [2, 3]);
  waiting.get(2)!();
  await tick();
  assert.deepEqual([...waiting.keys()], [2, 3, 4, 5]);
  waiting.get(5)!();
  waiting.get(4)!();
  assert.deepEqual(
    (await pending).records.map(row => row.id),
    records.map(row => row.id),
  );
  assert.equal(maximum, 2);
});
