import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
assert.equal(
  process.env.RUN_SKILL_DOCUMENT_SQL_TESTS,
  '1',
  'Explicit development opt-in required.',
);
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
const migration = await fs.readFile(
  new URL('../../../database/migrations/084_skill_evidence_documents.sql', import.meta.url),
  'utf8',
);
await withDatabase(async pool => {
  assert.match((await pool.request().query('SELECT DB_NAME() AS name')).recordset[0].name, /-dev$/);
  const results = [];
  for (const scenario of ['pdf', 'wrong-owner', 'stale', 'wrong-path', 'unsupported', 'oversize']) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let rolledBack = false;
    tx.on('rollback', () => (rolledBack = true));
    try {
      for (const batch of migration.split(/^GO\s*$/m))
        if (batch.trim()) await new sql.Request(tx).batch(batch);
      const row: { id: string; owner: string; revision: number } = (
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .query(
            `SELECT TOP(1) c.claim_id AS id,c.person_id AS owner,c.revision FROM dbo.SkillClaimDraft c JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id AND p.active=1 WHERE c.account_id=@account AND c.status IN('DRAFT','CHANGES_REQUESTED','REJECTED') AND p.employee_code LIKE 'DEMO-%' AND dbo.AccessCan(@account,p.person_id,'profile.view',1)=1 AND dbo.AccessCan(@account,p.person_id,'skill.claim',1)=1 AND (SELECT COUNT(*) FROM dbo.SkillClaimEvidence e WHERE e.account_id=c.account_id AND e.claim_id=c.claim_id)<6;`,
          )
      ).recordset[0];
      assert.ok(row, 'An editable authorized demo claim is required.');
      const id = crypto.randomUUID();
      const actor = scenario === 'wrong-owner' ? crypto.randomUUID() : row.owner;
      try {
        const result: sql.IResult<any> = await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('actor', sql.UniqueIdentifier, actor)
          .input('claim', sql.UniqueIdentifier, row.id)
          .input('revision', sql.Int, row.revision + (scenario === 'stale' ? 1 : 0))
          .input('file', sql.UniqueIdentifier, id)
          .input(
            'blob',
            sql.VarChar(160),
            `${account.toLowerCase()}/${row.id.toLowerCase()}/${id}.${scenario === 'wrong-path' ? 'webp' : 'pdf'}`,
          )
          .input('bytes', sql.Int, scenario === 'oversize' ? 10485761 : 6 * 1024 * 1024)
          .input(
            'mime',
            sql.VarChar(100),
            scenario === 'unsupported' ? 'text/html' : 'application/pdf',
          )
          .query(
            `EXECUTE AS USER=N'skill_management_runtime'; BEGIN TRY EXEC dbo.SkillEvidence @account_id=@account,@actor_id=@actor,@claim_id=@claim,@operation='ADD',@expected_revision=@revision,@evidence_id=@file,@blob_name=@blob,@bytes=@bytes,@width=NULL,@height=NULL,@mime_type=@mime,@file_name=N'proof.pdf';REVERT; END TRY BEGIN CATCH REVERT;THROW;END CATCH;`,
          );
        assert.equal(scenario, 'pdf');
        const items: sql.IRecordSet<{ id: string; mimeType: string }> = (
          result.recordsets as sql.IRecordSet<any>[]
        )[1];
        assert.equal(items.find(i => i.id.toLowerCase() === id)?.mimeType, 'application/pdf');
        assert.equal(result.recordset[0].revision, row.revision + 1);
        for (const name of ['CapabilitySubmissionWorkspace', 'BusinessRecordFiles']) {
          const definition = (
            await new sql.Request(tx)
              .input('name', sql.NVarChar(150), 'dbo.' + name)
              .query('SELECT OBJECT_DEFINITION(OBJECT_ID(@name)) AS text')
          ).recordset[0].text;
          assert.ok(definition.includes('e.mime_type AS mimeType,e.file_name AS fileName'));
        }
        results.push({ scenario, passed: true });
      } catch (error) {
        if (scenario === 'pdf') throw error;
        const expected = {
          'wrong-owner': 51003,
          stale: 51009,
          'wrong-path': 51000,
          unsupported: 51000,
          oversize: 547,
        }[scenario];
        assert.equal((error as { number: number }).number, expected);
        results.push({ scenario, denied: expected });
      }
    } finally {
      if (!rolledBack) await tx.rollback();
    }
  }
  console.log(JSON.stringify(results));
});
