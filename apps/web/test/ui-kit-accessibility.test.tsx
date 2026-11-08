import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
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

test('charts exclude invalid samples and remain readable with empty or constant series', async () => {
  const view = await render(
    <>
      <UI.DonutChart
        caption="Review decisions"
        slices={[
          { label: 'Approved', value: 3, color: 'green' },
          { label: 'Pending', value: 1, color: 'orange' },
          { label: 'Invalid', value: NaN, color: 'red' },
          { label: 'Negative', value: -5, color: 'red' },
          { label: 'Empty', value: 0, color: 'gray' },
        ]}
      />
      <UI.Sparkline label="Weekly learning" points={[NaN, 2, 4, Infinity, 3]} />
      <UI.MiniBars label="Team skills" values={[NaN, -2, 0, 4]} />
    </>,
  );
  assert.equal(view.container.querySelectorAll('.ui-donut-slice').length, 2);
  assert.equal(view.container.querySelectorAll('figcaption li').length, 2);
  assert.equal(view.container.querySelector('.ui-donut-center')?.textContent, '4');
  assert.doesNotMatch(view.container.textContent!, /Invalid|Negative|Empty/);
  assert.equal(view.container.querySelectorAll('.ui-bars i').length, 3);
  assert.equal((view.container.querySelector('.ui-bars i') as HTMLElement).style.height, '0%');
  assert.doesNotMatch(view.container.innerHTML, /NaN|Infinity/);
  await view.update(
    <>
      <UI.DonutChart caption="No decisions" slices={[]} centerLabel="No data" />
      <UI.Sparkline label="Not enough samples" points={[NaN, 1]} />
      <UI.MiniBars label="No samples" values={[Infinity]} />
    </>,
  );
  assert.equal(view.container.querySelectorAll('.ui-donut-slice').length, 0);
  assert.equal(view.container.querySelector('[aria-label="Not enough samples"]'), null);
  assert.equal(view.container.querySelector('[aria-label="No samples"]'), null);
  assert.match(view.container.textContent!, /No data/);
  await view.update(<UI.Sparkline label="Steady progress" points={[3, 3, 3]} tone="success" />);
  assert.doesNotMatch(view.container.innerHTML, /NaN|Infinity/);
  assert.equal(
    view.container.querySelector('.ui-sparkline-line')?.getAttribute('d'),
    'M0.0 31.0 L60.0 31.0 L120.0 31.0',
  );
  await view.unmount();
});

test('loading, empty states and switches preserve labels and disabled interaction', async () => {
  const changes: boolean[] = [];
  const view = await render(
    <>
      <UI.Skeleton />
      <UI.Spinner />
      <UI.EmptyState icon="!" title="No assigned projects" />
      <UI.Badge>Active</UI.Badge>
      <UI.Toggle label="Notifications" checked={false} onChange={value => changes.push(value)} />
    </>,
  );
  assert.equal(view.container.querySelectorAll('[role="status"][aria-label="Loading"]').length, 2);
  assert.equal(view.container.querySelectorAll('.ui-skeleton i').length, 3);
  assert.equal(view.container.querySelector('.ui-empty p'), null);
  const toggle = view.container.querySelector('button')!;
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  await act(async () => toggle.click());
  assert.deepEqual(changes, [true]);
  await view.update(
    <>
      <UI.Skeleton lines={0} label="Loading people" />
      <UI.Spinner label="Saving" size={32} />
      <UI.EmptyState icon="!" title="No projects" action={<button>Assign project</button>}>
        Ask your manager to assign a project.
      </UI.EmptyState>
      <UI.Toggle label="Notifications" checked disabled onChange={value => changes.push(value)} />
    </>,
  );
  assert.equal(view.container.querySelectorAll('.ui-skeleton i').length, 0);
  assert.match(view.container.querySelector('.ui-empty p')!.textContent!, /manager/);
  const disabled = view.container.querySelector('[role="switch"]') as HTMLButtonElement;
  assert.equal(disabled.getAttribute('aria-checked'), 'true');
  await act(async () => disabled.click());
  assert.deepEqual(changes, [true]);
  await view.unmount();
});
