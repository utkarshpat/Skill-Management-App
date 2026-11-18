import test, { after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { component, refreshDevelopmentLogin, click, fill } from './support/interactions';
import type { Definition } from '../src/announcement-model';
const { announcementStyle } =
  component<typeof import('../src/AnnouncementContent')>('AnnouncementContent.tsx');
const { AnnouncementManager } =
  component<typeof import('../src/AnnouncementManager')>('AnnouncementManager.tsx');
let view: Awaited<ReturnType<typeof render>> | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);

test('designer tokens compile to bounded typography, corners and connected button treatment', () => {
  const style = announcementStyle({
    design: {
      color: '#126b70',
      background: '#ffffff',
      cornerStyle: 'square',
      headingScale: 'compact',
      buttonStyle: 'outline',
      formLayout: 'single',
      density: 'comfortable',
    },
  } as Definition)!;
  assert.equal(style['--announcement-radius' as keyof typeof style], '4px');
  assert.equal(style['--announcement-title-size' as keyof typeof style], '1.15rem');
  assert.equal(style['--announcement-button-background' as keyof typeof style], 'transparent');
  assert.equal(style['--announcement-button-color' as keyof typeof style], '#126b70');
  assert.equal(announcementStyle({} as Definition), undefined);
});

test('announcement form controls preserve reordered questions, exports, schedules and design revisions in saved drafts', async () => {
  const requests: { path: string; body: any }[] = [];
  const design = {
    order: ['title', 'message', 'action'],
    color: '#126b70',
    background: '#ffffff',
    align: 'left',
    layout: 'stack',
    html: '',
    css: '',
  };
  mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const path = String(input);
    if (path === '/api/dev-login') return demoResponse();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path, body });
    if (path === '/api/announcements/manage')
      return Response.json({
        actorId: 'editor-controls',
        grants: [{ id: 'grant', kind: 'DELIVERY_UNIT', scopeId: 'du' }],
        scopes: [{ id: 'du', kind: 'DELIVERY_UNIT', grantId: 'grant', label: 'UK' }],
        items: [],
        aiAvailable: true,
      });
    if (path === '/api/announcements/design')
      return Response.json({ id: 'version', feedback: 'Compact accessible form', design });
    if (path === '/api/announcements/draft')
      return Response.json({
        id: 'draft',
        revision: 1,
        state: 'DRAFT',
        audienceCount: 4,
        receipt: 'receipt',
      });
    throw Error('Unexpected request ' + path);
  });
  await refreshDevelopmentLogin();
  view = await render(
    <AnnouncementManager view="announcements" onViewChange={() => {}} onUpdated={() => {}} />,
  );
  await settle();
  await click('New announcement');
  await fill('Title', 'Training signup');
  await fill('Message', 'Choose a preferred batch.');
  await fill('Starts at', '2026-12-01T10:00');
  await fill('Ends at', '2026-12-02T10:00');
  await fill('Button label', 'Apply now');
  await click('Add field');
  await fill('Field 1 label', 'Preferred batch');
  await fill('Field type', 'choice');
  await fill('Options (one per line)', 'Morning\nEvening');
  const checkbox = (label: string) => {
    const element = [...document.querySelectorAll('label')]
      .find(l => l.textContent?.trim() === label)
      ?.querySelector<HTMLInputElement>('input');
    assert.ok(element, label);
    return element;
  };
  await act(async () => checkbox('Required').click());
  await click('Add field');
  await fill('Field 2 label', 'Comments');
  await click('Move field up');
  await act(async () => checkbox('Delivery Unit').click());
  await act(async () => checkbox('Grade').click());
  await act(async () => checkbox('Grade').click());
  await act(async () => checkbox('Scroll the banner text').click());
  await click('Continue to AI design');
  assert.match(document.body.textContent ?? '', /Design updated/);
  await fill('Design version', '');
  await fill('Design version', 'version');
  await click('Save draft');
  const saved = requests.filter(x => x.path.endsWith('/draft')).at(-1)!.body;
  assert.equal(saved.definition.title, 'Training signup');
  assert.equal(saved.definition.cta, 'Apply now');
  assert.equal(saved.startsAt, new Date('2026-12-01T10:00').toISOString());
  assert.deepEqual(
    saved.definition.fields.map((f: any) => f.label),
    ['Comments', 'Preferred batch'],
  );
  assert.deepEqual(saved.definition.fields[1].options, ['Morning', 'Evening']);
  assert.equal(saved.definition.fields[1].required, true);
  assert.deepEqual(saved.definition.exports, ['du']);
  assert.equal(saved.definition.selectedVersion, 'version');
  assert.equal(saved.definition.marquee, true);
  await click('Discard selected design');
  await click('Basic details');
  await click('Remove field');
  await fill('Interaction', 'POLL');
  await fill('Option 1', 'Morning');
  await fill('Option 2', 'Evening');
  await click('Add option');
  await fill('Option 3', 'Weekend');
  await click('Remove option 3');
  await click('Save draft');
  const poll = requests.filter(x => x.path.endsWith('/draft')).at(-1)!.body;
  assert.equal(poll.definition.kind, 'POLL');
  assert.deepEqual(poll.definition.options, ['Morning', 'Evening']);
  assert.equal(poll.definition.versions.length, 0);
  assert.equal(poll.definition.fields.length, 1);
  await click('Back to announcements');
  assert.equal(document.querySelector('dialog'), null);
  assert.match(document.body.textContent ?? '', /New announcement/);
});
