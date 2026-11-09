import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import type { CertificationRecord } from '../src/certifications/types';
import { change as changeField } from './support/interactions';
Object.assign(globalThis, {
  Node: window.Node,
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
});
const require = createRequire(import.meta.url),
  { refreshDevelopmentLogin } = require('../src/auth.ts') as typeof import('../src/auth');
const { CertificationDialog } = (() => {
  const css = require.extensions['.css'];
  require.extensions['.css'] = () => {};
  try {
    return require('../src/certifications/CertificationDialog.tsx') as typeof import('../src/certifications/CertificationDialog');
  } finally {
    if (css) require.extensions['.css'] = css;
    else delete require.extensions['.css'];
  }
})();
const record: CertificationRecord = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  revision: 2,
  personId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Aditi Menon',
  employeeCode: 'EMP-1042',
  certificationName: 'Oracle Database SQL',
  provider: 'Oracle',
  category: 'Database & Data',
  certificationDate: '2026-01-31',
  expiryDate: '2027-01-31',
  credentialId: 'SQL-DELIVERY-2026',
  credentialUrl: 'https://education.oracle.com/',
  notes: 'Supports Northstar Bank reporting delivery',
  status: 'DRAFT',
  feedback: '',
  canEdit: true,
  canSubmit: true,
  canReview: false,
};
let mounted: Awaited<ReturnType<typeof render>> | undefined,
  closed = 0,
  failFile = false,
  saveError: Error | undefined,
  saved: unknown[][] = [],
  recovered = structuredClone(record);
beforeEach(async () => {
  closed = 0;
  failFile = false;
  saveError = undefined;
  saved = [];
  recovered = structuredClone(record);
  mock.method(URL, 'createObjectURL', () => 'blob:delivery-proof');
  mock.method(URL, 'revokeObjectURL', () => {});
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const path = String(input);
    if (path === '/api/dev-login') return demoResponse();
    if (path.endsWith('/image'))
      return failFile
        ? Response.json({ error: { message: 'Certificate access changed' } }, { status: 403 })
        : Response.json({
            items: [
              {
                id: 'proof',
                fileName: 'Oracle SQL certificate.webp',
                mimeType: 'image/webp',
                bytes: 5,
              },
            ],
          });
    if (path.endsWith('/image/proof'))
      return new Response('proof', { headers: { 'Content-Type': 'image/webp' } });
    if (path === '/api/certifications/' + record.id) return Response.json({ record: recovered });
    throw Error('Unexpected request ' + path);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount(options: Partial<Parameters<typeof CertificationDialog>[0]> = {}) {
  mounted = await render(
    <CertificationDialog
      initial={record}
      imageAvailable
      canSubmit
      onClose={() => closed++}
      onSave={async (...args) => {
        saved.push(args);
        if (saveError) throw saveError;
        return 3;
      }}
      {...options}
    />,
  );
  await settle();
  await settle();
}
async function click(name: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    b => b.textContent?.trim() === name,
  );
  assert.ok(button, 'Missing button ' + name);
  await act(async () => button.click());
  await settle();
}
async function input(label: string, value: string) {
  const field = Array.from(document.querySelectorAll('label'))
    .find(l => l.textContent?.trim().startsWith(label))
    ?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea');
  assert.ok(field, 'Missing field ' + label);
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      field.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype,
      'value',
    )!;
    descriptor.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('credential editor validates identity before review; cancelling edited fields needs explicit discard', async () => {
  await mount({ initial: null, imageAvailable: false });
  await click('Next');
  assert.match(document.body.textContent!, /Enter a certification name/);
  await input('Certification name', 'Oracle SQL Practitioner');
  await click('Next');
  assert.match(document.body.textContent!, /Enter an issuer/);
  await click('Cancel');
  assert.match(document.body.textContent!, /Discard unsaved certification changes/);
  await click('Keep editing');
  assert.equal(closed, 0);
  await click('Cancel');
  await click('Discard changes');
  assert.equal(closed, 1);
  assert.equal(saved.length, 0);
});
test('valid credential details still cannot be saved while certificate storage is unavailable', async () => {
  await mount({ imageAvailable: false });
  await click('Next');
  assert.match(document.body.textContent!, /Certificate file storage is unavailable/);
  assert.equal(saved.length, 0);
  assert.equal(closed, 0);
});
test('existing private certificate supports reviewed draft/save with exact stable identity and version', async () => {
  await mount();
  await click('Next');
  assert.match(document.body.textContent!, /Oracle Database SQL/);
  await click('Save draft');
  assert.equal(closed, 1);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], [
    record.id,
    2,
    (({
      id,
      revision,
      personId,
      name,
      employeeCode,
      status,
      feedback,
      canEdit,
      canSubmit,
      canReview,
      ...fields
    }) => fields)(record),
    false,
  ]);
});
test('submission is disabled without current review routing; saved fields remain available to edit', async () => {
  await mount({ canSubmit: false });
  await click('Next');
  const submit = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b =>
    b.textContent?.includes('Submit for review'),
  );
  assert.ok(submit?.disabled);
  await click('Back');
  await input('Supporting notes', 'Updated SQL delivery examples');
  assert.equal(saved.length, 0);
  assert.match(document.body.textContent!, /Submission needs an active current manager/);
});
test('uncertain credential submission blocks duplicate writes until exact committed record is reconciled', async () => {
  await mount();
  saveError = Object.assign(Error('Response lost after submission'), { status: 503 });
  await click('Next');
  await click('Submit for review');
  assert.equal(saved.length, 1);
  assert.match(document.body.textContent!, /Check the saved draft before retrying/);
  assert.ok(
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b =>
      b.textContent?.includes('Submit for review'),
    )?.disabled,
  );
  recovered = { ...record, revision: 3, status: 'SUBMITTED', canEdit: false };
  await click('Check saved draft');
  assert.equal(saved.length, 1);
  assert.equal(closed, 1);
});
test('revoked certificate retrieval never permits review or saving and a retry can recover current file access', async () => {
  failFile = true;
  await mount();
  await click('Next');
  assert.match(document.body.textContent!, /Certificate access changed/);
  assert.equal(saved.length, 0);
  failFile = false;
  await click('Retry loading saved file');
  await settle();
  await click('Next');
  await click('Submit for review');
  assert.equal(saved.length, 1);
  assert.equal(saved[0][3], true);
  assert.equal(closed, 1);
});

