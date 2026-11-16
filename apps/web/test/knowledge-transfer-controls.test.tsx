import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRequire } from 'node:module';
import { render, settle, closeBrowser, demoResponse, deferred } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  change,
} from './support/interactions';
import content from '../../api/src/modules/knowledge-transfer/content.generated';

const { useLocation } = createRequire(import.meta.url)(
  'react-router',
) as typeof import('react-router');
const { KnowledgeTransfer } = component<
  typeof import('../src/knowledge-transfer/KnowledgeTransfer')
>('knowledge-transfer/KnowledgeTransfer.tsx');
const data = { ...content, temporary: true, ai: { configured: true, provider: 'azure' } };
let view: Awaited<ReturnType<typeof render>> | undefined;
let loadFailure: boolean, aiConfigured: boolean, prints: number;
let downloads: { file: string; blob: Blob }[],
  pending: ReturnType<typeof deferred<Response>>,
  guideSignal: AbortSignal | null | undefined;

function Route() {
  return <output data-chapter>{useLocation().hash.slice(1)}</output>;
}
const chapter = () => document.querySelector('[data-chapter]')!.textContent;
const nav = () => document.querySelector('.kt-nav')!;
const toolbar = () => document.querySelector('.kt-mobile-toolbar')!;
const search = () => document.querySelector<HTMLInputElement>('[aria-label="Search handover"]')!;

beforeEach(async () => {
  loadFailure = false;
  aiConfigured = true;
  prints = 0;
  downloads = [];
  pending = deferred<Response>();
  guideSignal = undefined;
  Object.defineProperty(window, 'print', {
    configurable: true,
    value: () => {
      prints++;
    },
  });
  let blob: Blob;
  mock.method(URL, 'createObjectURL', (value: Blob) => {
    blob = value;
    return 'blob:handover';
  });
  mock.method(URL, 'revokeObjectURL', () => {});
  mock.method(window.HTMLAnchorElement.prototype, 'click', function (this: HTMLAnchorElement) {
    downloads.push({ file: this.download, blob });
  });
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    if (url === '/api/knowledge-transfer/explain') {
      guideSignal = init?.signal;
      return pending.promise;
    }
    assert.equal(url, '/api/knowledge-transfer');
    return loadFailure
      ? Response.json({ error: { message: 'Handover access denied' } }, { status: 403 })
      : Response.json({ ...data, ai: { ...data.ai, configured: aiConfigured } });
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);

async function mount(hash = '') {
  view = await render(
    <MemoryRouter initialEntries={['/knowledgetransfer' + hash]}>
      <KnowledgeTransfer />
      <Route />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}

test('handover denial recovers via retry and print and export use the restored handbook', async () => {
  loadFailure = true;
  await mount();
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /Handover access denied/);
  assert.equal(document.querySelector('.kt-content'), null);
  loadFailure = false;
  await click('Retry');
  assert.ok(document.querySelector('.kt-content'));
  await click('Print');
  assert.equal(prints, 1);
  await click('Export handbook');
  assert.equal(downloads[0].file, 'project-handover.md');
  assert.match(await downloads[0].blob.text(), /trust boundar/i);
});

test('handover chapter controls preserve the selected route and close the mobile chapter panel', async () => {
  await mount();
  await click('Chapters', toolbar());
  assert.ok(nav().classList.contains('kt-nav-open'));
  await click('Close chapters', nav());
  assert.equal(nav().classList.contains('kt-nav-open'), false);
  await click('Explore architecture');
  assert.equal(chapter(), 'architecture-trust-boundaries');
  await click('Identity + Access', document.querySelector('.kt-architecture')!);
  assert.equal(chapter(), 'identity-effective-access');
  await click('Next chapter');
  const index = data.sections.findIndex(item => item.id === 'identity-effective-access');
  assert.equal(chapter(), data.sections[index + 1].id);
  await click('Previous chapter');
  assert.equal(chapter(), 'identity-effective-access');
  await click('Disable / remove this feature', nav());
  assert.equal(chapter(), 'temporary-feature-removal');
});

test('searching schema and following a declared foreign key keeps the selected table in the route and export', async () => {
  await mount();
  await click('Chapters', toolbar());
  await change(search(), 'AccessPerson');
  await click('AccessPerson', document.querySelector('.kt-results')!);
  assert.equal(chapter(), 'table-AccessPerson');
  assert.equal(search().value, '');
  assert.equal(nav().classList.contains('kt-nav-open'), false);
  assert.match(document.querySelector('.kt-entity-title')!.textContent!, /dbo.AccessPerson/);
  const key = document.querySelector<HTMLButtonElement>('.kt-key-details button')!;
  const target = key.textContent!;
  await click(target, document.querySelector('.kt-key-details')!);
  assert.equal(chapter(), 'table-' + target);
  assert.match(
    document.querySelector('.kt-entity-title')!.textContent!,
    new RegExp('dbo\\.' + target),
  );
  await click('Export schema');
  assert.equal(downloads[0].file, 'repository-schema.json');
  const schema = JSON.parse(await downloads[0].blob.text());
  assert.ok(schema.tables.AccessPerson);
  assert.ok(schema.tables[target]);
});

test('stopping project guide generation aborts the request and suppresses its late response', async () => {
  await mount();
  await click('AI guide', toolbar());
  const guide = document.querySelector('[aria-label="Project AI guide"]')!;
  const prompt = 'How does manager skill review work?';
  await click(prompt, guide);
  assert.equal(guide.querySelector('textarea')!.value, prompt);
  await click('Send project question', guide);
  assert.equal(guideSignal?.aborted, false);
  await click('Stop generating', guide);
  assert.equal(guideSignal?.aborted, true);
  await act(async () =>
    pending.resolve(Response.json({ reply: 'Late reply after cancellation', sources: [] })),
  );
  await settle();
  assert.doesNotMatch(guide.textContent!, /Late reply after cancellation/);
  await click('Collapse project guide', guide);
  assert.ok(document.querySelector('.kt-guide-launcher'));
  await click('Ask the project guide', document.querySelector('.kt-page')!);
  assert.equal(document.querySelector('.kt-guide-launcher'), null);
});

test('handover dashboard and chapter navigation lead to the same canonical routes', async () => {
  await mount();
  await click('Open schema explorer');
  const schemaChapter = chapter();
  assert.match(schemaChapter!, /schema/);
  const table = document.querySelector<HTMLButtonElement>(
    '.kt-entity-list button, .kt-schema-list button, button[aria-current="page"]',
  );
  assert.ok(document.querySelector('.kt-entity-title') || table);
  for (const [label, expected] of [
    ['Business + temporary modules', 'module-ownership-code-map'],
    ['Physical tables', schemaChapter],
    ['Declared foreign keys', schemaChapter],
    ['Reviewed migrations', 'setup-configuration-deployment'],
  ] as const) {
    await act(async () => nav().querySelector<HTMLButtonElement>('nav button')!.click());
    const stat = [...document.querySelectorAll<HTMLButtonElement>('.kt-stats button')].find(
      button => button.textContent?.includes(label),
    )!;
    assert.ok(stat, label);
    await act(async () => stat.click());
    await settle();
    assert.equal(chapter(), expected);
  }
});
