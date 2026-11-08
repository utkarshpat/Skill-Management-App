import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse, deferred } from './support/browser';
import { component, refreshDevelopmentLogin, click, change, fill } from './support/interactions';
const { TeamCapability } = component<typeof import('../src/TeamCapability')>('TeamCapability.tsx');
const { EmployeeCapability } =
  component<typeof import('../src/EmployeeCapability')>('EmployeeCapability.tsx');
const { TeamReports } = component<typeof import('../src/TeamReports')>('TeamReports.tsx');
const people = [
  { id: 'aditi', name: 'Aditi Menon', employeeCode: '710902', reviewed: 1, pending: 1 },
  { id: 'rohan', name: 'Rohan Mehta', employeeCode: '710903', reviewed: 0, pending: 0 },
];
const skills: any[] = [
  {
    personId: 'aditi',
    skillName: 'SQL',
    category: 'Data',
    rank: 3,
    levelName: 'Practitioner',
    status: 'APPROVED',
  },
  {
    personId: 'aditi',
    skillName: 'Azure',
    category: 'Cloud',
    rank: 2,
    levelName: 'Foundation',
    status: 'SUBMITTED',
  },
];
const analytics = {
  members: 2,
  reviewed: 1,
  pending: 1,
  coverage: [
    { skillName: 'SQL', rank: 1, people: 1, memberIds: ['aditi'] },
    { skillName: 'SQL', rank: 3, people: 1, memberIds: ['aditi'] },
  ],
  levels: [{ rank: 3, count: 1, memberIds: ['aditi'] }],
  categories: [{ category: 'Data', count: 1 }],
};
const claim: any = {
  id: 'claim-sql',
  personId: 'aditi',
  skillId: 'sql',
  skillName: 'SQL',
  category: 'Data',
  rank: 3,
  levelName: 'Practitioner',
  status: 'APPROVED',
  updatedAt: '2026-11-06T09:00:00Z',
  revision: 2,
};
let view: Awaited<ReturnType<typeof render>> | undefined;
let respond: (url: string, init?: RequestInit) => Promise<Response>;
let requests: string[] = [];
beforeEach(async () => {
  requests = [];
  mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    requests.push(url);
    return respond(url, init);
  });
  respond = async url => {
    if (url.startsWith('/api/skill-reviews/team')) {
      const q = new URL(url, 'http://localhost');
      const selected = q.searchParams.get('person');
      return Response.json({
        people: selected ? [people[0]] : people,
        skills,
        total: selected ? 1 : 3,
        pageSize: 2,
        analytics,
      });
    }
    if (url.startsWith('/api/skill-reviews/'))
      return Response.json({
        claim: { ...claim, personId: 'foreign' },
        reviewAccess: { allowed: false },
      });
    if (url.startsWith('/api/skill-reviews?'))
      return Response.json({ claims: [claim], total: 1, pageSize: 25, canReadHistory: true });
    if (url.startsWith('/api/capability-submissions')) return Response.json({ records: [] });
    throw Error('Unexpected ' + url);
  };
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);
test('team charts narrow current direct reports, search and paging requery and selected employee remains review-bound', async () => {
  const reviews: string[] = [];
  view = await render(
    <TeamCapability
      onReviews={p => reviews.push(p)}
      supportingContent={<p>Current manager scope</p>}
    />,
  );
  await settle();
  assert.match(document.body.textContent ?? '', /Rohan Mehta/);
  const reviewed = document.querySelector<HTMLButtonElement>('.team-stat.teal')!;
  await act(async () => reviewed.click());
  await settle();
  assert.doesNotMatch(
    document.querySelector('#team-member-results')?.textContent ?? '',
    /Rohan Mehta/,
  );
  await click('Clear chart filters');
  await change(
    document.querySelector<HTMLSelectElement>('select[aria-label="Minimum reviewed proficiency"]')!,
    '3',
  );
  await click('SQL');
  assert.doesNotMatch(
    document.querySelector('#team-member-results')?.textContent ?? '',
    /Rohan Mehta/,
  );
  await click('Clear chart filters');
  const insights = [...document.querySelectorAll('button')].find(b =>
    /insights/i.test(b.textContent ?? ''),
  )!;
  await act(async () => insights.click());
  await settle();
  assert.ok(
    document.querySelector('.team-level-bars') ||
      document.body.textContent?.includes('Reviewed categories'),
  );
  await click('Review claims');
  assert.deepEqual(reviews, ['aditi']);
  await click('Next');
  assert.match(requests.at(-1) ?? '', /page=2/);
  await click('Previous');
  await change(
    document.querySelector<HTMLInputElement>('input[aria-label="Search direct reports"]')!,
    'Aditi',
  );
  await click('Search');
  assert.match(requests.at(-1) ?? '', /search=Aditi/);
  await click('Clear');
  await click('View capability');
  assert.match(document.body.textContent ?? '', /Employee capability/);
  await click('Open pending reviews');
  assert.equal(reviews.at(-1), 'aditi');
  await click('All direct reports');
  assert.match(document.body.textContent ?? '', /Current manager scope/);
});
test('employee capability filters source-bound skill records, guards foreign details and retries revoked history', async () => {
  let reviews = 0;
  view = await render(
    <EmployeeCapability
      person={people[0]}
      skills={skills}
      onReviews={() => reviews++}
      onSaved={() => {}}
    />,
  );
  await settle();
  await click('Skill list');
  await click('View evidence & history');
  assert.match(document.body.textContent ?? '', /unavailable in this employee profile/);
  await click('Review records');
  assert.match(document.body.textContent ?? '', /SQL/);
  const status = document.querySelector<HTMLSelectElement>(
    'select[aria-label="Employee skill status"]',
  )!;
  await change(status, 'REJECTED');
  assert.match(document.body.textContent ?? '', /No matching skills/);
  await click('Clear');
  await click('Skills');
  await click('Skill cards');
  await change(
    document.querySelector<HTMLInputElement>('input[aria-label="Search employee skills"]')!,
    'Azure',
  );
  assert.match(document.body.textContent ?? '', /Azure/);
  await click('Open pending reviews');
  assert.equal(reviews, 1);
});
test('team request errors are explicit and retry restores current summaries without stale people', async () => {
  respond = async () =>
    Response.json({ error: { message: 'Current reporting access changed' } }, { status: 403 });
  view = await render(<TeamCapability onReviews={() => {}} />);
  await settle();
  assert.match(document.body.textContent ?? '', /Current reporting access changed/);
  assert.doesNotMatch(document.body.textContent ?? '', /Aditi Menon/);
  respond = async () => Response.json({ people: [], skills: [], total: 0, pageSize: 25 });
  await click('Retry');
  assert.match(document.body.textContent ?? '', /No active direct reports/);
});
test('team report menus recheck aggregate scope for each format and notify on revoked exports', async () => {
  const downloads: string[] = [];
  let revoked = 0;
  mock.method(URL, 'createObjectURL', () => 'blob:aggregate-report');
  mock.method(URL, 'revokeObjectURL', () => {});
  mock.method(window.HTMLAnchorElement.prototype, 'click', function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  view = await render(
    <TeamReports analytics={analytics} query="Data" onAccessChanged={() => revoked++} />,
  );
  await click('Report');
  await fill('CSV minimum level', '3');
  await click('Interactive report');
  assert.match(downloads[0], /\.html$/);
  await click('Report');
  await click('Reviewed skill coverage');
  assert.ok(downloads.some(n => n.endsWith('.csv')));
  respond = async () =>
    Response.json({ error: { message: 'Reporting access revoked' } }, { status: 403 });
  await click('Report');
  await click('Team summary');
  assert.match(document.body.textContent ?? '', /Reporting access revoked/);
  assert.equal(revoked, 1);
});
