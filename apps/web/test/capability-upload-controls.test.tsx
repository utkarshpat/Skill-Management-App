import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  fill,
  change,
  debounce,
} from './support/interactions';
import { commonLevels } from '../src/proficiency';
const { CapabilityComposer } = component<typeof import('../src/capabilities/CapabilityComposer')>(
  'capabilities/CapabilityComposer.tsx',
);
const root = '/api/capability-submissions';
const choice = {
  id: '88888888-8888-4888-8888-000000000001',
  name: 'SQL reporting',
  category: 'Data',
  definitionRevision: 3,
  levels: commonLevels(),
};
const draft = {
  id: '88888888-8888-4888-8888-000000000002',
  choice,
  reuse: false,
  revision: 0,
  rank: 3,
  experienceMonths: 18,
  description: 'Delivered grouped customer reports.',
  projects: 'Customer reporting',
  evidence: 'Delivery notes',
  lastUsedOn: '2026-10-01',
};
const fields = {
  certificationName: 'Azure Fundamentals',
  provider: 'Microsoft',
  category: 'Cloud',
  certificationDate: '2026-01-12',
  expiryDate: null,
  credentialId: 'AZ-1042',
  credentialUrl: 'https://learn.microsoft.com/',
  notes: 'Cloud onboarding',
};
let view: Awaited<ReturnType<typeof render>> | undefined;
let personal: any,
  aiAvailable = true,
  uploadFailure = 0,
  saved = 0,
  closed = 0;
