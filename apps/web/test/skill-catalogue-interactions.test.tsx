import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import {
  MemoryRouter,
  refreshDevelopmentLogin,
  component,
  click,
  fill,
  change,
  debounce,
} from './support/interactions';
Object.assign(globalThis, {
  Node: window.Node,
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
});
const { SkillCatalogue } = component<typeof import('../src/SkillCatalogue')>('SkillCatalogue.tsx');
const skill = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  businessCode: 'SK-012',
  definitionRevision: 3,
  name: 'SQL',
  category: 'Databases',
  description: 'Query and maintain customer reporting data',
  status: 'PUBLISHED',
  levels: ['Foundation', 'Autonomous', 'Experienced', 'Expert'].map((name, i) => ({
    rank: i + 1,
    name,
    description: 'Demonstrate ' + name + ' practice with delivery evidence',
  })),
  relatedCertifications: [],
};
let mounted: Awaited<ReturnType<typeof render>> | undefined,
  canManage = true,
  readFailure = 0,
  writeFailure = 0,
  refreshFailure = false,
  changed = 0,
  contextAllowed = true,
  writes: any[] = [],
  reads: string[] = [],
  skills: any[] = [];
beforeEach(async () => {
  canManage = true;
  readFailure = 0;
  writeFailure = 0;
  refreshFailure = false;
  changed = 0;
  contextAllowed = true;
  writes = [];
  reads = [];
  skills = [structuredClone(skill)];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    reads.push(path);
    if (path === '/api/dev-login') return demoResponse();
    if (path === '/api/business/context')
      return Response.json({
        revision: 7,
        canView: false,
        canManage: false,
        canAmend: contextAllowed,
        canApprove: contextAllowed,
        scopes: [],
      });
    if (path === '/api/skills' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      if (writeFailure)
        return Response.json(
          { error: { message: 'Catalogue changed. Review the current definition.' } },
          { status: writeFailure },
        );
      skills = [{ ...body, id: body.id ?? skill.id }];
      return Response.json({ saved: true });
    }
    if (path.startsWith('/api/skills?')) {
      if (readFailure || (refreshFailure && writes.length))
        return Response.json(
          { error: { message: 'Catalogue refresh unavailable' } },
          { status: readFailure || 503 },
        );
      const q = new URL(path, 'http://localhost').searchParams;
      const found = skills.filter(
        s =>
          (!q.get('search') || s.name.toLowerCase().includes(q.get('search')!.toLowerCase())) &&
          (!q.get('status') || s.status === q.get('status')),
      );
      return Response.json({
        revision: 7,
        canManage,
        total: found.length,
        page: Number(q.get('page')),
        pageSize: 25,
        skills: found,
      });
    }
    throw Error('Unexpected catalogue request ' + path);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount(amendmentsAllowed = false) {
  mounted = await render(
    <MemoryRouter>
      <SkillCatalogue
        actionsContainer={null}
        amendmentsAllowed={amendmentsAllowed}
        onChanged={() => changed++}
      />
    </MemoryRouter>,
  );
  await debounce();
}

test('published catalogue supports literal search and read-only level inspection without management actions', async () => {
  canManage = false;
  await mount();
  await change(
    document.querySelector<HTMLInputElement>('[aria-label="Search skills"]')!,
    'not-a-published-skill',
  );
  await debounce();
  assert.match(document.body.textContent!, /No matching skills/);
  await change(document.querySelector<HTMLInputElement>('[aria-label="Search skills"]')!, 'SQL');
  await debounce();
  await click('SQL');
  const dialog = document.querySelector('.form-dialog')!;
  assert.match(dialog.textContent!, /Query and maintain customer reporting data/);
  assert.match(dialog.textContent!, /Autonomous/);
  assert.doesNotMatch(dialog.textContent!, /Save draft|Publish skill|Archive skill/);
  assert.equal(writes.length, 0);
  assert.equal(document.querySelector('#skill-editor'), null);
});
test('skill creation validates required fields and saves the fixed four-level rubric without requiring certification mappings', async () => {
  await mount();
  await click('Add skill');
  await click('Save draft');
  assert.match(document.body.textContent!, /Enter a skill name and category/);
  await fill('Skill name', 'Customer Reporting SQL');
  await fill('Category', 'Databases');
  await fill('Description', 'Build and review customer SQL reporting queries');
  await click('Save draft');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].revision, 7);
  assert.equal(writes[0].status, 'DRAFT');
  assert.deepEqual(
    writes[0].levels.map((l: any) => l.rank),
    [1, 2, 3, 4],
  );
  assert.deepEqual(writes[0].relatedCertificationIds, []);
  assert.equal(changed, 1);
  assert.equal(document.querySelector('.form-dialog'), null);
  assert.match(document.body.textContent!, /Skill saved/);
});
test('editing and archival preserve stable skill identity and entered data across a rejected write', async () => {
  await mount();
  await click('SQL');
  await fill('Description', 'Clarified delivery evidence for SQL reporting');
  writeFailure = 409;
  await click('Archive skill');
  assert.match(document.body.textContent!, /Catalogue changed/);
  assert.equal(
    document.querySelector<HTMLTextAreaElement>('.form-dialog textarea')?.value,
    'Clarified delivery evidence for SQL reporting',
  );
  writeFailure = 0;
  await click('Archive skill');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[1].id, skill.id);
  assert.equal(writes[1].status, 'ARCHIVED');
  assert.equal(changed, 1);
});
test('a committed save followed by refresh failure is reported as saved; retry only reloads the catalogue', async () => {
  readFailure = 503;
  await mount();
  assert.match(document.body.textContent!, /Catalogue refresh unavailable/);
  readFailure = 0;
  await click('Reload catalogue');
  await debounce();
  await click('SQL');
  await fill('Description', 'Updated SQL query delivery examples');
  refreshFailure = true;
  await click('Save draft');
  assert.match(document.body.textContent!, /skill was saved, but refreshing failed/);
  assert.equal(writes.length, 1);
  assert.equal(changed, 1);
  assert.equal(document.querySelector('.form-dialog'), null);
  refreshFailure = false;
  await click('Reload catalogue');
  await debounce();
  assert.equal(writes.length, 1);
  assert.match(document.body.textContent!, /SQL/);
});
test('catalogue amendment navigation requires canonical current amendment access and can recover a denied context', async () => {
  contextAllowed = false;
  await mount(true);
  await click('Certifications');
  assert.match(document.body.textContent!, /Catalogue amendment access is not assigned/);
  assert.equal(writes.length, 0);
  await click('Skills', document);
  await debounce();
  assert.match(document.body.textContent!, /SQL/);
  assert.equal(writes.length, 0);
});

test('status filtering resets catalogue pagination and closing an unsaved editor does not write', async () => {
  skills = Array.from({ length: 26 }, (_, i) => ({
    ...skill,
    id: 'skill-' + i,
    name: 'SQL reporting ' + i,
  }));
  await mount();
  await click('Next');
  await debounce();
  assert.ok(reads.some(url => url.includes('page=2')));
  await click('Previous');
  await debounce();
  assert.match(reads.at(-1)!, /page=1/);
  await click('Next');
  await debounce();
  await fill('Status', 'ARCHIVED');
  await debounce();
  const query = new URL(reads.at(-1)!, 'http://localhost').searchParams;
  assert.equal(query.get('status'), 'ARCHIVED');
  assert.equal(query.get('page'), '1');
  await click('Add skill');
  await fill('Skill name', 'Unpublished experiment');
  const close = document.querySelector<HTMLButtonElement>(
    '.form-dialog button[aria-label^="Close "]',
  )!;
  await click(close.getAttribute('aria-label')!);
  assert.equal(document.querySelector('.form-dialog'), null);
  assert.equal(writes.length, 0);
});
