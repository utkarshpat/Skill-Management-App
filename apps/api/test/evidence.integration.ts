import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
await withDatabase(async pool => {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const versions = (
      await new sql.Request(tx).query('SELECT version FROM dbo.SchemaMigration')
    ).recordset.map(r => r.version);
    const { readdir } = await import('node:fs/promises');
    const dir = new URL('../../../database/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => /^0(4[1-9]|50)_/.test(f)).sort()) {
      if (versions.includes(Number(file.slice(0, 3)))) continue;
      for (const batch of (await readFile(new URL(file, dir), 'utf8')).split(/^GO\s*$/m))
        if (batch.trim()) await new sql.Request(tx).batch(batch);
    }
    const row = (
      await new sql.Request(tx)
        .input('account', sql.UniqueIdentifier, account)
        .query(
          'SELECT TOP(1) claim_id AS claim,person_id AS actor FROM dbo.SkillClaimDraft WHERE account_id=@account',
        )
    ).recordset[0];
    assert.ok(row);
    await new sql.Request(tx)
      .input('account', sql.UniqueIdentifier, account)
      .input('actor', sql.UniqueIdentifier, row.actor)
      .input('claim', sql.UniqueIdentifier, row.claim)
      .query(
        "UPDATE dbo.SkillClaimDraft SET status='DRAFT' WHERE account_id=@account AND claim_id=@claim;DELETE dbo.AccessPersonOverride WHERE account_id=@account AND person_id=@actor AND permission_code IN ('profile.view','skill.view','skill.claim');INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until) SELECT @account,@actor,p.code,s.scope,'ALLOW','Rollback evidence test',DATEADD(hour,1,SYSUTCDATETIME()) FROM (VALUES('profile.view'),('skill.view'),('skill.claim')) p(code) CROSS JOIN (VALUES('OWN'),('ORGANIZATION')) s(scope);",
      );
    const read = () =>
      new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, row.actor)
        .input('claim_id', sql.UniqueIdentifier, row.claim)
        .execute('dbo.SkillEvidence');
    const result = await read();
    assert.equal(result.recordset[0].canUpload, true);
    const evidenceId = randomUUID(),
      revision = result.recordset[0].revision;
    const added = await new sql.Request(tx)
      .input('account_id', sql.UniqueIdentifier, account)
      .input('actor_id', sql.UniqueIdentifier, row.actor)
      .input('claim_id', sql.UniqueIdentifier, row.claim)
      .input('operation', sql.VarChar(8), 'ADD')
      .input('expected_revision', sql.Int, revision)
      .input('evidence_id', sql.UniqueIdentifier, evidenceId)
      .input(
        'blob_name',
        sql.VarChar(160),
        `${account.toLowerCase()}/${row.claim.toLowerCase()}/${evidenceId}.webp`,
      )
      .input('bytes', sql.Int, 100)
      .input('width', sql.Int, 50)
      .input('height', sql.Int, 50)
      .execute('dbo.SkillEvidence');
    assert.equal(added.recordset[0].revision, revision + 1);
    assert.ok(
      (added.recordsets as sql.IRecordSet<{ id: string }>[])[1].some(
        i => i.id.toLowerCase() === evidenceId,
      ),
    );
    await new sql.Request(tx)
      .input('account', sql.UniqueIdentifier, account)
      .input('actor', sql.UniqueIdentifier, row.actor)
      .query(
        "UPDATE dbo.AccessPersonOverride SET effect='DENY' WHERE account_id=@account AND person_id=@actor AND permission_code='skill.view' AND scope_kind='OWN'",
      );
    await assert.rejects(read(), e => (e as { number: number }).number === 51003);
    console.log(
      'Evidence DDL, transactional attachment/revision and OWN denial verified; all SQL changes rolled back.',
    );
  } finally {
    await tx.rollback().catch(() => undefined);
  }
});
