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
function fakeBridge(frame: HTMLIFrameElement) {
  Object.defineProperty(frame, 'contentWindow', { configurable: true, value: {} });
  const rendered: { channel: string; image?: string; person: typeof person }[] = [];
  const channel = frame.getAttribute('src')!.split('#')[1];
  const receiver = {
    onmessage: undefined as ((event: MessageEvent) => void) | undefined,
    postMessage: (data: (typeof rendered)[number]) => rendered.push(data),
    close: () => {},
  };
  const ready = (source = frame.contentWindow, value = channel) =>
    act(async () => {
      window.dispatchEvent(
        new window.MessageEvent('message', {
          source,
          origin: 'null',
          data: { type: 'announcement.ready', channel: value },
          ports: [receiver as unknown as MessagePort],
        }),
      );
    });
  const send = (data: unknown) => act(async () => receiver.onmessage?.({ data } as MessageEvent));
  return { rendered, channel, ready, send };
}
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
  const { channel, ready, rendered, send } = fakeBridge(frame);
  await ready(window);
  await ready(frame.contentWindow, 'wrong-channel');
  assert.equal(rendered.length, 0);
  await ready();
  assert.deepEqual(rendered.at(-1)?.person, person);
  const action = (changes: object = {}) => ({
    type: 'announcement.action',
    channel,
    action: 'submit',
    answers: { batch: 'Evening' },
    ...changes,
  });
  await act(async () => {
    window.dispatchEvent(
      new window.MessageEvent('message', { source: frame.contentWindow, data: action() }),
    );
  });
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
  const imageRequests: string[] = [];
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/api/dev-login') return demoResponse();
    imageRequests.push(path);
    return Object.assign(new Response(null, { headers: { 'Content-Type': 'image/png' } }), {
      blob: async () => new window.Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    });
  });
  const original = globalThis.FileReader;
  mock.method(
    window.FileReader.prototype,
    'readAsDataURL',
    function (this: FileReader, blob: Blob) {
      assert.equal(blob.type, 'image/png');
      Object.defineProperty(this, 'result', { value: 'data:image/png;base64,iVBORw==' });
      this.onload?.call(this, new window.ProgressEvent('load') as ProgressEvent<FileReader>);
    },
  );
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
    const { ready, rendered } = fakeBridge(frame);
    await ready();
    assert.equal(rendered.at(-1)!.image, undefined);
    await view.update(
      <AnnouncementSandbox
        definition={definition}
        person={person}
        image="data:image/png;base64,iVBORw=="
      />,
    );
    await settle();
    assert.equal(rendered.at(-1)!.image, 'data:image/png;base64,iVBORw==');
    await view.update(
      <AnnouncementSandbox
        definition={definition}
        person={person}
        image="/api/announcements/unit-image/image"
      />,
    );
    await settle();
    await settle();
    assert.match(rendered.at(-1)!.image!, /^data:image\/png;base64,/);
    assert.deepEqual(imageRequests, ['/api/announcements/unit-image/image']);
  } finally {
    Object.assign(globalThis, { FileReader: original });
  }
});
