import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, demoResponse, render, settle } from './support/browser';
import {
  click,
  component,
  fill,
  MemoryRouter,
  refreshDevelopmentLogin,
} from './support/interactions';
import { commonLevels } from '../src/proficiency';

const { CapabilityComposer } = component<typeof import('../src/capabilities/CapabilityComposer')>(
  'capabilities/CapabilityComposer.tsx',
);
const root = '/api/capability-submissions';
const choice = {
  id: '88888888-8888-4888-8888-000000000001',
  name: 'SQL',
  category: 'Databases',
  definitionRevision: 3,
  levels: commonLevels(),
};
const initialSkillDraft = {
  id: '88888888-8888-4888-8888-000000000002',
  choice,
  reuse: false,
  revision: 0,
  rank: 3,
  experienceMonths: 18,
  description: 'Improved customer reporting queries using execution plans.',
  projects: 'Customer Insights Modernisation',
  evidence: '',
  lastUsedOn: '2025-11-01',
};
after(closeBrowser);

for (const recovery of ['not saved', 'draft saved', 'already submitted'] as const) {
  test(`uncertain intake save checks the exact draft before writing again when ${recovery}`, async t => {
    const saves: {
      id: string;
      revision: number;
      skills: {
        id: string;
        revision: number;
        fields: { rank: number; experienceMonths: number };
      }[];
    }[] = [];
    let confirmed = 0;
    let checks = 0;
    t.mock.method(
      globalThis,
      'fetch',
      async (input: string | URL | Request, options?: RequestInit) => {
        const path = String(input);
        if (path === '/api/dev-login') return demoResponse();
        if (path === root + '/availability')
          return Response.json({ aiAvailable: false, fileAvailable: true });
        if (path === root + '/options')
          return Response.json({ claims: [], certifications: [], definitions: [] });
        if (path.startsWith('/api/my-skills/catalogue?'))
          return Response.json({ skills: [choice], total: 1 });
        if (path === root && options?.method === 'POST') {
          const body = JSON.parse(String(options.body));
          saves.push(body);
          if (saves.length === 1)
            return Response.json({ error: { message: 'Connection interrupted' } }, { status: 503 });
          return Response.json({
            id: body.id,
            revision: 1,
            status: 'DRAFT',
            skills: [],
            certifications: [],
          });
        }
        if (path === root + '/' + saves[0]?.id && options?.method !== 'POST') {
          checks++;
          if (checks === 1)
            return Response.json(
              { error: { message: 'Service temporarily unavailable' } },
              { status: 503 },
            );
          if (recovery === 'not saved')
            return Response.json({ error: { message: 'Draft not found' } }, { status: 404 });
          if (recovery === 'draft saved')
            return Response.json({
              id: saves[0].id,
              revision: 5,
              status: 'DRAFT',
              skills: [
                {
                  ...initialSkillDraft,
                  ...choice,
                  id: initialSkillDraft.id,
                  skillId: choice.id,
                  revision: 7,
                  needsReview: true,
                  experienceMonths: 26,
                },
              ],
              certifications: [],
            });
          return Response.json({ id: saves[0].id, revision: 2, status: 'SUBMITTED' });
        }
        throw Error('Unexpected intake request ' + path);
      },
    );
    await refreshDevelopmentLogin();
    const form = await render(
      <MemoryRouter>
        <CapabilityComposer
          initialSkill={choice}
          initialSkillDraft={initialSkillDraft}
          onClose={() => assert.fail('Unexpected close')}
          onSaved={() => confirmed++}
        />
      </MemoryRouter>,
    );
    try {
      await settle();
      await click('Save draft');
      assert.equal(saves.length, 1);
      assert.equal(confirmed, 0);
      assert.match(document.body.textContent ?? '', /Your entries remain here/);
      await click('Check saved submission');
      assert.match(document.body.textContent ?? '', /Your save is still unconfirmed/);
      assert.equal(saves.length, 1);
      await click('Check saved submission');
      if (recovery === 'not saved') {
        assert.match(document.body.textContent ?? '', /No submission was saved/);
        await click('Save draft');
        assert.equal(saves.length, 2);
        assert.deepEqual(saves[1], saves[0]);
        assert.equal(saves[1].skills[0].fields.rank, 3);
      } else if (recovery === 'draft saved') {
        assert.match(document.body.textContent ?? '', /Saved draft loaded/);
        assert.equal(confirmed, 0);
        await click('Save draft');
        assert.equal(saves.length, 2);
        assert.equal(saves[1].id, saves[0].id);
        assert.equal(saves[1].revision, 5);
        assert.equal(saves[1].skills[0].revision, 7);
        assert.equal(saves[1].skills[0].fields.experienceMonths, 26);
      } else {
        assert.equal(saves.length, 1, 'a committed submission must never be repeated');
      }
      assert.equal(checks, 2);
      assert.equal(confirmed, 1);
    } finally {
      await form.unmount();
    }
  });
}

