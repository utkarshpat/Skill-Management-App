// Development-only regression coverage; procedure DDL and all reads roll back.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
assert.equal(process.env.RUN_COVERAGE_SQL_TESTS, '1', 'Explicit opt-in development rollback test.');
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
const migration = await fs.readFile(
  new URL('../../../database/migrations/083_full_catalogue_coverage.sql', import.meta.url),
  'utf8',
);
await withDatabase(async pool => {
  const info = (
    await pool
      .request()
      .query("SELECT DB_NAME() AS name, OBJECT_ID('dbo.BusinessDashboard') AS installed")
  ).recordset[0];
  assert.match(info.name, /-dev$/i);
  const choices = (
    await pool.request().input('account', sql.UniqueIdentifier, account).query(`
    SELECT TOP(1) person_id AS actor FROM dbo.BusinessResponsibility WHERE account_id=@account AND bundle='SYSTEM_ADMIN' AND effect='ALLOW' AND active=1;
    SELECT TOP(1) c.skill_id AS skill FROM dbo.SkillCatalogue c JOIN dbo.SkillDefinitionVersion v ON v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision WHERE c.account_id=@account AND c.status='PUBLISHED' AND v.framework_id='00000000-0000-4000-8000-000000000003';
    SELECT TOP(1) person_id AS employee FROM dbo.AccessPerson WHERE account_id=@account AND employee_code LIKE 'DEMO-%' AND active=1 AND NOT EXISTS(SELECT 1 FROM dbo.BusinessResponsibility b WHERE b.account_id=@account AND b.person_id=AccessPerson.person_id AND b.active=1);
    SELECT TOP(1) person_id AS actor,id AS scope FROM dbo.BusinessResponsibility WHERE account_id=@account AND scope_kind='DELIVERY_UNIT' AND effect='ALLOW' AND dbo.BusinessResponsibilityUsable(@account,person_id,id)=1;
  `)
  ).recordsets as sql.IRecordSet<any>[];
  const actor = choices[0][0].actor,
    skill = choices[1][0].skill,
    employee = choices[2][0].employee;
  const results = [];
  for (const scenario of [
    'allowed',
    'allowed-du',
    'allowed-skill',
    'foreign-scope',
    'null-scope',
    'array-scope',
    'ordinary-employee',
    'foreign-account',
  ]) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let rolledBack = false;
    tx.on('rollback', () => (rolledBack = true));
    try {
      for (const batch of migration.split(/^GO\s*$/m))
        if (batch.trim()) await new sql.Request(tx).batch(batch);
      const query = {
        dataset: 'people',
        search: '',
        status: '',
        validity: '',
        category: '',
        issuer: '',
        minRank: 1,
        maxRank: 4,
        page: 1,
        sort: 'certified_desc',
        from: '',
        to: '',
        ...(scenario === 'allowed-skill' ? { skillId: skill } : {}),
        ...(scenario === 'allowed-du' ? { scopeId: choices[3][0].scope } : {}),
        ...(scenario === 'foreign-scope' ? { scopeId: crypto.randomUUID() } : {}),
        ...(scenario === 'null-scope' ? { scopeId: null } : {}),
        ...(scenario === 'array-scope' ? { scopeId: [] } : {}),
      };
      try {
        const r = await new sql.Request(tx)
          .input(
            'account',
            sql.UniqueIdentifier,
            scenario === 'foreign-account' ? crypto.randomUUID() : account,
          )
          .input(
            'actor',
            sql.UniqueIdentifier,
            scenario === 'ordinary-employee'
              ? employee
              : scenario === 'allowed-du'
                ? choices[3][0].actor
                : actor,
          )
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(query))
          .query(
            `EXECUTE AS USER=N'skill_management_runtime'; BEGIN TRY EXEC dbo.BusinessDashboard @account_id=@account,@actor_id=@actor,@payload=@payload; REVERT; END TRY BEGIN CATCH REVERT;THROW;END CATCH;`,
          );
        const data = JSON.parse(r.recordset[0].json);
        assert.ok(['allowed', 'allowed-du', 'allowed-skill'].includes(scenario));
        assert.equal(data.coverageComplete, true);
        assert.ok(data.rows.every((row:any) => 'certificationRank' in row));
        for (let i = 1; i < data.rows.length; i++) {
          assert.ok(data.rows[i - 1].currentCertifications >= data.rows[i].currentCertifications);
          if (
            data.rows[i].currentCertifications > 0 &&
            data.rows[i - 1].currentCertifications === data.rows[i].currentCertifications
          )
            assert.equal(data.rows[i - 1].certificationRank, data.rows[i].certificationRank);
        }
        if (scenario === 'allowed')
          await fs.writeFile(
            new URL('../../../.local/fdd-coverage-snapshot.json', import.meta.url),
            JSON.stringify({ ...data, rows: [] }),
          );

        const expected = (
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input(
              'actor',
              sql.UniqueIdentifier,
              scenario === 'allowed-du' ? choices[3][0].actor : actor,
            )
            .input(
              'scope',
              sql.UniqueIdentifier,
              scenario === 'allowed-du' ? choices[3][0].scope : null,
            )
            .input('skill', sql.UniqueIdentifier, scenario === 'allowed-skill' ? skill : null)
            .query(`
          SELECT COUNT(*) AS skills FROM dbo.SkillCatalogue c JOIN dbo.SkillDefinitionVersion v ON v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision WHERE c.account_id=@account AND c.status='PUBLISHED' AND (@skill IS NULL OR c.skill_id=@skill) AND v.framework_id='00000000-0000-4000-8000-000000000003';
          SELECT d.id,COUNT(DISTINCT CASE WHEN c.status='APPROVED' THEN c.person_id END) AS reviewedHolders,COUNT(DISTINCT CASE WHEN c.status='APPROVED' AND c.issue_date<=CONVERT(date,SYSUTCDATETIME()) AND (c.expiry_date IS NULL OR c.expiry_date>=CONVERT(date,SYSUTCDATETIME())) THEN c.person_id END) AS currentHolders,COUNT(DISTINCT CASE WHEN c.status='APPROVED' AND c.expiry_date<CONVERT(date,SYSUTCDATETIME()) THEN c.person_id END) AS expiredHolders
          FROM dbo.CredentialDefinition d JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id AND p.active=1
          LEFT JOIN dbo.CurrentCertificationRecord c ON c.account_id=d.account_id AND dbo.CertificationIdentityText(c.certification_name)=dbo.CertificationIdentityText(d.name) AND dbo.CertificationIdentityText(c.provider)=dbo.CertificationIdentityText(p.name) AND c.person_id IN(SELECT person_id FROM dbo.BusinessVisiblePeople(@account,@actor,@scope)) AND (@skill IS NULL OR EXISTS(SELECT 1 FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft supporting ON supporting.account_id=l.account_id AND supporting.claim_id=l.claim_id WHERE l.account_id=@account AND l.certification_id=c.id AND l.published=1 AND supporting.skill_id=@skill AND supporting.status<>'DRAFT'))
          WHERE d.account_id=@account AND d.active=1 GROUP BY d.id;
        `)
        ).recordsets as sql.IRecordSet<any>[];
        assert.equal(data.coverage.length, expected[0][0].skills * 4);
        assert.ok(data.coverage.some((c: any) => c.holders === 0));
        for (const c of data.credentialCoverage) {
          const row = expected[1].find(r => r.id.toLowerCase() === c.id.toLowerCase());
          assert.ok(row);
          for (const key of ['reviewedHolders', 'currentHolders', 'expiredHolders'])
            assert.equal(c[key], row[key]);
        }
        results.push({
          scenario,
          skills: expected[0][0].skills,
          credentials: data.credentialCoverage.length,
          zeroCells: data.coverage.filter((c: any) => c.holders === 0).length,
        });
      } catch (error) {
        const e = error as { number: number; message: string };
        results.push({ scenario, error: e.number, message: e.message });
        if (['allowed', 'allowed-du', 'allowed-skill'].includes(scenario)) throw e;
        assert.equal(e.number, 51003, scenario);
      }
    } finally {
      if (!rolledBack) await tx.rollback();
    }
  }
  const after = (
    await pool.request().query("SELECT OBJECT_ID('dbo.BusinessDashboard') AS installed")
  ).recordset[0];
  assert.equal(after.installed, info.installed);
  console.log(JSON.stringify(results));
});
