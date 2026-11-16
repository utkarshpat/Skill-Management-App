import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { render, closeBrowser } from './support/browser';
import { component, change, click } from './support/interactions';

const { TeamInsightCharts } =
  component<typeof import('../src/TeamInsightCharts')>('TeamInsightCharts.tsx');
const people = [
  { id: 'aditi', name: 'Aditi Menon', employeeCode: '710902', reviewed: 3, pending: 0 },
  { id: 'rohan', name: 'Rohan Mehta', employeeCode: '710903', reviewed: 0, pending: 1 },
];
const analytics = {
  members: 2,
  reviewed: 3,
  pending: 1,
  coverage: ['SQL', 'Azure', 'Data Visualisation'].flatMap(skillName =>
    [1, 2, 3].map(rank => ({ skillName, rank, people: 1, memberIds: ['aditi'] })),
  ),
  levels: [{ rank: 3, count: 3, memberIds: ['aditi'] }],
  categories: [{ category: 'Data', count: 3 }],
};
after(closeBrowser);

test('radar and heatmap distinguish reviewed proficiency from a missing record, with person and skill navigation', async () => {
  const actions: string[] = [];
  const view = await render(
    <TeamInsightCharts
      analytics={analytics}
      people={people}
      minimumRank={3}
      skillFilter="SQL"
      onSkill={skill => actions.push('skill:' + skill)}
      onPerson={id => actions.push('person:' + id)}
    />,
  );
  try {
    assert.equal(view.container.querySelectorAll('.team-radar-point').length, 3);
    assert.match(
      view.container.querySelector('.team-radar title')!.textContent!,
      /Data Visualisation 3/,
    );
    assert.equal(
      view.container.querySelector('.team-gap-chart [aria-pressed="true"] span')!.textContent,
      'SQL',
    );
    await click('SQL', view.container.querySelector('.team-gap-chart')!);
    await click('Rohan Mehta, SQL: no reviewed record', view.container);
    await click('Aditi Menon, SQL: reviewed L3', view.container);
    const rosterButton = view.container.querySelector<HTMLButtonElement>(
      '[title="Open capability profile for Rohan Mehta"]',
    )!;
    await click(rosterButton.textContent!.trim(), view.container);
    assert.deepEqual(actions, ['skill:SQL', 'person:rohan', 'person:aditi', 'person:rohan']);
    assert.equal(view.container.querySelector('.team-ask-ai'), null);
  } finally {
    await view.unmount();
  }
});

test('eligible managers can hand off an app-specific demand prompt without saving', async () => {
  const prompts: string[] = [];
  const capture = (event: Event) =>
    prompts.push((event as CustomEvent<{ prompt: string }>).detail.prompt);
  window.addEventListener('assistant-context-request', capture);
  const view = await render(
    <TeamInsightCharts
      people={people}
      minimumRank={3}
      skillFilter=""
      canAskAi
      onSkill={() => {}}
      onPerson={() => {}}
    />,
  );
  try {
    const field = view.container.querySelector('textarea')!;
    await click('2 people at L3+ in Azure', view.container);
    assert.equal(field.value, '2 people at L3+ in Azure');
    await change(field, 'Need three people at L4 in SQL');
    await click('Compare with team', view.container);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Need three people at L4 in SQL/);
  } finally {
    window.removeEventListener('assistant-context-request', capture);
    await view.unmount();
  }
});
