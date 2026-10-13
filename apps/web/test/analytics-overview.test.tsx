import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalyticsOverview } from '../src/business/AnalyticsOverview';
import type { BusinessDashboard } from '../src/business/business-model';
const data: BusinessDashboard = {
  context: {
    revision: 1,
    asOf: '2026-10-14T00:00:00Z',
    canView: true,
    canExport: false,
    canManage: false,
    canAmend: false,
    personalBaseline: true,
    scopes: [],
  },
  summary: { employees: 4, certified: 1, skilled: 2, expired: 0, expiring: 0, pending: 0 },
  coverage: [
    { id: 'a', label: 'Small skill', rank: 1, holders: 1 },
    { id: 'b', label: 'Large skill', rank: 2, holders: 2 },
    { id: 'a', label: 'Small skill', rank: 5, holders: 99 },
  ],
  distribution: [],
  expiry: [],
  activity: [],
  rows: [
    {
      id: 'p',
      employee: 'QA Person',
      employeeCode: 'QA_CODE_01',
      reviewedSkills: 2,
      currentCertifications: 1,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
};
const render = (value = data, dataset = 'people') =>
  renderToStaticMarkup(
    <AnalyticsOverview
      data={value}
      pending={false}
      dataset={dataset}
      onChange={() => {}}
      onView={() => {}}
      onExport={() => {}}
      exporting={false}
      onOpenFiles={() => {}}
    />,
  );
test('overview preserves exact employee codes, ranks coverage by headcount and uses only four-level cells', () => {
  const html = render();
  assert.match(html, /QA_CODE_01/);
  assert.ok(html.indexOf('Large skill') < html.indexOf('Small skill'));
  assert.doesNotMatch(html, /2500%|99 reviewed holders/);
  assert.match(html, /25%/);
  assert.match(html, /50%/);
  assert.match(html, /No submission or review activity/);
  assert.doesNotMatch(html, /Coverage growth|Newly certified/);
  assert.doesNotMatch(html, /Currently certified employees|Employees with reviewed skills/);
});
test('overview file actions require server row eligibility and exports respect canonical capability', () => {
  const html = render(
    {
      ...data,
      rows: [
        {
          id: 'c',
          employee: 'QA',
          employeeCode: 'QA_01',
          name: 'Certificate',
          status: 'APPROVED',
          canViewFiles: true,
          submittedAt: '2026-10-13',
          submittedBy: 'QA',
          reviewedAt: null,
        },
      ],
    },
    'certifications',
  );
  assert.match(html, /View submitted files for Certificate/);
  assert.match(html, /Submitted on/);
  assert.match(html, /Reviewed on/);
  assert.match(html, /disabled=""[^>]*>CSV/);
  const denied = render(
    {
      ...data,
      rows: [
        { id: 'c', employee: 'QA', name: 'Certificate', status: 'REJECTED', canViewFiles: false },
      ],
    },
    'certifications',
  );
  assert.doesNotMatch(denied, /View submitted files for Certificate/);
});
