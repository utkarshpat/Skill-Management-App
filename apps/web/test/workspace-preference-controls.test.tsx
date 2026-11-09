import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, closeBrowser } from './support/browser';
import { component, click, change } from './support/interactions';

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

test('directory pagination resets when status and name filters are cleared', async () => {
  const { AccessDirectory } =
    component<typeof import('../src/AccessDirectory')>('AccessDirectory.tsx');
  const people = [
    'Neha Rao',
    'Aditi Menon',
    'Rohan Mehta',
    'Priya Nair',
    'Meera Joshi',
    'Arjun Singh',
    'Anita Desai',
    'Karan Shah',
    'Isha Verma',
    'Dev Sharma',
    'Vivek Sinha',
  ].map((displayName, i) => ({
    id: String(i),
    displayName,
    employeeCode: String(710900 + i),
    active: i < 10,
    roleIds: [],
  }));
  const view = await render(
    <AccessDirectory
      kind="people"
      people={people}
      roles={[]}
      busy={false}
      onPerson={() => {}}
      onRole={() => {}}
    />,
  );
  try {
    await click('Next people page', view.container);
    assert.match(view.container.textContent!, /Vivek Sinha/);
    assert.doesNotMatch(view.container.textContent!, /Neha Rao/);
    await click('Previous people page', view.container);
    assert.match(view.container.textContent!, /Neha Rao/);
    await change(view.container.querySelector('select')!, 'suspended');
    assert.match(view.container.textContent!, /Vivek Sinha/);
    await change(view.container.querySelector('input')!, 'Neha');
    assert.match(view.container.textContent!, /No matching people/);
    await click('Clear filters', view.container);
    assert.match(view.container.textContent!, /Page 1 of 2/);
    assert.match(view.container.textContent!, /Neha Rao/);
  } finally {
    await view.unmount();
  }
});
