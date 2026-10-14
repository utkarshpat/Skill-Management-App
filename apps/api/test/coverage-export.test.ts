import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageExport } from '../src/modules/business/coverage-export.js';
import { businessQuery, type BusinessDashboard } from '../src/modules/business/business.js';
test('full coverage exports include zero holders and uncatalogued credentials without personal rows', () => {
  for (const scopeId of [null, '', false, 0, [], {}])
    assert.throws(() => businessQuery({ scopeId }));
  const data = {
    coverageComplete: true,
    summary: { employees: 17 },
    coverage: Array.from({ length: 81 }, (_, i) => ({
      id: String(i),
      label: `Skill ${i}`,
      rank: 1,
      holders: i === 0 ? 2 : 0,
    })),
    credentialCoverage: [
      {
        id: 'credential',
        name: 'Current credential',
        issuer: 'Oracle',
        category: 'HCM',
        currentHolders: 2,
        reviewedHolders: 3,
        expiredHolders: 1,
      },
    ],
    uncataloguedCredentials: [
      { name: 'Legacy', issuer: 'Other', currentHolders: 1, reviewedHolders: 1, expiredHolders: 0 },
    ],
    rows: [{ employee: 'Private employee row', id: 'private' }],
    page: 2,
    total: 999,
  } as unknown as BusinessDashboard;
  const skills = coverageExport(data, 'skill-coverage');
  assert.equal(skills.data.rows.length, 81);
  assert.equal(skills.data.total, 81);
  assert.equal(skills.data.page, 1);
  assert.equal(skills.data.rows[80].reviewedHolders, 0);
  const certs = coverageExport(data, 'credential-headcount');
  assert.equal(certs.data.rows.length, 2);
  assert.equal(certs.data.rows[0].currentHolders, 2);
  assert.equal(certs.data.rows[1].catalogueStatus, 'Uncatalogued or retired');
  assert.ok(!JSON.stringify(certs).includes('Private employee row'));
  assert.throws(() => coverageExport(data, 'unexpected'));
  assert.throws(() => coverageExport(data, ['credential-headcount']));
  assert.throws(() => coverageExport({ ...data, coverageComplete: false }, 'skill-coverage'));
});
