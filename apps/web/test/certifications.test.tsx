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
  assert.equal(notificationDestination('/certifications?tab=queue')?.kind, 'Skills & reviews');
  assert.equal(
    notificationDestination('/certifications?renew=credential-id')?.label,
    'Update renewed certificate',
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

test('certificate image MIME fallback reaches decoding when the browser omits its type', async () => {
  const original = globalThis.createImageBitmap;
  const decoded: string[] = [];
  globalThis.createImageBitmap = async (source: ImageBitmapSource) => {
    decoded.push((source as Blob).type);
    throw Error('Stop at decoder');
  };
  try {
    for (const [extension, type] of [
      ['jpg', 'image/jpeg'],
      ['png', 'image/png'],
      ['webp', 'image/webp'],
    ]) {
      await assert.rejects(
        prepareCertificateFile(new File(['image bytes'], `certificate.${extension}`)),
        /This image could not be opened/,
      );
      assert.equal(decoded.at(-1), type);
    }
    assert.equal(decoded.length, 3);
  } finally {
    globalThis.createImageBitmap = original;
  }
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
  snapshotRevision: 1,
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
    return { ...page(records.slice((n - 1) * 25, n * 25), 26), page: n };
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
    return { ...page(records.slice((n - 1) * 25, n * 25), 101), page: n };
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

test('portfolio retries from page one after same-count concurrent decisions without mixing revisions', async () => {
  const old = Array.from({ length: 26 }, (_, i) => record(String(i)));
  const updated = old.map(r => ({ ...r, status: 'REJECTED' as const }));
  const calls: number[] = [];
  let attempt = 0;
  const result = await loadCertificationPortfolio(async n => {
    calls.push(n);
    if (n === 1) attempt++;
    const revision = attempt === 1 && n === 1 ? 1 : 2;
    const records = revision === 1 ? old : updated;
    return {
      ...page(records.slice((n - 1) * 25, n * 25), 26),
      page: n,
      snapshotRevision: revision,
    };
  }, new AbortController().signal);
  assert.deepEqual(calls, [1, 2, 1, 2]);
  assert.equal(result.snapshotRevision, 2);
  assert.ok(result.records.every(r => r.status === 'REJECTED'));
});

test('portfolio retries are bounded and never retry denied reads', async () => {
  for (const status of [401, 403, 409, 503]) {
    let calls = 0;
    await assert.rejects(
      loadCertificationPortfolio(async () => {
        calls++;
        throw Object.assign(Error('Unavailable'), { status });
      }, new AbortController().signal),
    );
    assert.equal(calls, status === 409 ? 3 : 1);
  }
  let attempts = 0;
  const records = Array.from({ length: 26 }, (_, i) => record(String(i)));
  await assert.rejects(
    loadCertificationPortfolio(async n => {
      if (n === 1) attempts++;
      return {
        ...page(records.slice((n - 1) * 25, n * 25), 26),
        page: n,
        snapshotRevision: attempts * 2 + n,
      };
    }, new AbortController().signal),
    /changed while loading/,
  );
  assert.equal(attempts, 3);
});

test('portfolio drains an in-flight batch and gives denial precedence over a conflict', async () => {
  let finish!: () => void;
  let firstPages = 0;
  const records = Array.from({ length: 51 }, (_, i) => record(String(i)));
  const pending = loadCertificationPortfolio(async n => {
    if (n === 1) {
      firstPages++;
      return page(records.slice(0, 25), 51);
    }
    if (n === 2) throw Object.assign(Error('Changed'), { status: 409 });
    await new Promise<void>(resolve => {
      finish = resolve;
    });
    throw Object.assign(Error('Denied'), { status: 403 });
  }, new AbortController().signal);
  const rejected = assert.rejects(pending, { status: 403 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(firstPages, 1, 'No restart while a prior batch is still running');
  finish();
  await rejected;
  assert.equal(firstPages, 1);
});

test('portfolio rejects missing revision and stops retries on cancellation', async () => {
  await assert.rejects(
    loadCertificationPortfolio(
      async () => ({ ...page([]), snapshotRevision: undefined }),
      new AbortController().signal,
    ),
    /unavailable/,
  );
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    loadCertificationPortfolio(async () => {
      calls++;
      controller.abort();
      throw Object.assign(Error('Conflict'), { status: 409 });
    }, controller.signal),
    { name: 'AbortError' },
  );
  assert.equal(calls, 1);
});

test('portfolio loading rejects inconsistent page identity, capabilities and page lengths', async () => {
  const records = Array.from({ length: 26 }, (_, i) => record(String(i)));
  for (const override of [
    { page: 1 },
    { canManage: false },
    { canSubmitNew: false },
    { canReview: true },
    { canUploadImage: true },
    { canRecommend: true },
    { canViewRecommendations: true },
  ]) {
    await assert.rejects(
      loadCertificationPortfolio(
        async n => ({
          ...page(records.slice((n - 1) * 25, n * 25), 26),
          page: n,
          ...(n === 2 ? override : {}),
        }),
        new AbortController().signal,
      ),
      /changed while loading/,
    );
  }
  await assert.rejects(
    loadCertificationPortfolio(
      async n => ({
        ...page(n === 1 ? records.slice(0, 24) : records.slice(24), 26),
        page: n,
      }),
      new AbortController().signal,
    ),
    /changed while loading/,
  );
});

test('renewal deep links normalize SQL UUID casing and reject invalid identifiers', async () => {
  const { certificationRenewalId } = await import('../src/certifications/certification-model');
  const id = 'abcdefab-1234-4234-8234-abcdefabcdef';
  assert.equal(certificationRenewalId(id.toUpperCase()), id);
  assert.equal(certificationRenewalId('not-a-credential'), undefined);
  assert.equal(certificationRenewalId(null), undefined);
});
