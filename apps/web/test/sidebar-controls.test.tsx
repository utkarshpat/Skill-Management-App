import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { BookOpen } from 'lucide-react';
import { render, settle, closeBrowser } from './support/browser';
import { component, MemoryRouter, click } from './support/interactions';
const { SidebarNavigation } =
  component<typeof import('../src/SidebarNavigation')>('SidebarNavigation.tsx');
const { sidebarStorageKey } = component<typeof import('../src/sidebar-order')>('sidebar-order.ts');
let view: Awaited<ReturnType<typeof render>> | undefined;
let navigated = 0,
  selected: string[] = [];
const items = () => [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/dashboard',
    icon: BookOpen,
    onSelect: () => selected.push('dashboard'),
  },
  { id: 'learning', label: 'Learn & Grow', href: '/learning', icon: BookOpen, active: true },
  { id: 'requests', label: 'Requests', icon: BookOpen, onSelect: () => selected.push('requests') },
  { id: 'profile', label: 'My profile', icon: BookOpen, onSelect: () => selected.push('profile') },
];
beforeEach(() => {
  window.localStorage.clear();
  navigated = 0;
  selected = [];
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);
const rows = () =>
  [...document.querySelectorAll('.sidebar-scroll [data-nav-id]')].map(el =>
    el.getAttribute('data-nav-id'),
  );
async function mount(actorId = 'aditi') {
  view = await render(
    <MemoryRouter>
      <SidebarNavigation
        items={items()}
        actorId={actorId}
        label="Workspace"
        onNavigate={() => navigated++}
      />
    </MemoryRouter>,
  );
  await settle();
}
async function key(label: string, key: string) {
  const handle = document.querySelector<HTMLButtonElement>(`[aria-label="Reorder ${label}"]`)!;
  await act(async () =>
    handle.dispatchEvent(
      new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    ),
  );
  await settle();
}

test('sidebar keyboard reorder is bounded, profile stays fixed and reset restores only presentation', async () => {
  await mount();
  assert.deepEqual(rows(), ['dashboard', 'learning', 'requests']);
  await key('Dashboard', 'ArrowDown');
  assert.deepEqual(rows(), ['learning', 'dashboard', 'requests']);
  await key('Dashboard', 'End');
  assert.deepEqual(rows(), ['learning', 'requests', 'dashboard']);
  await key('Dashboard', 'Home');
  assert.deepEqual(rows(), ['dashboard', 'learning', 'requests']);
  await key('Dashboard', 'ArrowUp');
  assert.deepEqual(rows(), ['dashboard', 'learning', 'requests']);
  await key('Requests', 'ArrowUp');
  assert.deepEqual(rows(), ['dashboard', 'requests', 'learning']);
  await key('Requests', 'x');
  await key('Requests', 'Escape');
  assert.match(document.body.textContent!, /Reordering cancelled/);
  assert.equal(document.querySelector('[aria-label="Reorder My profile"]'), null);
  await click('Reset sidebar order');
  assert.deepEqual(rows(), ['dashboard', 'learning', 'requests']);
  assert.equal(navigated, 0);
  assert.equal(selected.length, 0);
  assert.ok(window.localStorage.getItem(sidebarStorageKey('aditi')));
});

test('sidebar handles link, action and fixed profile navigation without adding unprovided destinations', async () => {
  await mount();
  const link = document.querySelector<HTMLAnchorElement>('a[href="/dashboard"]')!;
  await act(async () => link.click());
  await click('Requests');
  await act(async () => document.querySelector<HTMLAnchorElement>('a[href="/profile"]')!.click());
  assert.deepEqual(selected, ['dashboard', 'requests', 'profile']);
  assert.equal(navigated, 3);
  assert.equal(document.querySelector('a[href="/access"]'), null);
});

test('sidebar storage updates are actor-bound and freshness shows retry state without changing navigation', async () => {
  await mount();
  window.localStorage.setItem(
    sidebarStorageKey('aditi'),
    JSON.stringify(['requests', 'learning', 'dashboard']),
  );
  await act(async () =>
    window.dispatchEvent(new window.StorageEvent('storage', { key: sidebarStorageKey('rohan') })),
  );
  assert.deepEqual(rows(), ['dashboard', 'learning', 'requests']);
  await act(async () =>
    window.dispatchEvent(new window.StorageEvent('storage', { key: sidebarStorageKey('aditi') })),
  );
  assert.deepEqual(rows(), ['requests', 'learning', 'dashboard']);
  await act(async () =>
    window.dispatchEvent(
      new CustomEvent('workspace-freshness', {
        detail: { mode: 'retrying', checkedAt: Date.now() },
      }),
    ),
  );
  assert.match(document.querySelector('.sidebar-last-updated')!.textContent!, /Refresh failed/);
  await view!.update(
    <MemoryRouter>
      <SidebarNavigation items={items()} actorId="rohan" label="Workspace" />
    </MemoryRouter>,
  );
  assert.deepEqual(rows(), ['dashboard', 'learning', 'requests']);
});

test('sidebar preserves session reorder when storage is denied and hides reorder without an actor', async () => {
  await mount();
  mock.method(window.localStorage, 'setItem', () => {
    throw Error('Storage denied');
  });
  await key('Requests', 'Home');
  assert.deepEqual(rows(), ['requests', 'dashboard', 'learning']);
  assert.match(document.body.textContent!, /Storage unavailable; kept for this session/);
  await view!.unmount();
  view = undefined;
  await mount('');
  assert.equal(document.querySelector('.sidebar-drag-handle'), null);
  assert.equal(document.querySelector('.sidebar-order-tools'), null);
});

async function pointer(
  handle: HTMLButtonElement,
  type: string,
  y: number,
  pointerId = 1,
  button = 0,
) {
  await act(async () =>
    handle.dispatchEvent(
      new window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        button,
        clientY: y,
      }),
    ),
  );
  await settle();
}
function capture(handle: HTMLButtonElement) {
  let captured = false;
  Object.defineProperties(handle, {
    setPointerCapture: {
      configurable: true,
      value: () => {
        captured = true;
      },
    },
    hasPointerCapture: { configurable: true, value: () => captured },
    releasePointerCapture: {
      configurable: true,
      value: () => {
        captured = false;
      },
    },
  });
}

