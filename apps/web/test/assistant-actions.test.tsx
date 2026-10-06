import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantNavigationTargets,
  canonicalAssistantDestination,
} from '../src/assistant-actions';
import { AssistantOutput } from '../src/AssistantOutput';
import { renderToStaticMarkup } from 'react-dom/server';
test('assistant destinations require an exact permitted page and cannot select another user or arbitrary URL', () => {
  const pages = [
    { label: 'My skills', url: '/my-skills' },
    { label: 'My profile', url: '/profile' },
  ];
  const result = assistantNavigationTargets(
    '[Admin](/access?view=people) [Skill](/my-skills) [Foreign](/my-skills?personId=other)',
    [{ url: '/' }, { url: 'https://evil.invalid' }],
    pages,
  );
  assert.deepEqual(result, pages);
  for (const url of [
    '/my-skills?personId=other',
    '/access?view=people&actorId=other',
    '/access?view=unknown',
    '//evil.invalid',
    '/my-skills#other',
    'javascript:alert(1)',
  ])
    assert.equal(canonicalAssistantDestination(url), undefined);
});
test('skill output offers an in-place review only when the authorized review handler is provided', () => {
  const artifact = {
    kind: 'skill_draft' as const,
    title: 'Skill draft',
    summary: 'Review',
    body: '',
    steps: [],
    questions: [],
  };
  const blocked = renderToStaticMarkup(<AssistantOutput artifact={artifact} />);
  assert.doesNotMatch(blocked, /Review skill draft|href=|Review in My Skills/);
  const allowed = renderToStaticMarkup(<AssistantOutput artifact={artifact} onReview={() => {}} />);
  assert.match(allowed, /Review skill draft/);
  assert.doesNotMatch(allowed, /href=|Review in My Skills/);
});

test('learning AI navigation requires the exact currently permitted page', () => {
  const learning = { label: 'Learning & development', url: '/learning' };
  assert.deepEqual(assistantNavigationTargets('[Learning](/learning)', [], [learning]), [learning]);
  assert.deepEqual(assistantNavigationTargets('[Learning](/learning)', [], []), []);
  assert.equal(canonicalAssistantDestination('/learning?personId=other'), undefined);
});

test('workflow drafts offer explicit review without automatic submission or navigation', () => {
  for (const kind of ['request_draft', 'incident_draft'] as const) {
    const artifact = {
      kind,
      title: 'Help with learning',
      summary: 'Review first',
      body: 'Please help with my plan.',
      steps: [],
      questions: [],
    };
    const blocked = renderToStaticMarkup(<AssistantOutput artifact={artifact} />);
    assert.doesNotMatch(blocked, /Review (request|incident) draft|href=|Submit/);
    const allowed = renderToStaticMarkup(
      <AssistantOutput artifact={artifact} onReviewRequest={() => {}} />,
    );
    assert.match(
      allowed,
      kind === 'incident_draft' ? /Review incident draft/ : /Review request draft/,
    );
    assert.match(allowed, /Not submitted|No records have been changed/);
    assert.doesNotMatch(allowed, /href=|Submit/);
  }
  const requests = { label: 'Requests', url: '/requests' };
  assert.deepEqual(assistantNavigationTargets('[Requests](/requests)', [], [requests]), [requests]);
  assert.deepEqual(assistantNavigationTargets('[Requests](/requests)', [], []), []);
  assert.equal(canonicalAssistantDestination('/requests?actorId=other'), undefined);
});
