import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { businessReportHtml } from '../src/business/business-report-document';
import type { BusinessDashboard } from '../src/business/business-model';

test('full catalogue snapshots include zero-holder skills without inventing level zero proficiency', () => {
  const data = {
    context: { asOf: '2026-10-14', revision: 1 },
    summary: { employees: 2 },
    coverageComplete: true,
    coverage: [{ id: 'zero', label: 'Unclaimed skill', rank: 1, holders: 0 }],
    categories: [],
    expiry: [],
    activity: [],
    distribution: [],
    rows: [],
    credentialCoverage: [
      {
        id: 'a',
        name: 'Credential <safe>',
        issuer: 'Oracle',
        currentHolders: 1,
        reviewedHolders: 2,
        expiredHolders: 1,
      },
    ],
  } as unknown as BusinessDashboard;
  const html = businessReportHtml(data, 'Organization');
  assert.match(html, /full published four-level catalogue/);
  assert.match(html, /Unclaimed skill/);
  assert.match(html, /No reviewed proficiency/);
  assert.ok(!html.includes('L0 · Foundation'));
  assert.match(html, /Credential &lt;safe&gt;/);
});

test('executive report scripts run and CSV preserves visible sort, real rows and formula safety', async () => {
  const data = {
    context: { asOf: '2026-10-14', revision: 1 },
    summary: { employees: 10, certified: 2, skilled: 4, pending: 1 },
    coverage: [
      { id: 'a', label: 'Zulu', rank: 2, holders: 3 },
      { id: 'b', label: ' =Formula', rank: 4, holders: 1 },
    ],
    distribution: [{ label: 'Oracle', value: 99 }],
    categories: [],
    expiry: [],
    activity: [],
    comparisons: [],
    rows: [],
  } as unknown as BusinessDashboard;
  const html = businessReportHtml(
    data,
    '</script><unsafe>',
    new Date('2026-10-14'),
    'status=APPROVED',
  );
  assert.ok(!html.includes('id="hubCategory"'), 'unsupported category filter must not be offered');
  assert.match(html, /status=APPROVED/);
  assert.match(html, /returned top skill aggregates/);
  assert.ok(!html.includes('</script><unsafe>'));
  const nodes = new Map<string, { value: string; innerHTML: string; innerText: string }>();
  for (const id of [
    'hubSearch',
    'hubLevel',
    'hubCoverage',
    'hubSort',
    'skillsTableBody',
    'tableStats',
    'activeFilterTags',
    'radarMetricSelect',
    'radarMount',
  ])
    nodes.set(id, {
      value: id === 'hubSort' ? 'name_asc' : id === 'hubSearch' ? '' : 'all',
      innerHTML: '',
      innerText: '',
    });
  let exported: Blob | undefined;
  const sandbox = {
    document: {
      getElementById: (id: string) => nodes.get(id),
      querySelectorAll: () => [],
      createElement: () => ({ click() {}, remove() {} }),
      body: { append() {} },
    },
    URL: {
      createObjectURL: (blob: Blob) => {
        exported = blob;
        return 'blob:test';
      },
      revokeObjectURL() {},
    },
    Blob,
    setTimeout() {},
  };
  vm.createContext(sandbox);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  vm.runInContext(script, sandbox);
  vm.runInContext('exportFilteredCsv()', sandbox);
  const csv = await exported!.text();
  assert.equal(csv.split('\r\n').length, 3);
  assert.ok(csv.indexOf("' =Formula") < csv.indexOf('Zulu'));
  nodes.get('hubLevel')!.value = '4';
  vm.runInContext('exportFilteredCsv()', sandbox);
  assert.ok(!(await exported!.text()).includes('Zulu'));
  assert.equal(vm.runInContext('csvEscape(" =SUM(1)")', sandbox), '"\' =SUM(1)"');
});
