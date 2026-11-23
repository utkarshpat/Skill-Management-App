import './support/phase-two';
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
  assert.doesNotMatch(blocked, /Save as draft|Review and submit|href=/);
  const allowed = renderToStaticMarkup(<AssistantOutput artifact={artifact} onReview={() => {}} />);
  assert.match(allowed, /Save as draft.*Review and submit/);
  assert.doesNotMatch(allowed, /href=|Edit draft|Copy draft/);
});

test('record links retain the exact destination only when its workspace page is available', () => {
  const page = { label: 'My skills', url: '/my-skills' };
  const url = '/my-skills?claim=a7b7353e-601e-4f8d-a42c-9b77982363de';
  assert.deepEqual(assistantNavigationTargets('', [{ url }], [page]), [{ ...page, url }]);
  assert.deepEqual(assistantNavigationTargets('', [{ url }], []), []);
  assert.equal(canonicalAssistantDestination(url + '&personId=other'), undefined);
  assert.equal(canonicalAssistantDestination('/my-skills?claim=invalid'), undefined);

  const approvals = { label: 'Approvals', url: '/skill-reviews' };
  const certApprovals = {
    label: 'Certification approvals',
    url: '/skill-reviews?type=certifications',
  };
  const certRecord =
    '/skill-reviews?type=certifications&certification=a7b7353e-601e-4f8d-a42c-9b77982363de';
  const claimRecord = '/skill-reviews?claim=a7b7353e-601e-4f8d-a42c-9b77982363de';
  assert.deepEqual(
    assistantNavigationTargets('', [{ url: certRecord }, { url: claimRecord }], [approvals]),
    [],
  );
  assert.deepEqual(
    assistantNavigationTargets(
      '',
      [{ url: certRecord }, { url: claimRecord }],
      [approvals, certApprovals],
    ),
    [
      { ...approvals, url: claimRecord },
      { ...certApprovals, url: certRecord },
    ],
  );
});

test('learning AI navigation requires the exact currently permitted page', () => {
  const learning = { label: 'Learning & development', url: '/learning' };
  assert.deepEqual(assistantNavigationTargets('[Learning](/learning)', [], [learning]), [learning]);
  assert.deepEqual(assistantNavigationTargets('[Learning](/learning)', [], []), []);
  assert.equal(canonicalAssistantDestination('/learning?personId=other'), undefined);
});

test('Analytics navigation requires its exact authorized page', () => {
  const analytics = { label: 'Analytics', url: '/business' };
  assert.deepEqual(assistantNavigationTargets('[Analytics](/business)', [], [analytics]), [
    analytics,
  ]);
  assert.deepEqual(assistantNavigationTargets('[Analytics](/business)', [], []), []);
  assert.equal(canonicalAssistantDestination('/business?scopeId=foreign'), undefined);
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
      kind === 'incident_draft' ? /Preview incident draft/ : /Preview request draft/,
    );
    assert.match(allowed, /Not submitted|No records have been changed/);
    assert.doesNotMatch(allowed, /href=|Submit/);
  }
  const requests = { label: 'Requests', url: '/requests' };
  assert.deepEqual(assistantNavigationTargets('[Requests](/requests)', [], [requests]), [requests]);
  assert.deepEqual(assistantNavigationTargets('[Requests](/requests)', [], []), []);
  assert.equal(canonicalAssistantDestination('/requests?actorId=other'), undefined);
});
