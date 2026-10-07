import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(
  new URL('../../../database/migrations/044_standard_proficiency.sql', import.meta.url),
  'utf8',
);

test('standard framework migration preserves old labels and enforces the same model in SQL writes', () => {
  for (const [index, name] of [
    'Awareness',
    'Foundation',
    'Practitioner',
    'Advanced',
    'Expert',
  ].entries())
    assert.ok(source.includes(`00000000-0000-4000-8000-000000000002',${index + 1},N'${name}'`));
  assert.match(source, /\(SELECT COUNT\(\*\) FROM @levels\)<>5/);
  assert.match(source, /Latin1_General_100_BIN2/);
  assert.match(source, /INSERT dbo\.SkillDefinitionVersion/);
  assert.match(source, /INSERT dbo\.SkillVersionCriterion/);
  assert.doesNotMatch(
    source,
    /(UPDATE|DELETE(?: FROM)?) dbo\.(ProficiencyLevel|SkillDefinitionVersion|SkillVersionCriterion|SkillClaimDraft|LearningPlan|LearningRecommendation)/,
  );
  for (const policy of [
    'IS_MEMBER',
    'AccessRuntimeAccount',
    'UPDLOCK,HOLDLOCK',
    'skill.catalogue.manage',
    '@revision<>@expected_revision',
    'Business codes are immutable.',
    'INSERT dbo.AccessAudit',
    'ROLLBACK TRANSACTION',
  ])
    assert.ok(source.includes(policy));
});
test('operator alignment is opt-in, permission checked, migration gated and transactionally audited', async () => {
  const cli = await readFile(new URL('../src/catalogue-seed-cli.ts', import.meta.url), 'utf8');
  assert.match(cli, /process\.argv\.includes\('--align-existing'\)/);
  assert.match(cli, /process\.argv\.includes\('--apply'\)/);
  assert.match(cli, /version=44/);
  assert.match(cli, /alignmentPlan\(existing\)/);
  assert.match(cli, /execute\('dbo.SaveSkillCatalogue'\)/);
  assert.ok(cli.indexOf('version=44') < cli.indexOf("execute('dbo.SaveSkillCatalogue')"));
});
