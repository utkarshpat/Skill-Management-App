import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { zipSync } = require('fflate');
const root = fileURLToPath(new URL('../', import.meta.url));
const migrations = [
  [88, '088_organization_portfolio.sql'],
  [89, '089_portfolio_business_scopes.sql'],
  [90, '090_workflow_topic_recipients.sql'],
  [91, '091_search_people_administration.sql'],
  [92, '092_organization_manager_only_save.sql'],
];
const literal = value => "N'" + value.replaceAll("'", "''") + "'";
export function transactionMigration(
  source,
  version,
  { database = 'SS-SkillMgmtApp-SQL-Dev', server = 'ssskillmgmtappsqlsrvdev' } = {},
) {
  if (!migrations.some(([supported]) => supported === version))
    throw Error('Unsupported release migration.');
  const batches = source
    .replace(/^\uFEFF/, '')
    .split(/^GO\s*$/im)
    .filter(value => value.trim());
  return `-- Generated from the canonical migration. Use this wrapper for manual SSMS installation.
-- Target guard, per-version transaction and migration ledger are mandatory.
IF DB_NAME()<>${literal(database)} OR LOWER(CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))) NOT IN(${literal(server.toLowerCase())},${literal(server.toLowerCase() + '.database.windows.net')})
 THROW 51000,'Wrong SQL server/database. Review the release instructions before running.',1;
IF @@TRANCOUNT<>0 THROW 51000,'Use a fresh session without an existing transaction.',1;
IF OBJECT_ID(N'dbo.SchemaMigration',N'U') IS NULL THROW 51000,'Install the existing application baseline first.',1;
IF NOT EXISTS(SELECT 1 FROM dbo.SchemaMigration WHERE version=${version - 1}) THROW 51000,'The preceding migration is not recorded. Follow the ordered release instructions.',1;
SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
BEGIN TRY
 BEGIN TRANSACTION;
 IF EXISTS(SELECT 1 FROM dbo.SchemaMigration WITH(UPDLOCK,HOLDLOCK) WHERE version=${version}) BEGIN
  COMMIT;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  SELECT 'ALREADY_INSTALLED' AS outcome,${version} AS version;RETURN;
 END;
${batches.map(batch => ' EXEC sys.sp_executesql ' + literal(batch) + ';').join('\n')}
 INSERT dbo.SchemaMigration(version) VALUES(${version});
 COMMIT;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 SELECT 'INSTALLED' AS outcome,${version} AS version;
END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;
END CATCH;
`;
}
export function migrationPackage(sourceCommit) {
  const files = {};
  const add = (name, content) => (files[name] = new TextEncoder().encode(content));
  for (const [index, [version, file]] of migrations.entries()) {
    const source = readFileSync(resolve(root, 'database/migrations', file), 'utf8');
    add(`0${index + 1}_${file}`, transactionMigration(source, version));
    add('reference/' + file, source);
  }
  for (const path of [
    'database/operations/portfolio-mapping.template.sql',
    'database/operations/real-catalogue-data.template.sql',
  ])
    add('operations/' + path.split('/').at(-1), readFileSync(resolve(root, path), 'utf8'));
  add(
    '00_preflight.sql',
    `-- Read-only. Confirm the server/database and installed versions before maintenance.
SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) AS serverName,DB_NAME() AS databaseName;
SELECT version FROM dbo.SchemaMigration WHERE version>=87 ORDER BY version;
SELECT kind,COUNT(*) AS nodes FROM dbo.AccessOrgNode GROUP BY kind;
SELECT COUNT(*) AS clientsNeedingPortfolioMapping FROM dbo.AccessOrgNode c
LEFT JOIN dbo.AccessOrgNode f ON f.account_id=c.account_id AND f.node_id=c.parent_id AND f.kind='PORTFOLIO'
WHERE c.kind='DEPARTMENT' AND f.node_id IS NULL;
`,
  );
  add(
    'README.txt',
    `Audited integration schema delivery; source ${sourceCommit}

Company target: ssskillmgmtappsqlsrvdev / SS-SkillMgmtApp-SQL-Dev.
No company migration or data change has been performed by creating this package.

If 091 is already recorded, run 05_092_organization_manager_only_save.sql before
deploying the matching app ZIP. If 090 is recorded and the hierarchy mapping is
complete, run 04_091_search_people_administration.sql first.

1. Confirm a recoverable backup and stop application traffic/other writers.
2. Run 00_preflight.sql in the company database. Existing baseline through 087 is required.
3. Run 01_088_organization_portfolio.sql in SSMS. It records version 88 transactionally.
4. Use a PRIVATE copy of operations/portfolio-mapping.template.sql. Supply reviewed account,
   authorized administrator and every existing client/DU/Portfolio mapping. Do not invent
   default portfolios or manager links. Run execute=0, review revision/hash and the full map,
   then execute=1 with that exact receipt. Installing 088 alone does not map existing clients.
5. Run 02_089_portfolio_business_scopes.sql, 03_090_workflow_topic_recipients.sql,
   04_091_search_people_administration.sql, then 05_092_organization_manager_only_save.sql.
6. Deploy the matching application ZIP, restore traffic and verify SSO, scoped totals/export,
   request topic/recipient discovery, current assigned-manager review and People & Access search.

Use the root numbered wrappers for manual SSMS installation. They guard the target, preserve
the migration ledger, roll back failed versions and skip already recorded versions. The raw
reference/ files are supplied for review, not an alternate installation path. The normal
repository migration CLI also records versions, but applies all pending schema before the
separate reviewed mapping; traffic must remain stopped throughout.

The optional real-catalogue-data.template.sql is NOT a required schema migration. It defaults
to preview, requires a separate actor/revision/hash and issuer-source review, and must not be
executed as part of this schema rollout without reviewing the proposed data.

The code-first branch and deferred scheduler migration 065 are excluded. See the
coverage report for test results. Hosted acceptance requires separate verification.
`,
  );
  const manifest = {
    sourceCommit,
    expectedPreviousVersion: 87,
    versions: migrations.map(([v]) => v),
    mappingRequiredAfter: 88,
    files: Object.entries(files).map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })),
  };
  add('migration-manifest.json', JSON.stringify(manifest, null, 2));
  return {
    archive: zipSync(files, { level: 6, mtime: new Date('2020-01-01T00:00:00Z') }),
    manifest,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const result = migrationPackage(sourceCommit);
  mkdirSync(resolve(root, 'artifacts'), { recursive: true });
  const path = resolve(root, `artifacts/skills-migrations-${sourceCommit.slice(0, 12)}.zip`);
  writeFileSync(path, result.archive);
  console.log(
    JSON.stringify({
      path,
      sha256: createHash('sha256').update(result.archive).digest('hex'),
      sourceCommit,
    }),
  );
}