test('issuer keyboard selection cycles available options and Escape closes only the options', async () => {
  await mount();
  const issuer = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => issuer.focus());
  await input('Issuer', '');
  const key = async (value: string) => {
    await act(async () =>
      issuer.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
      ),
    );
    await settle();
  };
  await key('ArrowDown');
  await key('ArrowDown');
  await key('Enter');
  assert.equal(issuer.value, 'Microsoft');
  assert.equal(issuer.getAttribute('aria-expanded'), 'false');
  assert.equal(saved.length, 0);
  await key('ArrowDown');
  await key('ArrowUp');
  assert.ok(issuer.getAttribute('aria-activedescendant'));
  await key('Escape');
  assert.equal(issuer.getAttribute('aria-expanded'), 'false');
  assert.equal(closed, 0);
  await click('Next');
  await click('Save draft');
  assert.equal((saved[0][2] as any).provider, 'Microsoft');
});

test('custom category, clear selection and pointer selection preserve the chosen issuer', async () => {
  await mount();
  const boxes = document.querySelectorAll<HTMLInputElement>('[role="combobox"]'),
    issuer = boxes[0],
    category = boxes[1];
  const issuerBox = issuer.closest('.cert-combobox')!;
  const clear = issuerBox.querySelector<HTMLButtonElement>('[aria-label="Clear selection"]')!;
  await act(async () => clear.click());
  await settle();
  assert.equal(issuer.value, '');
  await input('Issuer', 'Cloud Skills Institute');
  assert.equal(issuer.value, 'Cloud Skills Institute');
  await act(async () => category.focus());
  const other = [...category.closest('.cert-combobox')!.querySelectorAll('[role="option"]')].find(
    o => o.textContent?.includes('Other'),
  )!;
  await act(async () =>
    other.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })),
  );
  assert.equal(category.placeholder, 'Type custom name...');
  await input('Category', 'Delivery enablement');
  await act(async () =>
    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })),
  );
  assert.equal(category.getAttribute('aria-expanded'), 'false');
  await click('Next');
  await click('Save draft');
  assert.equal((saved[0][2] as any).provider, 'Cloud Skills Institute');
  assert.equal((saved[0][2] as any).category, 'Delivery enablement');
});

test('expiry presets, lifetime choice and edited credential details persist only on explicit save', async () => {
  await mount();
  await changeField(
    document.querySelector<HTMLSelectElement>('[aria-label="Quick-fill expiry date"]')!,
    '6',
  );
  assert.equal(document.querySelector<HTMLInputElement>('#cert-expiry-date')!.value, '2026-07-31');
  const lifetime = [...document.querySelectorAll('label')]
    .find(l => l.textContent?.includes('Does not expire'))!
    .querySelector<HTMLInputElement>('input')!;
  await act(async () => lifetime.click());
  assert.match(document.body.textContent!, /Lifetime credential/);
  await input('Issue date', '2026-02-01');
  await input('Credential ID', 'SQL-DELIVERY-2026-UPDATED');
  await input('Issuer / badge link', 'https://education.oracle.com/credential');
  await input('Supporting notes', 'Updated issuer record reviewed.');
  assert.equal(saved.length, 0);
  await click('Next');
  await click('Save draft');
  const fields = saved[0][2] as any;
  assert.equal(fields.expiryDate, null);
  assert.equal(fields.certificationDate, '2026-02-01');
  assert.equal(fields.credentialId, 'SQL-DELIVERY-2026-UPDATED');
  assert.equal(fields.notes, 'Updated issuer record reviewed.');
});