let calls: { url: string; method: string; body: any; headers: Headers }[] = [];
beforeEach(async () => {
  personal = {
    claims: [],
    certifications: [],
    definitions: [
      {
        id: 'azure-definition',
        name: fields.certificationName,
        provider: 'Microsoft',
        category: 'Cloud',
        relatedSkills: [choice],
      },
    ],
  };
  aiAvailable = true;
  uploadFailure = 0;
  saved = 0;
  closed = 0;
  calls = [];
  mock.method(URL, 'createObjectURL', () => 'blob:local-certificate');
  mock.method(URL, 'revokeObjectURL', () => {});
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input),
      method = init?.method ?? 'GET';
    if (url === '/api/dev-login') return demoResponse();
    if (url === root + '/availability') return Response.json({ aiAvailable, fileAvailable: true });
    if (url === root + '/options') return Response.json(personal);
    if (url.startsWith('/api/my-skills/catalogue?'))
      return Response.json({ skills: [choice], total: 1 });
    if (method === 'POST') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      calls.push({ url, method, body, headers: new Headers(init?.headers) });
      if (url === root + '/autofill')
        return Response.json({
          fields: { ...fields, notes: 'AI extracted certificate facts' },
          suggestions: [{ skill: choice, reason: 'Related to the supplied certificate' }],
          catalogueSuggestion: {
            name: 'Azure Fundamentals',
            provider: 'Microsoft',
            category: 'Cloud',
          },
          warning: 'Review extracted facts before saving.',
        });
      if (url.endsWith('/evidence') || url.endsWith('/image'))
        return uploadFailure
          ? Response.json(
              { error: { message: 'File upload interrupted' } },
              { status: uploadFailure },
            )
          : Response.json({ revision: url.endsWith('/image') ? 10 : 9 });
      if (url === root)
        return Response.json({
          id: body.id,
          revision: 2,
          status: 'DRAFT',
          skills: body.skills.map((s: any) => ({ id: s.id, revision: 8 })),
          certifications: body.certifications.map((c: any) => ({ id: c.id, revision: 9 })),
        });
      if (url.endsWith('/submit') || url.endsWith('/publish-links'))
        return Response.json({ ok: true });
    }
    if (url.endsWith('/image')) return Response.json({ items: [] });
    if (url.includes('/evidence'))
      return Response.json({ items: [], revision: 8, canUpload: true });
    throw Error('Unexpected intake request ' + url);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount(extra: Partial<React.ComponentProps<typeof CapabilityComposer>> = {}) {
  view = await render(
    <MemoryRouter>
      <CapabilityComposer
        initialSkill={choice}
        initialSkillDraft={{ ...draft }}
        onClose={() => closed++}
        onSaved={() => saved++}
        {...extra}
      />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}
const base = () => document.querySelector('.capability-composer')!;
const skill = () => document.querySelector('.cap-skill-dialog')!;
async function file(input: HTMLInputElement, value: File) {
  Object.defineProperty(input, 'files', { configurable: true, value: [value] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await settle();
  await settle();
}

test('skill evidence validation, removal and upload use the saved revision before submitting', async () => {
  await mount();
  await click(choice.name, base());
  await fill('Experience in months', '24', skill());
  await fill('Last used', '2026-10-15', skill());
  await fill(
    'Describe your experience',
    'Implemented grouped customer reporting with verified totals.',
    skill(),
  );
  await fill('Projects', 'Customer reporting release', skill());
  await fill('Evidence references', 'Reviewed delivery notes and report tests', skill());
  const upload = skill().querySelector<HTMLInputElement>('input[type="file"]')!;
  await file(upload, new File(['bad'], 'script.exe', { type: 'application/octet-stream' }));
  assert.match(skill().textContent!, /Choose PDF, JPEG, PNG or WebP/);
  await file(
    upload,
    new File(['%PDF-evidence'], 'delivery-notes.pdf', { type: 'application/pdf' }),
  );
  assert.match(skill().textContent!, /delivery-notes.pdf/);
  await click('Remove delivery-notes.pdf', skill());
  assert.equal(skill().querySelector('.cap-pending-evidence'), null);
  await file(upload, new File(['%PDF-evidence'], 'report-tests.pdf', { type: 'application/pdf' }));
  await click('Done', skill());
  await click('Review', base());
  await click('Submit for review', base());
  assert.equal(saved, 1);
  assert.deepEqual(
    calls.map(c => c.url),
    [root, `/api/my-skills/${draft.id}/evidence`, root + '/submit'],
  );
  assert.equal(calls[0].body.skills[0].fields.experienceMonths, 24);
  assert.equal(calls[1].headers.get('X-Claim-Revision'), '8');
  assert.equal(calls[1].headers.get('X-Evidence-File-Name'), 'report-tests.pdf');
  assert.deepEqual(calls[2].body.skills, [{ id: draft.id, revision: 9 }]);
  assert.equal(calls[2].body.revision, 2);
});

test('evidence promotion enforces the certificate limit and retains the supporting skill', async () => {
  await mount();
  await click(choice.name, base());
  const upload = skill().querySelector<HTMLInputElement>('input[type="file"]')!;
  await file(
    upload,
    new File([new Uint8Array(6 * 1024 * 1024)], 'large-evidence.pdf', { type: 'application/pdf' }),
  );
  await click('Use as certificate', skill());
  assert.match(skill().textContent!, /Certificates have a 5 MB limit/);
  await click('Remove large-evidence.pdf', skill());
  await file(upload, new File(['image'], 'cloud-certificate.png', { type: 'image/png' }));
  await click('Use as certificate', skill());
  assert.equal(document.querySelector('.cap-skill-dialog'), null);
  assert.match(base().textContent!, /cloud-certificate.png/);
  assert.match(base().textContent!, /supporting skill is already linked|Certificate details/);
  assert.equal(calls.length, 0);
  await click('Remove certificate from this draft', base());
  await click('Continue without certificate', base());
  assert.match(
    base().querySelector('[aria-label="Selected related skills"]')!.textContent!,
    /SQL reporting/,
  );
});

test('AI certificate autofill is advisory and certificate upload precedes exact-revision submit', async () => {
  await mount({
    initialCertificate: true,
    initialEvidenceFile: new File(['Certificate details'], 'azure-certificate.txt', {
      type: 'text/plain',
    }),
  });
  await fill('Choose an approved credential definition', 'azure-definition', base());
  await fill('Issue date', '2026-01-12', base());
  await click('1 year', base());
  await fill('Credential ID', 'AZ-2042', base());
  await fill('Verification URL', 'https://learn.microsoft.com/', base());
  await fill('Notes', 'Reviewed course completion', base());
  await click('Autofill with AI', base());
  assert.equal(calls[0].url, root + '/autofill');
  assert.equal(calls[0].headers.get('X-File-Name'), 'azure-certificate.txt');
  assert.equal(saved, 0);
  await click('Continue', base());
  await click('Use these catalogue details', base());
  await click('Review', base());
  await click('Submit for review', base());
  const posts = calls.filter(c => c.url !== root + '/autofill');
  assert.equal(posts[0].url, root);
  assert.equal(posts[1].headers.get('X-Certification-Revision'), '9');
  assert.equal(posts[2].url, root + '/submit');
  assert.equal(posts[2].body.certifications[0].revision, 10);
  assert.equal(saved, 1);
});

test('adding an already-submitted skill is blocked without saving another review', async () => {
  personal.claims = [{ skillId: choice.id, status: 'SUBMITTED' }];
  await mount({ initialSkillDraft: undefined });
  await settle();
  assert.match(base().textContent!, /already awaiting review/);
  assert.equal(calls.length, 0);
});

test('reviewed skills and credentials can be linked without new proficiency or review writes', async () => {
  personal.claims = [
    {
      ...draft,
      ...choice,
      id: draft.id,
      skillId: choice.id,
      revision: 7,
      status: 'APPROVED',
      name: choice.name,
    },
  ];
  personal.certifications = [
    { ...fields, id: 'reviewed-certificate', revision: 4, status: 'APPROVED', hasImage: true },
  ];
  await mount({ initialCertificate: true });
  await click('Remove certificate from this draft', base());
  await fill('Link an existing certification', 'reviewed-certificate', base());
  await click('Continue', base());
  await click('Remove SQL reporting', base());
  await settle();
  await debounce();
  const result = base().querySelector('.cap-skill-results')!;
  await click('SQL reporting', result);
  assert.match(skill().textContent!, /linked without changing its proficiency/);
  const supporting = skill().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  if (supporting.checked) await act(async () => supporting.click());
  await act(async () => supporting.click());
  await click('Done', skill());
  await click('Review', base());
  assert.match(base().querySelector('footer')!.textContent!, /Save links/, base().textContent!);
  await click('Save links', base());
  assert.equal(saved, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, root + '/publish-links');
  assert.equal(calls[0].body.skills[0].fields, undefined);
  assert.equal(calls[0].body.certifications[0].fields, undefined);
  assert.deepEqual(calls[0].body.certifications[0].skillIds, [choice.id]);
});

test('failed evidence upload never advances to submission or reports a successful save', async () => {
  await mount();
  await click(choice.name, base());
  await file(
    skill().querySelector('input[type="file"]')!,
    new File(['%PDF-evidence'], 'client-delivery.pdf', { type: 'application/pdf' }),
  );
  await click('Done', skill());
  await click('Review', base());
  uploadFailure = 503;
  await click('Submit for review', base());
  assert.equal(saved, 0);
  assert.deepEqual(
    calls.map(c => c.url),
    [root, `/api/my-skills/${draft.id}/evidence`],
  );
  assert.match(base().textContent!, /File upload interrupted/);
  assert.match(base().textContent!, /Check saved submission/);
});

test('renewal requires a new file and AI extraction preserves the original credential identity', async () => {
  await mount({
    initialSkill: undefined,
    initialSkillDraft: undefined,
    initialCertificate: true,
    renewal: {
      id: 'original-oracle-certificate',
      fields: { ...fields, certificationName: 'Oracle Database SQL', provider: 'Oracle' },
    },
  });
  const advance = [...base().querySelectorAll<HTMLButtonElement>('button')].find(b =>
    b.textContent?.trim().startsWith('Continue'),
  )!;
  assert.equal(advance.disabled, true);
  await file(
    base().querySelector('[aria-label="Choose certificate file"]')!,
    new File(['Renewed credential'], 'renewal.txt', { type: 'text/plain' }),
  );
  await click('Autofill with AI', base());
  const named = (label: string) =>
    [...base().querySelectorAll('label')]
      .find(l => l.textContent?.trim().startsWith(label))!
      .querySelector('input')!;
  assert.equal(named('Certification name').value, 'Oracle Database SQL');
  assert.equal(named('Issuer').value, 'Oracle');
  assert.equal(named('Issuer').disabled, true);
  assert.equal(calls.length, 1);
  assert.equal(saved, 0);
});
