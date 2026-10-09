// Opt-in setup-identity fixtures. Every case rolls back data and migration DDL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account, 'Set ACCESS_ACCOUNT_ID for a workspace with schema through 053.');
const migration = await readFile(
  new URL('../../../database/migrations/054_certification_images.sql', import.meta.url),
  'utf8',
);
await withDatabase(async pool => {
  const version = (
    await pool.request().query('SELECT MAX(version) AS version FROM dbo.SchemaMigration')
  ).recordset[0].version;
  assert.ok(version >= 53, 'Schema through 053 is required.');
  const baseline = (
    await pool
      .request()
      .input('account', sql.UniqueIdentifier, account)
      .query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account')
  ).recordset[0].revision;
  for (const scenario of [
    'required',
    'required-combined',
    'roundtrip',
    'foreign',
    'stale',
    'locked',
    'draft-manager',
    'reassigned',
    'deny',
    'inactive',
  ] as const) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let aborted = false;
    tx.on('rollback', () => {
      aborted = true;
    });
    try {
      if (version < 54)
        for (const batch of migration.split(/^GO\s*$/m))
          if (batch.trim()) await new sql.Request(tx).batch(batch);
      if (version < 55)
        for (const batch of (
          await readFile(
            new URL(
              '../../../database/migrations/055_required_certificate_image.sql',
              import.meta.url,
            ),
            'utf8',
          )
        ).split(/^GO\s*$/m))
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
      const imageRun = (
        actor: string,
        operation = 'READ',
        revision = 1,
        image = randomUUID(),
      ): Promise<sql.IProcedureResult<Record<string, unknown>>> =>
        new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('claim_id', sql.UniqueIdentifier, id)
          .input('operation', sql.VarChar(8), operation)
          .input('expected_revision', sql.Int, revision)
          .input('evidence_id', sql.UniqueIdentifier, image)
          .input(
            'blob_name',
            sql.VarChar(160),
            `${account.toLowerCase()}/certifications/${id}/${image}.webp`,
          )
          .input('bytes', sql.Int, 100)
          .input('width', sql.Int, 50)
          .input('height', sql.Int, 50)
          .execute('dbo.CertificationImage');
      const rejected = (work: Promise<unknown>, number: number) =>
        assert.rejects(work, e => (e as { number: number }).number === number);
      if (scenario === 'required')
        await rejected(run(owner, 'SUBMIT', { id, revision: 1, feedback: '' }), 51012);
      else if (scenario === 'required-combined')
        await rejected(run(owner, 'SAVE_SUBMIT', { id: randomUUID(), revision: 0, fields }), 51012);
      else if (scenario === 'roundtrip') {
        const first = randomUUID(),
          second = randomUUID();
        assert.equal((await imageRun(owner, 'ADD', 1, first)).recordset[0].revision, 2);
        const replaced = await imageRun(owner, 'ADD', 2, second);
        assert.equal(replaced.recordset[0].revision, 3);
        const items = (replaced.recordsets as unknown as Record<string, unknown>[][])[1];
        assert.equal(items.length, 1);
        assert.equal(String(items[0].id).toLowerCase(), second);
        const removed = await imageRun(owner, 'REMOVE', 3);
        assert.equal(removed.recordset[0].revision, 4);
        assert.equal((removed.recordsets as unknown as unknown[][])[1].length, 0);
        await imageRun(owner, 'ADD', 4);
        await run(owner, 'SUBMIT', { id, revision: 5, feedback: '' });
        assert.equal((await imageRun(manager)).recordset[0].canUpload, false);
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('actor', sql.UniqueIdentifier, owner)
          .input('id', sql.UniqueIdentifier, id)
          .query(
            `EXECUTE AS USER='skill_management_runtime'; BEGIN TRY EXEC dbo.CertificationImage @account,@actor,@id; REVERT; END TRY BEGIN CATCH REVERT; THROW; END CATCH;`,
          );
        const permissions = await new sql.Request(tx).query(
          "EXECUTE AS USER='skill_management_runtime'; SELECT HAS_PERMS_BY_NAME('dbo.CertificationImageRecord','OBJECT','SELECT') AS directRead; REVERT;",
        );
        assert.equal(permissions.recordset[0].directRead, 0);
      } else if (scenario === 'foreign') await rejected(imageRun(other, 'ADD'), 51003);
      else if (scenario === 'stale') await rejected(imageRun(owner, 'ADD', 2), 51009);
      else if (scenario === 'draft-manager') await rejected(imageRun(manager), 51003);
      else if (scenario === 'locked') {
        await imageRun(owner, 'ADD', 1);
        await run(owner, 'SUBMIT', { id, revision: 2, feedback: '' });
        await rejected(imageRun(owner, 'ADD', 3), 51003);
      } else {
        await imageRun(owner, 'ADD', 1);
        await run(owner, 'SUBMIT', { id, revision: 2, feedback: '' });
        const request = new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('manager', sql.UniqueIdentifier, manager)
          .input('other', sql.UniqueIdentifier, other);
        if (scenario === 'reassigned')
          await request.query(
            'UPDATE dbo.AccessOrgAssignment SET manager_id=@other WHERE account_id=@account AND person_id=@owner;',
          );
        else if (scenario === 'deny')
          await request.query(
            "INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until) VALUES(@account,@manager,'skill.verify','ORGANIZATION','DENY',N'QA deny',DATEADD(hour,1,SYSUTCDATETIME()));",
          );
        else
          await request.query(
            'UPDATE dbo.AccessPerson SET active=0 WHERE account_id=@account AND person_id=@owner;',
          );
        await rejected(imageRun(manager), 51003);
      }
      console.log('Rollback certification image scenario passed:', scenario);
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
