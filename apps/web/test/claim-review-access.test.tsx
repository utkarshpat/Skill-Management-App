import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClaimReviewAccess, type ClaimReviewDecision } from '../src/ClaimReviewAccess';
test('claim access explains historical state and fails closed without a current decision', () => {
  const decision: ClaimReviewDecision = {
    allowed: false,
    reasonCode: 'NOT_AWAITING_REVIEW',
    summaryOnly: false,
    resource: { type: 'SKILL_CLAIM', id: 'c', revision: 4 },
    resolvedScope: { kind: 'DIRECT_REPORTS', actorId: 'a' },
    constraints: [],
    sources: [
      {
        kind: 'RELATIONSHIP',
        label: '<script>unsafe</script>',
        effect: 'ALLOW',
        scope: 'DIRECT_REPORTS',
      },
    ],
  };
  const html = renderToStaticMarkup(<ClaimReviewAccess decision={decision} />);
  assert.match(html, /no longer awaiting a decision/);
  assert.match(html, /Why this access/);
  assert.match(html, /revision 4/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(renderToStaticMarkup(<ClaimReviewAccess />), /could not be resolved/);
  assert.match(
    renderToStaticMarkup(
      <ClaimReviewAccess
        decision={{ ...decision, allowed: true, reasonCode: 'REPORTING_POLICY' }}
      />,
    ),
    /current direct manager and assigned reviewer/,
  );
});