test('sidebar pointer hold drags to nearest visible item while short movement and cancellation never reorder', async () => {
  await mount();
  const handle = document.querySelector<HTMLButtonElement>('[aria-label="Reorder Dashboard"]')!;
  capture(handle);
  const rowElements = [...document.querySelectorAll<HTMLElement>('.sidebar-scroll [data-nav-id]')];
  rowElements.forEach((row, index) =>
    mock.method(row, 'getBoundingClientRect', () => ({
      top: index * 80,
      bottom: index * 80 + 70,
      height: 70,
      x: 0,
      y: index * 80,
      width: 200,
      left: 0,
      right: 200,
      toJSON: () => ({}),
    })),
  );
  const scroll = document.querySelector<HTMLElement>('.sidebar-scroll')!;
  mock.method(scroll, 'getBoundingClientRect', () => ({
    top: 0,
    bottom: 220,
    height: 220,
    x: 0,
    y: 0,
    width: 200,
    left: 0,
    right: 200,
    toJSON: () => ({}),
  }));
  await pointer(handle, 'pointerdown', 20, 1, 2);
  await pointer(handle, 'pointerup', 195);
  assert.deepEqual(rows(), ['dashboard', 'learning', 'requests']);
  await pointer(handle, 'pointerdown', 20);
  await pointer(handle, 'pointermove', 40);
  await pointer(handle, 'pointerup', 195);
  assert.deepEqual(rows(), ['dashboard', 'learning', 'requests']);
  await pointer(handle, 'pointerdown', 20);
  await act(async () => new Promise(resolve => setTimeout(resolve, 240)));
  assert.ok(document.querySelector('.is-reordering'));
  await pointer(handle, 'pointermove', 195, 9);
  assert.equal(document.querySelector('.is-drop-target'), null);
  await pointer(handle, 'pointermove', 195);
  assert.ok(document.querySelector('[data-nav-id="requests"].is-drop-target'));
  assert.equal(scroll.scrollTop, 18);
  await pointer(handle, 'pointerup', 195);
  assert.deepEqual(rows(), ['learning', 'requests', 'dashboard']);
  await pointer(handle, 'pointerdown', 195);
  await pointer(handle, 'pointercancel', 195);
  assert.equal(document.querySelector('.is-reordering'), null);
});
