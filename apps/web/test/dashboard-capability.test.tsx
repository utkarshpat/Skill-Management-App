import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { DashboardCapability, type DashboardCapabilityData } from '../src/DashboardCapability';
import { SkillRadar, type TopReviewedSkill } from '../src/SkillRadar';
const data: DashboardCapabilityData = {
  total: 85,
  verified: 40,
  pending: 25,
  draft: 15,
  changesRequested: 3,
  rejected: 2,
  canClaim: true,
  recentClaims: [
    {
      id: 'one',
      skillName: 'Azure',
      category: 'Cloud',
      rank: 3,
      levelName: 'Practitioner',
      status: 'APPROVED',
      updatedAt: '2026-10-04T10:00:00Z',
      href: '/my-skills?claim=one',
    },
  ],
};
const render = (value = data) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <DashboardCapability data={value} />
    </MemoryRouter>,
  );
test('capability states target separate full lists and recent preview links to exact claim', () => {
  const html = render();
  for (const status of ['APPROVED', 'SUBMITTED', 'DRAFT', 'CHANGES_REQUESTED', 'REJECTED'])
    assert.match(html, new RegExp('status=' + status));
  assert.match(html, /85/);
  assert.match(html, /claim=one/);
  assert.match(html, /Level 3/);
  assert.match(html, /3 claims need changes/);
  assert.match(html, /2 not approved/);
  assert.doesNotMatch(html, /progressbar|capability percentage/);
});
const topSkills: TopReviewedSkill[] = Array.from({ length: 6 }, (_, i) => ({
  id: 'reviewed-' + i,
  skillName: i === 0 ? 'Azure' : 'Reviewed skill ' + i,
  category: 'Cloud',
  rank: 5 - (i % 4),
  levelName: 'Saved proficiency ' + i,
  maxRank: i === 0 ? 8 : 5,
}));
test('top skill snapshot renders exact saved levels, accessible radar and own claim links', () => {
  const html = render({ ...data, topSkills });
  assert.match(html, /Spider-web chart/);
  assert.match(html, /S1: Azure, level 5 of 8/);
  assert.match(html, /L5 \/ 8/);
  assert.match(html, /Saved proficiency 0/);
  assert.match(html, /Showing 6 of 40 reviewed skills/);
  assert.match(html, /claim=reviewed-5/);
  assert.doesNotMatch(html, /NaN|Infinity|percentage score:|average proficiency/i);
  assert.equal((html.match(/class="skill-radar-ring"/g) ?? []).length, 14);
});
test('radar never invents axes for one/two skills or treats missing data as no reviewed skills', () => {
  for (const count of [1, 2]) {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SkillRadar skills={topSkills.slice(0, count)} reviewed={count} />
      </MemoryRouter>,
    );
    assert.match(html, /unlock the spider-web view/);
    assert.doesNotMatch(html, /<svg/);
  }
  assert.match(render({ ...data, topSkills: [] }), /No manager-reviewed skills yet/);
  assert.match(render(data), /snapshot is unavailable/);
  assert.doesNotMatch(render(data), /No manager-reviewed skills yet/);
  const historical = render({ ...data, topSkills: topSkills.map(s => ({ ...s, maxRank: null })) });
  assert.match(historical, /no chart scale has been assumed/);
  assert.match(historical, /Scale unavailable/);
  assert.doesNotMatch(historical, /class="skill-radar-area"|NaN|Infinity/);
});
test('capability empty and read-only states hide unsupported editing actions', () => {
  const empty = {
    ...data,
    total: 0,
    verified: 0,
    pending: 0,
    draft: 0,
    changesRequested: 0,
    rejected: 0,
    recentClaims: [],
  };
  assert.match(render(empty), /Add your first skill/);
  const readonly = render({ ...empty, canClaim: false });
  assert.match(readonly, /Build your capability profile/);
  assert.doesNotMatch(readonly, /action=add|Recently updated|View feedback/);
});
