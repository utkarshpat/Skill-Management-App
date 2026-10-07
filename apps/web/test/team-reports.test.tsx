import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coverageRows,
  csvCell,
  fetchTeamReport,
  teamReportCsv,
  type TeamReportAnalytics,
} from '../src/team-reports';
const analytics: TeamReportAnalytics = {
  members: 30,
  reviewed: 14,
  pending: 8,
  coverage: [
    { skillName: 'Azure', rank: 1, people: 10, memberIds: ['private-member'] },
    { skillName: 'Azure', rank: 3, people: 4, memberIds: ['private-member'] },
    { skillName: 'Java', rank: 1, people: 3, memberIds: [] },
    { skillName: 'SQL', rank: 1, people: 30, memberIds: [] },
    { skillName: 'SQL', rank: 3, people: 30, memberIds: [] },
  ],
  levels: [{ rank: 3, count: 4, memberIds: ['private-member'] }],
  categories: [{ category: 'Cloud', count: 14 }],
};
const at = new Date('2026-10-05T09:00:00Z');
test('gaps include members with no claims, zero coverage at higher levels and exclude fully covered skills', () => {
  assert.deepEqual(coverageRows(analytics, 3), [
    { skillName: 'Java', holders: 0, missing: 30, percent: 0 },
    { skillName: 'Azure', holders: 4, missing: 26, percent: 13 },
    { skillName: 'SQL', holders: 30, missing: 0, percent: 100 },
  ]);
  const csv = teamReportCsv(analytics, 'gap', 3, 'Cloud', at);
  assert.match(csv, /"Java","L3","30","0","30","0"/);
  assert.match(csv, /"Azure","L3","30","4","26","13"/);
  assert.doesNotMatch(csv, /"SQL","L3"|private-member/);
  assert.match(csv, /not proof of a skill deficiency/);
  assert.match(csv, /"Scope filter","Filtered current direct reports"/);
  assert.doesNotMatch(csv, /"Cloud"/);
  assert.match(csv, /2026-10-05T09:00:00.000Z/);
});
test('coverage and team summary export all aggregate rows, never employee IDs or private claims', () => {
  assert.match(teamReportCsv(analytics, 'coverage', 3, '', at), /"SQL","L3","30","30","0","100"/);
  const summary = teamReportCsv(analytics, 'summary', 3, '', at);
  assert.match(summary, /"Active direct reports","30"/);
  assert.match(summary, /"Assigned pending reviews","8"/);
  assert.match(summary, /"Cloud","14"/);
  assert.match(summary, /"L3","4"/);
  assert.doesNotMatch(summary, /private-member|memberIds/);
});
test('CSV cells neutralize spreadsheet formulas and preserve quotes, commas, multiline and Unicode data', () => {
  for (const text of [
    '=SUM(A1)',
    '+formula',
    '-formula',
    '@formula',
    ' \t=HYPERLINK("bad")',
    '\r\n=bad',
  ])
    assert.ok(csvCell(text).startsWith('"\''));
  assert.equal(csvCell('Cloud, "Azure"\nक्षमता'), '"Cloud, ""Azure""\nक्षमता"');
  assert.equal(csvCell(30), '"30"');
});
test('download rechecks current scope and uses fresh full analytics rather than a page preview', async () => {
  const controller = new AbortController();
  const result = await fetchTeamReport(
    async (path, init) => {
      assert.equal(path, '/api/skill-reviews/team?page=1&search=Cloud+%26+Data');
      assert.equal(init?.signal, controller.signal);
      return Response.json({
        total: 30,
        people: [{ id: 'page-only' }],
        analytics: { ...analytics, members: 31 },
      });
    },
    'gap',
    3,
    'Cloud & Data',
    controller.signal,
  );
  assert.match(result.csv, /"Active members","31"/);
  assert.doesNotMatch(result.csv, /page-only|private-member/);
});
test('revoked, changed, incomplete and aborted responses cannot produce a report', async () => {
  for (const status of [401, 403, 409])
    await assert.rejects(
      fetchTeamReport(
        async () => Response.json({ error: { message: 'Access changed' } }, { status }),
        'summary',
        1,
        '',
        new AbortController().signal,
      ),
      /Access changed/,
    );
  await assert.rejects(
    fetchTeamReport(
      async () => Response.json({ total: 12, people: [] }),
      'summary',
      1,
      '',
      new AbortController().signal,
    ),
    /no partial-page report/,
  );
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    fetchTeamReport(async () => Response.json({ analytics }), 'summary', 1, '', c.signal),
  );
  assert.deepEqual(coverageRows({ ...analytics, members: 0, coverage: [] }, 3), []);
});
