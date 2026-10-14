// Development-only regression coverage; procedure DDL and all reads roll back.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
assert.equal(
  process.env.RUN_PEOPLE_SEARCH_SQL_TESTS,
  '1',
  'Explicit opt-in development rollback test.',
);
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
const migration = await fs.readFile(
  new URL('../../../database/migrations/082_conversational_people_search.sql', import.meta.url),
  'utf8',
);
await withDatabase(async pool => {
  const info = (
    await pool
      .request()
      .query("SELECT DB_NAME() AS name, OBJECT_ID('dbo.BusinessPeopleSearch') AS installed")
  ).recordset[0];
  assert.match(info.name, /-dev$/i);
  const choices = (
    await pool.request().input('account', sql.UniqueIdentifier, account).query(`
    SELECT TOP(1) person_id AS actor FROM dbo.BusinessResponsibility WHERE account_id=@account AND bundle='SYSTEM_ADMIN' AND effect='ALLOW' AND active=1;
    SELECT TOP(1) c.skill_id AS skill FROM dbo.SkillCatalogue c JOIN dbo.SkillDefinitionVersion v ON v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision WHERE c.account_id=@account AND c.status='PUBLISHED' AND v.framework_id='00000000-0000-4000-8000-000000000003';
    SELECT TOP(1) person_id AS employee FROM dbo.AccessPerson WHERE account_id=@account AND employee_code LIKE 'DEMO-%' AND active=1 AND NOT EXISTS(SELECT 1 FROM dbo.BusinessResponsibility b WHERE b.account_id=@account AND b.person_id=AccessPerson.person_id AND b.active=1);
  `)
  ).recordsets as sql.IRecordSet<any>[];
  const actor = choices[0][0].actor,
    skill = choices[1][0].skill,
    employee = choices[2][0].employee;
  const results = [];
  for (const scenario of [
    'allowed',
    'eligible',
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
        skills: [{ id: skill, minRank: 1 }],
        certifications: [],
        page: 1,
        headcount: 1,
        onlyEligible: scenario === 'eligible',
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
          .input('actor', sql.UniqueIdentifier, scenario === 'ordinary-employee' ? employee : actor)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(query))
          .query(
            `EXECUTE AS USER=N'skill_management_runtime'; BEGIN TRY EXEC dbo.BusinessPeopleSearch @account_id=@account,@actor_id=@actor,@payload=@payload; REVERT; END TRY BEGIN CATCH REVERT;THROW;END CATCH;`,
          );
        const data = JSON.parse(r.recordset[0].json);
        assert.ok(['allowed', 'eligible'].includes(scenario));
        assert.equal(data.required, 1);
        if (scenario === 'eligible') assert.equal(data.total, data.eligibleTotal);
        results.push({
          scenario,
          total: data.total,
          eligibleTotal: data.eligibleTotal,
          rows: data.rows?.length ?? 0,
        });
      } catch (error) {
        const e = error as { number: number; message: string };
        results.push({ scenario, error: e.number, message: e.message });
        if (['allowed', 'eligible'].includes(scenario)) throw e;
        assert.equal(e.number, 51003, scenario);
      }
    } finally {
      if (!rolledBack) await tx.rollback();
    }
  }
  const after = (
    await pool.request().query("SELECT OBJECT_ID('dbo.BusinessPeopleSearch') AS installed")
  ).recordset[0];
  assert.equal(after.installed, info.installed);
  console.log(JSON.stringify(results));
});
