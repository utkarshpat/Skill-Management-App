import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../../../database/operations/real-catalogue-data.template.sql', import.meta.url),
  'utf8',
);
interface CatalogueData {
  providers: {
    key: string;
    name: string;
    sourceReview: 'SOURCE_READ' | 'OPERATOR_RECHECK_REQUIRED';
    sources: string[];
  }[];
  skills: { name: string; category: string; description: string }[];
  certifications: {
    provider: string;
    name: string;
    category: string;
    description: string;
    skills: string[];
  }[];
}
const match = sql.match(/DECLARE @seed nvarchar\(max\)=N'([\s\S]*?)';/);
assert.ok(match, 'Self-contained SQL must contain its reviewed catalogue dataset');
const seed: CatalogueData = JSON.parse(match[1].replaceAll("''", "'"));

test('real catalogue content supplies pagination, categories, providers and optional mappings', () => {
  assert.equal(seed.providers.length, 13);
  assert.equal(seed.skills.length, 52);
  assert.equal(seed.certifications.length, 52);
  assert.equal(new Set(seed.skills.map(s => s.category)).size, 18);
  assert.equal(new Set(seed.certifications.map(c => c.category)).size, 17);
  assert.equal(new Set([...seed.skills, ...seed.certifications].map(e => e.category)).size, 19);
  assert.equal(
    seed.certifications.reduce((count, c) => count + c.skills.length, 0),
    98,
  );
  const normalize = (s: string) => s.trim().toLowerCase();
  for (const names of [
    seed.providers.map(p => p.key),
    seed.providers.map(p => p.name),
    seed.skills.map(s => s.name),
    seed.certifications.map(c => `${c.provider}:${c.name}`),
  ]) {
    assert.equal(new Set(names.map(normalize)).size, names.length);
  }
  const providers = new Set(seed.providers.map(p => p.key));
  const skills = new Set(seed.skills.map(s => s.name));
  const related = new Map<string, number>();
  for (const provider of seed.providers) {
    assert.ok(provider.name.length <= 100);
    assert.ok(provider.sources.length > 0);
    assert.ok(['SOURCE_READ', 'OPERATOR_RECHECK_REQUIRED'].includes(provider.sourceReview));
    assert.ok(seed.certifications.some(c => c.provider === provider.key));
    for (const source of provider.sources) {
      assert.equal(new URL(source).protocol, 'https:');
    }
  }
  for (const entry of [...seed.skills, ...seed.certifications]) {
    assert.ok(entry.name.length > 0 && entry.name.length <= 100);
    assert.ok(entry.category.length > 0 && entry.category.length <= 80);
    assert.ok(entry.description.length > 0 && entry.description.length <= 2000);
  }
  for (const certification of seed.certifications) {
    assert.ok(providers.has(certification.provider));
    assert.ok(certification.skills.length <= 20);
    assert.equal(new Set(certification.skills).size, certification.skills.length);
    for (const name of certification.skills) {
      assert.ok(skills.has(name), name);
      related.set(name, (related.get(name) ?? 0) + 1);
    }
  }
  assert.ok([...related.values()].every(count => count <= 20));
  assert.ok(seed.certifications.some(c => c.skills.length === 0));
  assert.ok(seed.certifications.some(c => c.skills.length > 1));
  assert.ok(seed.skills.some(s => !related.has(s.name)));
});

test('catalogue operation defaults to reviewed preview and canonical audited additive writes', () => {
  assert.match(sql, /DECLARE @execute bit=0;/);
  assert.match(sql, /DECLARE @actor uniqueidentifier=NULL;/);
  assert.match(sql, /DECLARE @issuer_sources_reviewed bit=0;/);
  assert.match(sql, /IF ISNULL\(@issuer_sources_reviewed,0\)<>1/);
  assert.match(sql, /ISNULL\(DB_NAME\(\),N''\)<>N'SS-SkillMgmtApp-SQL-Dev'/);
  assert.match(
    sql,
    /ISNULL\(LOWER\(CONVERT\(nvarchar\(128\),SERVERPROPERTY\('ServerName'\)\)\),N''\) NOT IN/,
  );
  assert.match(sql, /SERVERPROPERTY\('ServerName'\)/);
  assert.match(sql, /@@TRANCOUNT<>0/);
  assert.match(sql, /WITH\(UPDLOCK,HOLDLOCK\)/);
  assert.match(sql, /HASHBYTES\('SHA2_256',@receipt\)/);
  assert.match(sql, /@expected_revision<>@revision/);
  assert.match(sql, /TRY_CONVERT\(varbinary\(32\),@expected_plan,2\)<>@plan_hash/);
  assert.match(sql, /JSON_QUERY\(@seed\) AS source,JSON_QUERY\(@snapshot\) AS state/);
  assert.match(sql, /EXEC dbo\.SaveSkillCatalogue/);
  assert.match(sql, /EXEC dbo\.SaveCatalogueMaster/);
  assert.match(sql, /@kind AS type,CAST\(1 AS bit\) AS isNew/);
  assert.match(sql, /IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;\s*THROW;/);
  for (const permission of [
    'profile.view',
    'permissions.manage',
    'users.manage',
    'audit.view',
    'skill.catalogue.manage',
    'request.approve',
  ]) {
    assert.ok(sql.includes(`'${permission}'`), permission);
  }
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE)\s+(?:INTO\s+|FROM\s+)?dbo\./i);
  assert.doesNotMatch(
    sql,
    /\b(?:TRUNCATE|DROP|ALTER|GRANT|REVOKE)\s+(?:TABLE|PROCEDURE|FUNCTION|EXECUTE)/i,
  );
});

test('catalogue SQL explicitly reconciles stored, table-variable and JSON name collations', () => {
  const masterComparisons = [
    ...sql.matchAll(
      /LOWER\(LTRIM\(RTRIM\((?:c\.display_name|d\.name)\)\)\)(?: COLLATE \w+)?=LOWER\((?:s|p|c)\.name\)(?: COLLATE \w+)?/g,
    ),
  ].map(match => match[0]);
  assert.equal(masterComparisons.length, 8);
  for (const comparison of masterComparisons) {
    assert.match(comparison, / COLLATE DATABASE_DEFAULT=LOWER\(/);
    assert.ok(comparison.endsWith(' COLLATE DATABASE_DEFAULT'));
  }
  const mappingComparisons = [
    ...sql.matchAll(
      /(?:s\.name(?: COLLATE \w+)?=j\.value(?: COLLATE \w+)?|j\.value(?: COLLATE \w+)?=s\.name(?: COLLATE \w+)?)/g,
    ),
  ].map(match => match[0]);
  assert.equal(mappingComparisons.length, 4);
  for (const comparison of mappingComparisons) {
    assert.equal(comparison.match(/COLLATE DATABASE_DEFAULT/g)?.length, 2);
  }
  assert.match(
    sql,
    /l\.display_name COLLATE Latin1_General_100_BIN2=e\.name COLLATE Latin1_General_100_BIN2/,
  );
  assert.doesNotMatch(sql, /\bALTER\s+(?:DATABASE|TABLE)\b/i);
});
