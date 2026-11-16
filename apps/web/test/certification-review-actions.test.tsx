import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { render, settle, closeBrowser, demoResponse, deferred } from './support/browser';
import { component, refreshDevelopmentLogin, click, fill } from './support/interactions';
const { CertificationReviewDialog } = component<
  typeof import('../src/certifications/CertificationReviewDialog')
>('certifications/CertificationReviewDialog.tsx');
const record: import('../src/certifications/types').CertificationRecord = {
  id: 'f2718656-e761-401a-8a78-f16a00000001',
  revision: 3,
  personId: 'aditi',
  name: 'Aditi Menon',
  employeeCode: '710902',
  certificationName: 'Azure Fundamentals',
  provider: 'Microsoft',
  category: 'Cloud',
  certificationDate: '2026-01-12',
  expiryDate: null,
  credentialId: 'AZ-1042',
  credentialUrl: 'https://learn.microsoft.com/',
  notes: 'Completed cloud onboarding',
  status: 'SUBMITTED',
  feedback: '',
  canReview: true,
  canEdit: false,
  canSubmit: false,
};
let view: Awaited<ReturnType<typeof render>> | undefined;
beforeEach(async () => {
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (String(input) === '/api/dev-login') return demoResponse();
    if (String(input).endsWith('/image')) return Response.json({ items: [] });
    throw Error('Unexpected request: ' + input);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);

for (const [label, action] of [
  ['Approve with note', 'APPROVE'],
  ['Request changes', 'REQUEST_CHANGES'],
  ['Do not approve', 'REJECT'],
] as const) {
  test(`certification ${action} requires a note and submits the reviewed revision once`, async () => {
    const pending = deferred<void>();
    const decisions: unknown[][] = [];
    let closed = 0;
    view = await render(
      <CertificationReviewDialog
        certification={record}
        onClose={() => closed++}
        onDecision={async (...args) => {
          decisions.push(args);
          await pending.promise;
        }}
      />,
    );
    await settle();
    await click(label);
    assert.match(document.body.textContent!, /Add a review note/);
    assert.equal(decisions.length, 0);
    await fill('Review note', '  Credential details checked with the issuer.  ');
    await click(label);
    assert.deepEqual(decisions, [[record, action, 'Credential details checked with the issuer.']]);
    assert.equal(closed, 0);
    assert.ok(
      [...document.querySelectorAll('.form-dialog button')].every(
        button => (button as HTMLButtonElement).disabled,
      ),
    );
    pending.resolve();
    await settle();
    assert.equal(closed, 1);
  });
}

test('failed certification decision preserves the note for retry and reports a revoked reviewer', async () => {
  let attempts = 0,
    closed = 0;
  view = await render(
    <CertificationReviewDialog
      certification={record}
      onClose={() => closed++}
      onDecision={async () => {
        if (++attempts === 1) throw Error('The current manager changed. Refresh this review.');
      }}
    />,
  );
  await fill('Review note', 'Issuer details match the supplied certificate.');
  await click('Approve with note');
  assert.match(document.body.textContent!, /current manager changed/);
  assert.equal(
    document.querySelector('textarea')!.value,
    'Issuer details match the supplied certificate.',
  );
  assert.equal(closed, 0);
  await click('Approve with note');
  assert.equal(attempts, 2);
  assert.equal(closed, 1);
  await view.update(
    <CertificationReviewDialog
      certification={{
        ...record,
        canReview: false,
        reviewAccess: { allowed: false, reasonCode: 'NOT_CURRENT_MANAGER' },
      }}
      onClose={() => closed++}
      onDecision={async () => {
        throw Error('must not save');
      }}
    />,
  );
  assert.match(document.body.textContent!, /NOT_CURRENT_MANAGER/);
  for (const label of ['Approve with note', 'Request changes', 'Do not approve']) {
    const button = [...document.querySelectorAll('button')].find(b =>
      b.textContent?.includes(label),
    );
    assert.equal(button?.disabled, true);
  }
  await click('Cancel');
  assert.equal(closed, 2);
});
