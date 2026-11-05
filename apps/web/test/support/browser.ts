import { act, type ReactNode } from 'react';
import { Window } from 'happy-dom';

const browser = new Window({ url: 'http://localhost:3000' });
Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  Event: browser.Event,
  CustomEvent: browser.CustomEvent,
  sessionStorage: browser.sessionStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
// Node's native channel would keep the test process alive; tabs are tested separately.
Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });
const { createRoot } = await import('react-dom/client');

export async function render(content: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(content));
  return {
    container,
    async update(next: ReactNode) {
      await act(async () => root.render(next));
    },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

export async function settle() {
  await act(async () => {
    await new Promise(resolve => setImmediate(resolve));
  });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function demoResponse(signedIn = true) {
  return Response.json({ mode: 'local-demo', people: [], signedIn });
}

export async function closeBrowser() {
  await browser.happyDOM.close();
}
