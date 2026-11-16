import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { useState } from 'react';
import { render, closeBrowser, demoResponse } from './support/browser';
import { component, refreshDevelopmentLogin, click, fill, debounce } from './support/interactions';
import type { PrimaryCapabilityDetails } from '../src/PrimaryCapability';
import type { SkillOption } from '../src/PublishedSkillPicker';

const { PrimaryCapabilityFields } = component<typeof import('../src/PrimaryCapabilityFields')>(
  'PrimaryCapabilityFields.tsx',
);
const { PublishedSkillPicker } = component<typeof import('../src/PublishedSkillPicker')>(
  'PublishedSkillPicker.tsx',
);
let view: Awaited<ReturnType<typeof render>> | undefined;
let requests: URL[], unavailable: boolean;
beforeEach(async () => {
  requests = [];
  unavailable = true;
  mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/dev-login') return demoResponse();
    requests.push(url);
    if (unavailable) return Response.json({}, { status: 503 });
    const search = url.searchParams.get('search');
    const page = Number(url.searchParams.get('page'));
    const items = search
      ? []
      : [
          page === 1
            ? { id: 'sql', name: 'Reporting SQL', category: 'Data', status: 'PUBLISHED' }
            : { id: 'azure', name: 'Azure Monitoring', category: 'Cloud', status: 'PUBLISHED' },
        ];
    if (url.pathname === '/api/dev-access/primary-capabilities')
      return Response.json({ items, total: search ? 0 : 2, pageSize: 1, page });
    assert.equal(url.pathname, '/api/skills');
    assert.equal(url.searchParams.get('status'), 'PUBLISHED');
    return Response.json({ skills: items, total: search ? 0 : 2, pageSize: 1 });
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  mock.restoreAll();
});
after(closeBrowser);

test('primary capability preserves a retired choice until a published replacement or explicit clear', async () => {
  function Editor() {
    const [value, setValue] = useState<PrimaryCapabilityDetails>({
      primaryCapabilityId: 'historic',
      primaryCapabilityName: 'Legacy Reporting',
      primaryCapabilityStatus: 'ARCHIVED',
    });
    return <PrimaryCapabilityFields endpoint="/api/dev-access" value={value} onChange={setValue} />;
  }
  view = await render(<Editor />);
  await debounce();
  assert.match(view.container.textContent!, /no longer published/);
  unavailable = false;
  await click('Retry capability search');
  await debounce();
  await click('Next');
  await debounce();
  await click('Previous');
  await debounce();
  await fill('Selected primary capability', 'sql');
  assert.doesNotMatch(view.container.textContent!, /Legacy Reporting/);
  await fill('Search published capabilities', 'nonexistent');
  await debounce();
  assert.match(view.container.textContent!, /No published capabilities match/);
  assert.equal(view.container.querySelector('select')!.value, 'sql');
  await fill('Selected primary capability', '');
  assert.equal(view.container.querySelector('select')!.value, '');
  assert.deepEqual(
    requests.map(url => url.searchParams.get('page')),
    ['1', '1', '2', '1', '1'],
  );
});

test('optional skill search retries, pages and retains a selected skill until explicitly removed', async () => {
  function Editor() {
    const [value, setValue] = useState<SkillOption>();
    return <PublishedSkillPicker value={value} onChange={setValue} />;
  }
  view = await render(<Editor />);
  await debounce();
  assert.match(view.container.textContent!, /Published skills could not be loaded/);
  unavailable = false;
  await click('Retry');
  await debounce();
  await click('Next results');
  await debounce();
  await click('Azure Monitoring');
  await click('Previous results');
  await debounce();
  assert.match(view.container.textContent!, /Selected: Azure Monitoring/);
  await fill('Search published skills', 'nonexistent');
  await debounce();
  assert.match(view.container.textContent!, /No matching published skills/);
  await click('Remove');
  assert.match(view.container.textContent!, /No skill linked/);
  assert.deepEqual(
    requests.map(url => url.searchParams.get('page')),
    ['1', '1', '2', '1', '1'],
  );
});
