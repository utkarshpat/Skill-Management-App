import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('FDD catalogue has all eleven skill areas, four-level rubrics and real sourced credential definitions', async () => {
  const data = JSON.parse(
    await readFile(
      new URL('../../../database/seeds/scmd-catalogue-v1.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(data.skills.length, 11);
  assert.equal(data.credentials.length, 11);
  for (const name of [
    'Oracle HCM',
    'Oracle Payroll',
    'Oracle Recruiting',
    'Oracle Learning',
    'Oracle Benefits',
    'Oracle OIC',
    'Oracle OCI',
    'Oracle APEX',
    'Oracle EPM',
    'AI & Automation',
    'SQL & Analytics',
  ])
    assert.ok(data.skills.some((s: any) => s.name === name));
  for (const skill of data.skills)
    assert.deepEqual(
      skill.levels.map((l: any) => l.name),
      ['Foundation', 'Autonomous', 'Experienced', 'Expert'],
    );
  const codes = new Set(data.skills.map((s: any) => s.code));
  for (const credential of data.credentials) {
    assert.ok(credential.name.length <= 100);
    assert.doesNotMatch(credential.name, /demo|sample|synthetic/i);
    assert.match(credential.description, /https:\/\/www.oracle.com\/education\/certification\//);
    assert.ok(credential.skillCodes.length);
    assert.equal(new Set(credential.skillCodes).size, credential.skillCodes.length);
    assert.ok(credential.skillCodes.every((code: string) => codes.has(code)));
  }
});
