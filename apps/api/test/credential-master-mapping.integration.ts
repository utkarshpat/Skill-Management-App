// Explicit opt-in development rollback test; no lasting catalogue or employee changes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
assert.equal(process.env.RUN_MASTER_MAPPING_SQL_TESTS, '1');
const actor = process.env.MASTER_MAPPING_OPERATOR_ID!;
assert.ok(actor);
const account = process.env.ACCESS_ACCOUNT_ID!;
const migration = await readFile(
  new URL('../../../database/migrations/078_credential_skill_master_mappings.sql', import.meta.url),
  'utf8',
);
await withDatabase(async pool => {
  const info = (
    await pool
      .request()
      .query('SELECT DB_NAME() AS name,(SELECT MAX(version) FROM dbo.SchemaMigration) AS version')
  ).recordset[0];
  assert.match(info.name, /(?:^|-)dev$/i);
  assert.ok(info.version >= 77);
  for (const scenario of ['happy', 'update', 'invalid-skill', 'denied']) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      if (info.version < 78)
        for (const batch of migration.split(/^GO\s*$/m))
          if (batch.trim()) await new sql.Request(tx).batch(batch);
      const query = (text: string) =>
        new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .input('actor', sql.UniqueIdentifier, actor)
          .query(text);
      const skillIds = (
        await query(
          "SELECT TOP(2) skill_id AS id FROM dbo.SkillCatalogue WHERE account_id=@a AND status='PUBLISHED' ORDER BY skill_id",
        )
      ).recordset.map(s => s.id);
      assert.equal(skillIds.length, 2);
      const run = async (operation: string, payload: object, who = actor) => {
        const accessRevision = (
          await query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@a')
        ).recordset[0].revision;
        const req = new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('actor', sql.UniqueIdentifier, who)
          .input('op', sql.VarChar(30), operation)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify({ ...payload, accessRevision }));
        const result = await req.query(
          "EXECUTE AS USER=N'skill_management_runtime'; BEGIN TRY EXEC dbo.BusinessWorkflow @account,@actor,@op,@payload; REVERT; END TRY BEGIN CATCH REVERT; THROW; END CATCH;",
        );
        return JSON.parse(result.recordset[0].json);
      };
      const propose = async (type: string, definition: object, targetId: string | null = null) => {
        const id = randomUUID(),
          revision = (await query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@a'))
            .recordset[0].revision;
        await run('PROPOSE', {
          id,
          revision,
          type,
          targetId,
          isNew: !targetId,
          definition,
          reason: 'Rollback mapping fixture',
        });
        const row = (
          await new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('id', sql.UniqueIdentifier, id)
            .query(
              'SELECT target_id AS target,revision FROM dbo.MasterAmendment WHERE account_id=@a AND id=@id',
            )
        ).recordset[0];
        return { id, ...row };
      };
      const provider = await propose('PROVIDER', {
        name: 'Mapping QA ' + randomUUID(),
        active: true,
      });
      await run('APPROVE_AMENDMENT', {
        id: provider.id,
        revision: provider.revision,
        note: 'Rollback fixture',
      });
      const definition = {
        name: 'Mapping QA ' + randomUUID(),
        providerId: provider.target,
        category: 'QA',
        description: 'Rollback fixture',
        active: true,
        relatedSkillIds: scenario === 'invalid-skill' ? [randomUUID()] : skillIds,
      };
      const credential = await propose('CERTIFICATION', definition);
      const decision = {
        id: credential.id,
        revision: credential.revision,
        note: 'Rollback fixture',
      };
      if (scenario === 'invalid-skill')
        await assert.rejects(run('APPROVE_AMENDMENT', decision), (e: any) => e.number === 51000);
      else if (scenario === 'denied') {
        const employee = (
          await query(
            "SELECT TOP(1) person_id AS id FROM dbo.AccessPerson WHERE account_id=@a AND employee_code='DEMO-NHS-002'",
          )
        ).recordset[0];
        assert.ok(employee);
        await assert.rejects(
          run('APPROVE_AMENDMENT', decision, employee.id),
          (e: any) => e.number === 51003,
        );
      } else {
        await run('APPROVE_AMENDMENT', decision);
        const masters = await run('MASTERS', { page: 1, search: definition.name });
        assert.equal(masters.certifications[0].relatedSkillIds.length, 2);
        const optionsResult = await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('actor', sql.UniqueIdentifier, actor)
          .query(
            "EXECUTE AS USER=N'skill_management_runtime';EXEC dbo.CapabilitySubmissionWorkspace @account,@actor,'OPTIONS',N'{}';REVERT;",
          );
        const options = JSON.parse(optionsResult.recordset[0].json);
        assert.equal(
          options.definitions.find(
            (d: any) => d.id.toLowerCase() === credential.target.toLowerCase(),
          ).relatedSkills.length,
          2,
        );
        if (scenario === 'update') {
          const amendment = await propose(
            'CERTIFICATION',
            { ...definition, relatedSkillIds: [skillIds[1]] },
            credential.target,
          );
          await run('APPROVE_AMENDMENT', {
            id: amendment.id,
            revision: amendment.revision,
            note: 'Rollback update',
          });
          const updated = await run('MASTERS', { page: 1, search: definition.name });
          assert.deepEqual(
            updated.certifications[0].relatedSkillIds.map((s: string) => s.toLowerCase()),
            [skillIds[1].toLowerCase()],
          );
        }
      }
      console.log('PASS master-mapping ' + scenario);
    } finally {
      await tx.rollback().catch(() => {});
    }
  }
});
