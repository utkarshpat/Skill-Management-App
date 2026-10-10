// Opt-in setup-identity fixtures. Every case rolls back data and migration DDL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account, 'Set ACCESS_ACCOUNT_ID for a workspace with schema through 052.');
const migration = await readFile(
  new URL('../../../database/migrations/053_certification_records.sql', import.meta.url),
  'utf8',
);
await withDatabase(async pool => {
  const version = (
    await pool.request().query('SELECT MAX(version) AS version FROM dbo.SchemaMigration')
  ).recordset[0].version;
  assert.ok(version >= 52, 'Schema through 052 is required.');
  const baseline = (
    await pool
      .request()
      .input('account', sql.UniqueIdentifier, account)
      .query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account')
  ).recordset[0].revision;
  for (const scenario of [
    'roundtrip',
    'self-review',
    'foreign-save',
    'stale',
    'approved-edit',
    'deny',
    'reassigned',
    'inactive',
    ...(version >= 57 ? ['renewal-preserved' as const] : []),
  ] as const) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let aborted = false;
    tx.on('rollback', () => {
      aborted = true;
    });
    try {
      if (version < 53)
        for (const batch of migration.split(/^GO\s*$/m))
          if (batch.trim()) await new sql.Request(tx).batch(batch);
      const owner = randomUUID(),
        manager = randomUUID(),
        other = randomUUID(),
        id = randomUUID();
      await new sql.Request(tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('manager', sql.UniqueIdentifier, manager)
        .input('other', sql.UniqueIdentifier, other).query(`
        INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active)
        SELECT @account,id,name,'QA-'+CONVERT(varchar(36),id),1 FROM (VALUES(@owner,N'QA certification owner'),(@manager,N'QA certification manager'),(@other,N'QA unrelated')) p(id,name);
        INSERT dbo.AccessOrgAssignment(account_id,person_id,manager_id) VALUES(@account,@owner,@manager),(@account,@manager,NULL),(@account,@other,NULL);
        INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until)
        SELECT @account,p.id,g.code,g.scope,'ALLOW',N'Rollback certification fixture',DATEADD(hour,1,SYSUTCDATETIME())
        FROM (VALUES(@owner),(@manager),(@other)) p(id) CROSS JOIN (VALUES('profile.view','OWN'),('skill.view','OWN'),('skill.view','ORGANIZATION'),('skill.claim','OWN')) g(code,scope);
      `);
      const fields = {
        certificationName: 'Rollback credential',
        provider: 'QA issuer',
        category: 'QA',
        certificationDate: '2020-01-01',
        expiryDate: '2021-01-01',
        credentialId: 'QA',
        credentialUrl: 'https://issuer.example/badge',
        notes: 'Rollback only',
      };
      const run = (
        actor: string,
        operation: string,
        payload: object,
      ): Promise<sql.IProcedureResult<Record<string, unknown>>> =>
        new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('operation', sql.VarChar(20), operation)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .execute<Record<string, unknown>>('dbo.CertificationWorkspace');
      await run(owner, 'SAVE', { id, revision: 0, fields });
      if (version >= 54)
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('id', sql.UniqueIdentifier, id)
          .query(
            `INSERT dbo.CertificationImageRecord(account_id,certification_id,evidence_id,blob_name,bytes,width,height) VALUES(@account,@id,NEWID(),'rollback-fixture',100,50,50);`,
          );
      await run(owner, 'SAVE_SUBMIT', { id, revision: 1, fields });
      const review = () =>
        run(manager, 'APPROVE', { id, revision: 2, feedback: 'Checked issuer transcript' });
      const rejected = (work: Promise<unknown>, number: number) =>
        assert.rejects(work, e => (e as { number: number }).number === number);
      if (scenario === 'roundtrip') {
        const queue = await run(manager, 'LIST', { view: 'queue' });
        assert.equal(
          String(
            (queue.recordsets as unknown as Record<string, unknown>[][])[1][0].personId,
          ).toLowerCase(),
          owner.toLowerCase(),
        );
        const runtime: sql.IResult<{ recordsRead: number }> = await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('manager', sql.UniqueIdentifier, manager)
          .input(
            'payload',
            sql.NVarChar(sql.MAX),
            JSON.stringify({ id, revision: 2, feedback: 'Checked issuer transcript' }),
          ).query(`EXECUTE AS USER=N'skill_management_runtime';
          BEGIN TRY
            EXEC dbo.CertificationWorkspace @account_id=@account,@actor_id=@manager,@operation='APPROVE',@payload=@payload;
            SELECT HAS_PERMS_BY_NAME(N'dbo.CertificationRecord',N'OBJECT',N'SELECT') AS recordsRead;
            REVERT;
          END TRY BEGIN CATCH REVERT;THROW;END CATCH;`);
        assert.equal(
          runtime.recordset[0].recordsRead,
          0,
          'Runtime must use the guarded procedure.',
        );
        const result = await run(owner, 'GET', { id });
        assert.equal(result.recordset[0].status, 'APPROVED');
        assert.equal(
          result.recordset[0].expiryDate,
          '2021-01-01',
          'Approval must not alter expiry',
        );
        assert.equal(result.recordset[0].revision, 3);
        const audit: sql.IResult<{ action: string }> = await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('id', sql.UniqueIdentifier, id)
          .query<{ action: string }>(
            'SELECT action FROM dbo.AccessAudit WHERE account_id=@account AND target_id=@id ORDER BY revision',
          );
        assert.deepEqual(
          audit.recordset.map(r => r.action),
          ['certification.saved', 'certification.submitted', 'certification.approved'],
        );
      } else if (scenario === 'renewal-preserved') {
        await review();
        const replacement = randomUUID();
        await run(owner, 'SAVE', { id: replacement, revision: 0, fields });
        await new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, owner)
          .input('certification_id', sql.UniqueIdentifier, replacement)
          .input('renewed_from_id', sql.UniqueIdentifier, id)
          .execute('dbo.LinkCertificationRenewal');
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('id', sql.UniqueIdentifier, replacement)
          .query(
            "INSERT dbo.CertificationImageRecord(account_id,certification_id,evidence_id,blob_name,bytes,width,height) VALUES(@account,@id,NEWID(),'rollback-renewal',100,50,50);",
          );
        // Actual wizard protocol: renewal source appears only on the first draft/link.
        await run(owner, 'SAVE_SUBMIT', { id: replacement, revision: 1, fields });
        const linked: { source: string; status: string; events: number } = (
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('replacement', sql.UniqueIdentifier, replacement)
            .query<{ source: string; status: string; events: number }>(
              "SELECT renewed_from_id AS source,status,(SELECT COUNT(*) FROM dbo.AccessAudit WHERE account_id=@account AND target_id=@replacement AND action='certification.renewal_started') AS events FROM dbo.CertificationRecord WHERE account_id=@account AND id=@replacement",
            )
        ).recordset[0];
        assert.equal(linked.source.toLowerCase(), id.toLowerCase());
        assert.equal(linked.status, 'SUBMITTED');
        assert.equal(linked.events, 1);
      } else if (scenario === 'self-review')
        await rejected(run(owner, 'APPROVE', { id, revision: 2, feedback: 'Self review' }), 51003);
      else if (scenario === 'foreign-save')
        await rejected(run(other, 'SAVE', { id, revision: 2, fields }), 51003);
      else if (scenario === 'stale')
        await rejected(run(manager, 'APPROVE', { id, revision: 3, feedback: 'Stale' }), 51009);
      else if (scenario === 'approved-edit') {
        await review();
        await rejected(run(owner, 'SAVE', { id, revision: 3, fields }), 51010);
      } else {
        const request = new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('manager', sql.UniqueIdentifier, manager)
          .input('other', sql.UniqueIdentifier, other);
        if (scenario === 'deny')
          await request.query(
            "INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until) VALUES(@account,@manager,'skill.verify','ORGANIZATION','DENY',N'QA deny',DATEADD(hour,1,SYSUTCDATETIME()));",
          );
        else if (scenario === 'reassigned')
          await request.query(
            'UPDATE dbo.AccessOrgAssignment SET manager_id=@other WHERE account_id=@account AND person_id=@owner;',
          );
        else
          await request.query(
            'UPDATE dbo.AccessPerson SET active=0 WHERE account_id=@account AND person_id=@owner;',
          );
        await rejected(review(), 51003);
      }
      console.log('Rollback certification scenario passed:', scenario);
    } finally {
      if (!aborted) await tx.rollback();
    }
  }
  const after = (
    await pool
      .request()
      .input('account', sql.UniqueIdentifier, account)
      .query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account')
  ).recordset[0].revision;
  assert.equal(after, baseline, 'Fixtures must not persist workspace changes.');
});
