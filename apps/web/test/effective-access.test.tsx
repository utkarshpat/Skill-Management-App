import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccessDecisionList } from '../src/AccessDecisionList';
test('access explanations show resolved scope, workflow checks and escaped source labels', () => {
  const html = renderToStaticMarkup(
    <AccessDecisionList
      summary={{
        actorId: 'own',
        revision: 7,
        summaryOnly: true,
        unsupportedAssignments: [{}],
        decisions: [
          {
            action: 'skill.verify',
            implemented: true,
            allowed: true,
            reasonCode: 'REPORTING_POLICY',
            resolvedScope: { kind: 'DIRECT_REPORTS' },
            constraints: ['CURRENT_DIRECT_MANAGER', 'NO_SELF_REVIEW'],
            sources: [
              {
                kind: 'RELATIONSHIP',
                label: '<script>source</script>',
                effect: 'ALLOW',
                scope: 'DIRECT_REPORTS',
              },
            ],
          },
        ],
      }}
    />,
  );
  assert.match(html, /Why\?/);
  assert.match(html, /direct reports/);
  assert.match(html, /current direct manager/);
  assert.match(html, /no self review/);
  assert.match(html, /preserved/);
  assert.match(html, /revision 7/);
  assert.doesNotMatch(html, /<script>/);
});

test('access scope explanations use accounts/clients without changing source records or decisions', () => {
  const summary = {
    actorId: 'own',
    revision: 3,
    summaryOnly: true,
    unsupportedAssignments: [],
    decisions: [
      {
        action: 'business.analytics.view',
        implemented: true,
        allowed: true,
        reasonCode: 'ALLOW',
        resolvedScope: { kind: 'DEPARTMENT' },
        constraints: ['CURRENT_PERMISSION'],
        sources: [
          {
            kind: 'RESPONSIBILITY',
            label: 'Example Client',
            effect: 'ALLOW',
            scope: 'DEPARTMENT:Client_ID',
          },
        ],
      },
    ],
  };
  const before = structuredClone(summary);
  const html = renderToStaticMarkup(<AccessDecisionList summary={summary} />);
  assert.match(html, /accounts\/clients/);
  assert.match(html, /Accounts\/Clients:Client_ID/);
  assert.match(html, /Allowed/);
  assert.match(html, /current permission/);
  assert.doesNotMatch(html, /DEPARTMENT/);
  assert.deepEqual(summary, before);
});
