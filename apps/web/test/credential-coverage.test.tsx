import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CredentialCoverage } from '../src/business/CredentialCoverage';
import type { BusinessDashboard } from '../src/business/business-model';
test('credential headcount shows independent validity, zero catalogue holders and unmapped records', () => {
  const data = {
    context: { canExport: true },
    coverageComplete: true,
    credentialCoverage: [
      {
        id: 'a',
        name: 'Catalogue credential',
        issuer: 'Oracle',
        currentHolders: 0,
        reviewedHolders: 1,
        expiredHolders: 1,
      },
    ],
    uncataloguedCredentials: [
      {
        name: 'Unlisted credential',
        issuer: 'Other',
        currentHolders: 2,
        reviewedHolders: 2,
        expiredHolders: 0,
      },
    ],
  } as unknown as BusinessDashboard;
  const html = renderToStaticMarkup(
    <CredentialCoverage data={data} pending={false} onExport={() => {}} />,
  );
  assert.match(html, /Current holders/);
  assert.match(html, /Expired holders/);
  assert.match(html, /Uncatalogued or retired/);
  assert.ok(html.indexOf('Unlisted credential') < html.indexOf('Catalogue credential'));
  const unavailable = renderToStaticMarkup(
    <CredentialCoverage
      data={{ ...data, coverageComplete: false }}
      pending={false}
      onExport={() => {}}
    />,
  );
  assert.match(unavailable, /not available/);
  assert.ok(!unavailable.includes('Catalogue credential'));
});
