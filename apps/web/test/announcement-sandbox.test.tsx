import test, { after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { component, refreshDevelopmentLogin } from './support/interactions';
import type { Definition } from '../src/announcement-model';
const { AnnouncementSandbox } =
  component<typeof import('../src/AnnouncementSandbox')>('AnnouncementSandbox.tsx');
const definition = {
  kind: 'FORM',
  title: 'Training',
  message: '',
  cta: 'Register',
  fields: [{ id: 'batch', label: 'Batch', type: 'text', required: false, options: [] }],
  options: [],
  exports: [],
  audience: [],
  versions: [],
  popup: false,
  marquee: false,
  imageAlt: '',
  imagePosition: 'center',
  design: {
    format: 'sandbox-v1',
    html: '<h2 id="ann-title"></h2>',
    css: '',
    bindings: [],
    order: [],
    color: '#126b70',
    background: '#ffffff',
    align: 'left',
    layout: 'stack',
  },
} as Definition;
const person = { name: 'Employee', email: 'employee@example.com', employeeId: '100' };
let view: Awaited<ReturnType<typeof render>> | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);

test('sandbox bridge rejects forged sources, channels and answer keys and uses current callbacks after locking', async () => {
  const submitted: unknown[] = [],
    votes: string[] = [];
  let opens = 0;
  const props = {
    definition,
    person,
    onSubmit: (answers: Record<string, string | boolean>) => submitted.push(answers),
    onVote: (vote: string) => votes.push(vote),
    onOpen: () => {
      opens++;
    },
  };
  view = await render(<AnnouncementSandbox {...props} />);
  const frame = document.querySelector('iframe')!;
  const rendered: any[] = [];
  Object.defineProperty(frame, 'contentWindow', {
    configurable: true,
    value: { postMessage: (data: any) => rendered.push(data) },
  });
  const send = async (data: unknown, source = frame.contentWindow) =>
    act(async () => {
      window.dispatchEvent(new window.MessageEvent('message', { source, data }));
    });
  await send({ type: 'announcement.ready' });
  const channel = rendered.at(-1).channel;
  assert.ok(channel);
  const action = (changes: object = {}) => ({
    type: 'announcement.action',
    channel,
    action: 'submit',
    answers: { batch: 'Evening' },
    ...changes,
  });
  await send(action(), window);
  await send(action({ channel: 'forged' }));
  await send(action({ answers: { email: 'forged@example.com' } }));
  await send(action({ answers: [] }));
  await send(action({ answers: { batch: { nested: true } } }));
  await send(null);
  assert.deepEqual(submitted, []);
  await send(action());
  assert.deepEqual(submitted, [{ batch: 'Evening' }]);
  await send(action({ action: 'open-form' }));
  assert.equal(opens, 1);
  await send({ type: 'announcement.height', channel, height: -1 });
  assert.equal(frame.style.height, '300px');
  await send({ type: 'announcement.height', channel, height: 640 });
  assert.equal(frame.style.height, '640px');
  await view.update(<AnnouncementSandbox {...props} busy />);
  await send(action());
  await view.update(<AnnouncementSandbox {...props} answered />);
  await send(action());
  assert.equal(submitted.length, 1);
  await view.update(
    <AnnouncementSandbox
      {...props}
      definition={{ ...definition, kind: 'POLL', options: ['Azure', 'SQL'] }}
    />,
  );
  await send(action({ action: 'vote', index: 2 }));
  await send(action({ action: 'vote', index: 0.5 }));
  await send(action({ action: 'vote', index: 1 }));
  assert.deepEqual(votes, ['SQL']);
});

test('sandbox accepts app-owned image bytes while rejecting external image URLs', async () => {
  mock.method(globalThis, 'fetch', async (input: any) => {
    if (String(input) === '/api/dev-login') return demoResponse();
    return new window.Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { 'Content-Type': 'image/png' },
    }) as unknown as Response;
  });
  const original = globalThis.FileReader;
  Object.assign(globalThis, { FileReader: window.FileReader });
  try {
    await refreshDevelopmentLogin();
    view = await render(
      <AnnouncementSandbox
        definition={definition}
        person={person}
        image="https://external.example/pixel"
      />,
    );
    const frame = document.querySelector('iframe')!;
    const rendered: any[] = [];
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: { postMessage: (data: any) => rendered.push(data) },
    });
    const ready = () =>
      act(async () => {
        window.dispatchEvent(
          new window.MessageEvent('message', {
            source: frame.contentWindow,
            data: { type: 'announcement.ready' },
          }),
        );
      });
    await ready();
    assert.equal(rendered.at(-1).image, undefined);
    await view.update(
      <AnnouncementSandbox
        definition={definition}
        person={person}
        image="data:image/png;base64,iVBORw=="
      />,
    );
    await settle();
    assert.equal(rendered.at(-1).image, 'data:image/png;base64,iVBORw==');
    const fetchedImage = new window.Blob([new Uint8Array([137, 80, 78, 71])], {
      type: 'image/png',
    });
    const authenticatedFetch = await import('../src/auth.js');
    mock.method(authenticatedFetch, 'authenticatedFetch', async () => ({
      ok: true,
      blob: async () => fetchedImage,
    }));
    await view.update(
      <AnnouncementSandbox
        definition={definition}
        person={person}
        image="/api/announcements/unit-image/image"
      />,
    );
    await settle();
    await settle();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    assert.match(rendered.at(-1).image, /^data:image\/png;base64,/);
  } finally {
    Object.assign(globalThis, { FileReader: original });
  }
});