test('an incomplete intake stages its private certificate using the saved draft revision', async t => {
  const file = new File(['%PDF-1.4\n'], 'Cloud Fundamentals.pdf', { type: 'application/pdf' });
  const paths: string[] = [];
  let draftId = '';
  let certificateId = '';
  let confirmed = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request, options?: RequestInit) => {
      const path = String(input);
      if (path === '/api/dev-login') return demoResponse();
      if (path === root + '/availability')
        return Response.json({ aiAvailable: false, fileAvailable: true });
      if (path === root + '/options')
        return Response.json({ claims: [], certifications: [], definitions: [] });
      if (path.startsWith('/api/my-skills/catalogue?'))
        return Response.json({ skills: [], total: 0 });
      if (path === root + '/intake') {
        paths.push('draft');
        assert.equal(options?.method, 'POST');
        const body = JSON.parse(String(options?.body));
        assert.equal(body.revision, 0);
        assert.deepEqual(body.skills, []);
        assert.equal(body.certifications.length, 1);
        assert.equal('file' in body.certifications[0], false);
        draftId = body.id;
        certificateId = body.certifications[0].id;
        return Response.json({ id: draftId, revision: 4, status: 'DRAFT' });
      }
      if (path === `${root}/${draftId}/staged/${certificateId}` && options?.method === 'POST') {
        paths.push('file');
        assert.equal(new Headers(options?.headers).get('X-Submission-Revision'), '4');
        assert.equal(
          new Headers(options?.headers).get('X-Certificate-File-Name'),
          'Cloud%20Fundamentals.pdf',
        );
        assert.equal(options?.body, file);
        return Response.json({ revision: 5 });
      }
      throw Error('Unexpected intake request ' + path);
    },
  );
  await refreshDevelopmentLogin();
  const form = await render(
    <MemoryRouter>
      <CapabilityComposer
        initialEvidenceFile={file}
        onClose={() => assert.fail('Unexpected close')}
        onSaved={() => confirmed++}
      />
    </MemoryRouter>,
  );
  try {
    await settle();
    await click('Save draft');
    assert.deepEqual(paths, ['draft', 'file']);
    assert.equal(confirmed, 1);
  } finally {
    await form.unmount();
  }
});

test('linked submission waits for certificate upload and submits the new file revision', async t => {
  const file = new File(['%PDF-1.4\n'], 'SQL Foundations.pdf', { type: 'application/pdf' });
  const steps: string[] = [];
  let draftId = '';
  let credentialId = '';
  let confirmed = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request, options?: RequestInit) => {
      const path = String(input);
      if (path === '/api/dev-login') return demoResponse();
      if (path === root + '/availability')
        return Response.json({ aiAvailable: false, fileAvailable: true });
      if (path === root + '/options')
        return Response.json({ claims: [], certifications: [], definitions: [] });
      if (path.startsWith('/api/my-skills/catalogue?'))
        return Response.json({ skills: [choice], total: 1 });
      if (path === root && options?.method === 'POST') {
        steps.push('draft');
        const body = JSON.parse(String(options.body));
        assert.equal(body.revision, 0);
        draftId = body.id;
        credentialId = body.certifications[0].id;
        assert.deepEqual(body.certifications[0].skillIds, [choice.id]);
        assert.equal(body.certifications[0].fields.expiryDate, '2026-01-31');
        return Response.json({
          id: draftId,
          revision: 4,
          status: 'DRAFT',
          skills: [{ id: initialSkillDraft.id, revision: 5 }],
          certifications: [{ id: credentialId, revision: 6 }],
        });
      }
      if (path === `/api/certifications/${credentialId}/image`) {
        if (options?.method !== 'POST')
          return Response.json({ error: { message: 'No file yet' } }, { status: 404 });
        steps.push('upload');
        assert.equal(options.body, file);
        assert.equal(new Headers(options.headers).get('X-Certification-Revision'), '6');
        return Response.json({ revision: 7 });
      }
      if (path === root + '/submit') {
        steps.push('submit');
        assert.deepEqual(JSON.parse(String(options?.body)), {
          id: draftId,
          revision: 4,
          skills: [{ id: initialSkillDraft.id, revision: 5 }],
          certifications: [{ id: credentialId, revision: 7 }],
        });
        return Response.json({ id: draftId, revision: 5, status: 'SUBMITTED' });
      }
      throw Error('Unexpected intake request ' + path);
    },
  );
  await refreshDevelopmentLogin();
  const form = await render(
    <MemoryRouter>
      <CapabilityComposer
        initialSkillDraft={initialSkillDraft}
        initialEvidenceFile={file}
        onClose={() => assert.fail('Unexpected close')}
        onSaved={() => confirmed++}
      />
    </MemoryRouter>,
  );
  try {
    await settle();
    await fill('Certification name', 'SQL Foundations');
    await fill('Issuer', 'Data Skills Institute');
    await fill('Category', 'Databases');
    await fill('Issue date', '2025-01-31');
    await click('1 year');
    await click('Continue');
    await click('Review', document.querySelector('.form-dialog-footer')!);
    assert.deepEqual(steps, []);
    await click('Submit for review');
    assert.deepEqual(steps, ['draft', 'upload', 'submit']);
    assert.equal(confirmed, 1);
  } finally {
    await form.unmount();
  }
});
