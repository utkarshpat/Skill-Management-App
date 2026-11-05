import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { act } from 'react';
import { settle } from './browser';
const require = createRequire(import.meta.url);
export const { MemoryRouter } = require('react-router') as typeof import('react-router');
export const { refreshDevelopmentLogin } =
  require('../../src/auth.ts') as typeof import('../../src/auth');
export function component<T>(path: string): T {
  const css = require.extensions['.css'];
  require.extensions['.css'] = () => {};
  try {
    return require('../../src/' + path) as T;
  } finally {
    if (css) require.extensions['.css'] = css;
    else delete require.extensions['.css'];
  }
}
export async function click(
  text: string,
  root: ParentNode = document.querySelector('.form-dialog') ?? document,
) {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    b => b.getAttribute('aria-label') === text || b.textContent?.trim().startsWith(text),
  );
  assert.ok(button, 'Missing button ' + text);
  assert.equal(button.disabled, false, 'Disabled button ' + text);
  await act(async () => button.click());
  await settle();
  await settle();
}
export async function change(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      field.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : field.tagName === 'SELECT'
          ? window.HTMLSelectElement.prototype
          : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}
export async function fill(label: string, value: string, root: ParentNode = document) {
  const named = Array.from(root.querySelectorAll<HTMLLabelElement>('label')).find(l =>
    l.textContent?.trim().startsWith(label),
  );
  const field =
    named?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input,textarea,select',
    ) ?? (named?.htmlFor ? document.getElementById(named.htmlFor) : undefined);
  assert.ok(
    field instanceof window.HTMLInputElement ||
      field instanceof window.HTMLTextAreaElement ||
      field instanceof window.HTMLSelectElement,
    'Missing field ' + label,
  );
  await change(field as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value);
}
export async function debounce() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 280));
  });
  await settle();
  await settle();
}
