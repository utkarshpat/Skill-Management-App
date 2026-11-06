import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { closeBrowser, render } from './support/browser';
import { click, component, fill } from './support/interactions';
import { commonLevels } from '../src/proficiency';
import type { SkillChoice, SkillDraft } from '../src/SkillClaimWizard';

const { SkillClaimWizard } =
  component<typeof import('../src/SkillClaimWizard')>('SkillClaimWizard.tsx');
const choices = [
  { id: 'sql', name: 'SQL', category: 'Databases', definitionRevision: 2, levels: commonLevels() },
  {
    id: 'js',
    name: 'JavaScript',
    category: 'Programming',
    definitionRevision: 3,
    levels: commonLevels(),
  },
];
const empty = {
  id: 'draft',
  revision: 0,
  skillId: '',
  definitionRevision: 0,
  rank: 0,
  description: '',
  experienceMonths: 0,
  lastUsedOn: '',
};
after(closeBrowser);

test('skill claim browses paged results, validates proficiency and experience, and saves the selected revision', async () => {
  const outcomes: { submit: boolean; draft: SkillDraft }[] = [];
  const optionsRequests: number[] = [];
  let closed = 0;
  function Journey() {
    const [page, setPage] = useState(0);
    const [resultsPage, setResultsPage] = useState(1);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('');
    const [selected, setSelected] = useState<SkillChoice>();
    const [draft, setDraft] = useState<SkillDraft>(empty);
    return (
      <SkillClaimWizard
        draft={draft}
        onDraft={setDraft}
        selected={selected}
        onSelect={skill => {
          setSelected(skill);
          setDraft({ ...empty, skillId: skill.id, definitionRevision: skill.definitionRevision });
        }}
        options={{
          page: resultsPage,
          pageSize: 1,
          total: 2,
          skills: [choices[resultsPage - 1]],
          categories: choices.map(skill => ({ name: skill.category, count: 1 })),
        }}
        loading={false}
        busy={false}
        error=""
        page={page}
        onPage={setPage}
        search={search}
        onSearch={setSearch}
        category={category}
        onCategory={setCategory}
        onResultsPage={next => {
          optionsRequests.push(next);
          setResultsPage(next);
        }}
        onSave={submit => outcomes.push({ submit, draft })}
        onClose={() => closed++}
      />
    );
  }
  const mounted = await render(<Journey />);
  try {
    await click('Next');
    assert.match(document.body.textContent ?? '', /Select a published skill to continue/);
    await click('Next skill results');
    assert.deepEqual(optionsRequests, [2]);
    await click('JavaScript');
    await click('Next');
    assert.match(document.body.textContent ?? '', /Save your draft to attach evidence/);
    await click('Next');
    assert.match(document.body.textContent ?? '', /Select your current proficiency/);
    const rank = document.querySelectorAll<HTMLInputElement>('input[name="proficiency"]')[2];
    await act(async () => rank.click());
    await fill('Experience (months)', '601');
    await click('Next');
    assert.match(document.body.textContent ?? '', /experience between 0 and 600 months/);
    await fill('Experience (months)', '24');
    await fill(
      'Describe your experience',
      'Maintained customer reporting dashboards and validated data filters.',
    );
    await click('Next');
    assert.match(document.body.textContent ?? '', /Review your skill information/);
    assert.match(document.body.textContent ?? '', /24 months/);
    assert.equal(outcomes.length, 0);
    await click('Save draft');
    await click('Submit for review');
    assert.deepEqual(
      outcomes.map(v => [
        v.submit,
        v.draft.skillId,
        v.draft.definitionRevision,
        v.draft.rank,
        v.draft.experienceMonths,
      ]),
      [
        [false, 'js', 3, 3, 24],
        [true, 'js', 3, 3, 24],
      ],
    );
    assert.equal(closed, 0);
  } finally {
    await mounted.unmount();
  }
});
