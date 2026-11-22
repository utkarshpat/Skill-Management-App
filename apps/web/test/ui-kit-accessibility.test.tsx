import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { render, closeBrowser } from './support/browser';
import { component } from './support/interactions';
const UI = component<typeof import('../src/ui-kit')>('ui-kit.tsx');
after(closeBrowser);

test('progress controls expose bounded accessible values for missing and out-of-range data', async () => {
  for (const [value, expected] of [
    [-10, 0],
    [150, 100],
    [NaN, 0],
    [Infinity, 0],
    [42.7, 43],
  ]) {
    const view = await render(
      <>
        <UI.ProgressBar value={value} label="Profile completeness" tone="warning" size="sm" />
        <UI.ProgressRing value={value} label="Learning progress" />
      </>,
    );
    for (const control of view.container.querySelectorAll('[role="progressbar"]')) {
      assert.equal(control.getAttribute('aria-valuenow'), String(expected));
      assert.equal(control.getAttribute('aria-valuemin'), '0');
      assert.equal(control.getAttribute('aria-valuemax'), '100');
    }
    assert.match(view.container.textContent!, new RegExp(`${expected}%`));
    assert.doesNotMatch(view.container.innerHTML, /NaN|Infinity/);
    await view.unmount();
  }
  const view = await render(
    <UI.ProgressRing value={50} label="Skills" size={100} stroke={10} tone="success">
      <strong>Half complete</strong>
    </UI.ProgressRing>,
  );
  assert.equal(view.container.textContent, 'Half complete');
  assert.equal(view.container.querySelector('circle')?.getAttribute('r'), '45');
  await view.unmount();
});
