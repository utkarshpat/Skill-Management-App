import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, closeBrowser } from './support/browser';
import { component, click } from './support/interactions';

after(closeBrowser);

test('theme follows system changes and synchronizes cross-tab preferences without persisting invalid values', async () => {
  const media = Object.assign(new window.EventTarget(), { matches: false });
  const storage = new Map([['skill-ui-theme', 'system']]);
  const mediaDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => media });
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const persisted = Object.assign(storage, {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: persisted });
  const { ThemeProvider, ThemeSwitcher } = component<typeof import('../src/Theme')>('Theme.tsx');
  const view = await render(
    <ThemeProvider>
      <ThemeSwitcher />
    </ThemeProvider>,
  );
  try {
    assert.equal(document.documentElement.dataset.theme, 'light');
    media.matches = true;
    await act(async () => media.dispatchEvent(new globalThis.Event('change')));
    assert.equal(document.documentElement.dataset.theme, 'dark');
    await click('Switch to light theme');
    assert.equal(persisted.get('skill-ui-theme'), 'light');
    for (const [newValue, expected] of [
      ['dark', 'dark'],
      ['bad', 'light'],
    ]) {
      await act(async () =>
        window.dispatchEvent(
          new window.StorageEvent('storage', { key: 'skill-ui-theme', newValue }),
        ),
      );
      assert.equal(document.documentElement.dataset.theme, expected);
      assert.equal(persisted.get('skill-ui-theme'), expected);
    }
  } finally {
    await view.unmount();
    if (mediaDescriptor) Object.defineProperty(globalThis, 'matchMedia', mediaDescriptor);
    else Reflect.deleteProperty(globalThis, 'matchMedia');
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
