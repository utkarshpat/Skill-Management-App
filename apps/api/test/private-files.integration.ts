import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
assert.equal(
  process.env.RUN_PRIVATE_FILES_SQL_TESTS,
  '1',
  'Explicit rollback-only development opt-in required.',
);
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
const migration = await fs.readFile(
  new URL('../../../database/migrations/085_private_file_storage.sql', import.meta.url),
  'utf8',
);
await withDatabase(async pool => {
  assert.match((await pool.request().query('SELECT DB_NAME() AS name')).recordset[0].name, /-dev$/);
  const originalUser: string = (await pool.request().query('SELECT USER_NAME() AS name'))
    .recordset[0].name;
  const originalRegistry: number | null = (
    await pool.request().query("SELECT OBJECT_ID('dbo.PrivateFileObject') AS id")
  ).recordset[0].id;
  const results = [];
  for (const scenario of [
    'round-trip',
    'skill-round-trip',
    'wrong-owner',
    'stale',
    'checksum',
    'runtime-table-denied',
    'chunk-isolation',
    'changed-manager',
    'business-deny',
    'unsubmitted-private',
    'foreign-file',
  ]) {
    const tx = new sql.Transaction(pool);
    let rolled = false;
    tx.on('rollback', () => (rolled = true));
    await tx.begin();
    try {
      if (originalRegistry === null)
        for (const batch of migration.split(/^GO\s*$/m))
          if (batch.trim()) await new sql.Request(tx).batch(batch);
      const owner = randomUUID(),
        manager = randomUUID(),
        other = randomUUID(),
        cert = randomUUID(),
        claim = randomUUID(),
        submission = randomUUID();
      await new sql.Request(tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('manager', sql.UniqueIdentifier, manager)
        .input('other', sql.UniqueIdentifier, other)
        .input('cert', sql.UniqueIdentifier, cert)
        .input('claim', sql.UniqueIdentifier, claim)
        .input('submission', sql.UniqueIdentifier, submission).query(`
    INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active)
    VALUES(@account,@owner,N'File Owner','PF-'+CONVERT(varchar(36),@owner),1),(@account,@manager,N'File Manager','PF-'+CONVERT(varchar(36),@manager),1),(@account,@other,N'Other Person','PF-'+CONVERT(varchar(36),@other),1);
    INSERT dbo.AccessOrgAssignment(account_id,person_id,manager_id) VALUES(@account,@owner,@manager);
    INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,valid_until,reason)
    SELECT @account,person,permission,scope,'ALLOW',DATEADD(hour,1,SYSUTCDATETIME()),N'Rollback-only private-file fixture'
    FROM (VALUES(@owner,'profile.view','OWN'),(@owner,'skill.view','OWN'),(@owner,'skill.view','ORGANIZATION'),(@owner,'skill.claim','OWN'),(@manager,'profile.view','OWN'),(@manager,'skill.view','OWN'),(@manager,'skill.verify','ORGANIZATION'),(@other,'profile.view','OWN'),(@other,'skill.view','OWN'),(@other,'skill.view','ORGANIZATION'),(@other,'skill.claim','OWN')) grants(person,permission,scope);
    INSERT dbo.BusinessResponsibility(account_id,id,person_id,bundle,scope_kind,effect,active,reason) VALUES(@account,NEWID(),@manager,'BUSINESS_OPERATIONS','ORGANIZATION','ALLOW',1,N'Rollback-only scoped file read');
    INSERT dbo.CertificationRecord(account_id,id,person_id,revision,certification_name,provider,category,issue_date,credential_id,credential_url,notes,status)
    VALUES(@account,@cert,@owner,1,N'Rollback '+CONVERT(nvarchar(36),@cert),N'QA files',N'QA','2026-01-01',N'',N'',N'','DRAFT');
    INSERT dbo.CapabilitySubmission(account_id,id,person_id,revision,status,intake_json)
    VALUES(@account,@submission,@owner,1,'DRAFT',N'{"skills":[],"certifications":[{"id":"'+CONVERT(nvarchar(36),@cert)+N'","fields":{}}]}');
    INSERT dbo.SkillClaimDraft(account_id,claim_id,person_id,skill_id,revision,definition_revision,skill_name,category,claimed_rank,level_name,level_description,experience_months,description,status)
    SELECT TOP(1) @account,@claim,@owner,skill_id,1,definition_revision,skill_name,category,claimed_rank,level_name,level_description,experience_months,N'Rollback experience','DRAFT' FROM dbo.SkillClaimDraft WHERE account_id=@account AND person_id<>@owner;
    IF @@ROWCOUNT<>1 THROW 51000,'A source claim is needed as a rollback fixture template.',1;
    INSERT dbo.SkillCertificationLink(account_id,claim_id,certification_id,submission_id,published) VALUES(@account,@claim,@cert,@submission,1);
   `);
      const run = async (
        proc: string,
        values: Record<string, { type: any; value: any }>,
      ): Promise<sql.IResult<any>> => {
        const request: sql.Request = new sql.Request(tx).input(
          'account_id',
          sql.UniqueIdentifier,
          account,
        );
        for (const [key, item] of Object.entries(values)) request.input(key, item.type, item.value);
        return request.query(
          `EXECUTE AS USER=N'skill_management_runtime'; BEGIN TRY EXEC dbo.${proc} ${['account_id', ...Object.keys(values)].map(k => '@' + k + '=@' + k).join(',')}; REVERT; END TRY BEGIN CATCH REVERT; THROW; END CATCH;`,
        );
      };
      const input = (type: any, value: any) => ({ type, value });
      const content = Buffer.from('Private file fixture');
      const save = (
        id: string,
        revision: number,
        context = 'certification',
        provider = 'sql',
        who = owner,
      ) =>
        run('SavePrivateFile', {
          actor_id: input(sql.UniqueIdentifier, who),
          context: input(sql.VarChar(20), context),
          record_id: input(sql.UniqueIdentifier, cert),
          submission_id: input(sql.UniqueIdentifier, context === 'intake' ? submission : null),
          expected_revision: input(sql.Int, revision),
          file_id: input(sql.UniqueIdentifier, id),
          provider: input(sql.VarChar(12), provider),
          bytes: input(sql.Int, content.length),
          sha256: input(
            sql.VarBinary(32),
            createHash('sha256')
              .update(scenario === 'checksum' ? 'wrong' : content)
              .digest(),
          ),
          mime_type: input(sql.VarChar(100), 'text/plain'),
          original_name: input(sql.NVarChar(255), 'original proof.txt'),
          content: input(sql.VarBinary(sql.MAX), provider === 'sql' ? content : null),
        });
      const read = (id: string, context = 'certification', who = owner) =>
        run('ReadPrivateFile', {
          actor_id: input(sql.UniqueIdentifier, who),
          context: input(sql.VarChar(20), context),
          record_id: input(sql.UniqueIdentifier, cert),
          file_id: input(sql.UniqueIdentifier, id),
          submission_id: input(
            sql.UniqueIdentifier,
            context === 'intake' || context === 'submission' ? submission : null,
          ),
        });
      const last = (r: sql.IResult<any>) => (r.recordsets as sql.IRecordSet<any>[]).at(-1)![0];
      if (scenario === 'round-trip') {
        const id1 = randomUUID(),
          id2 = randomUUID(),
          id3 = randomUUID(),
          id4 = randomUUID();
        assert.match(last(await save(id1, 1)).fileName, /_File_Owner_cert1\.txt$/);
        assert.deepEqual(last(await read(id1)).content, content);
        assert.match(last(await save(id2, 2)).fileName, /_File_Owner_cert2\.txt$/);
        assert.equal(last(await save(id3, 3, 'certification', 'azure-blob')).id.toLowerCase(), id3);
        assert.equal(last(await read(id3)).provider, 'azure-blob');
        assert.equal(last(await read(id3)).content, null);
        await save(id4, 1, 'intake');
        assert.deepEqual(last(await read(id4, 'intake')).content, content);
        // A submitted snapshot keeps the previous immutable SQL bytes after replacement.
        const key = `${account!.toLowerCase()}/certifications/${cert}/${id2}`;
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('submission', sql.UniqueIdentifier, submission)
          .input('cert', sql.UniqueIdentifier, cert)
          .input('manager', sql.UniqueIdentifier, manager)
          .input(
            'snapshot',
            sql.NVarChar(sql.MAX),
            JSON.stringify({
              files: [
                {
                  id: id2,
                  blobName: key,
                  bytes: content.length,
                  mimeType: 'text/plain',
                  fileName: 'snapshot.txt',
                },
              ],
            }),
          ).query(`
     UPDATE dbo.CapabilitySubmission SET status='SUBMITTING',reviewer_id=@manager WHERE account_id=@account AND id=@submission;
     INSERT dbo.CapabilitySubmissionItem(account_id,submission_id,kind,record_id,needs_review,snapshot_json) VALUES(@account,@submission,'CERTIFICATION',@cert,1,@snapshot);
     UPDATE dbo.CertificationRecord SET status='SUBMITTED',reviewer_id=@manager WHERE account_id=@account AND id=@cert;
     UPDATE dbo.CapabilitySubmission SET status='SUBMITTED' WHERE account_id=@account AND id=@submission;
    `);
        assert.deepEqual(last(await read(id2, 'submission', manager)).content, content);
        assert.equal(last(await read(id3, 'business-cert', manager)).provider, 'azure-blob');
        const retained: number = (
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('owner', sql.UniqueIdentifier, owner)
            .query(
              'SELECT COUNT(*) AS n FROM dbo.PrivateFileObject WHERE account_id=@account AND person_id=@owner;',
            )
        ).recordset[0].n;
        assert.equal(retained, 4);
      } else if (scenario === 'skill-round-trip') {
        const file = randomUUID();
        const saved = last(
          await run('SavePrivateFile', {
            actor_id: input(sql.UniqueIdentifier, owner),
            context: input(sql.VarChar(20), 'skill'),
            record_id: input(sql.UniqueIdentifier, claim),
            expected_revision: input(sql.Int, 1),
            file_id: input(sql.UniqueIdentifier, file),
            provider: input(sql.VarChar(12), 'sql'),
            bytes: input(sql.Int, content.length),
            sha256: input(sql.VarBinary(32), createHash('sha256').update(content).digest()),
            mime_type: input(sql.VarChar(100), 'application/pdf'),
            original_name: input(sql.NVarChar(255), 'original evidence.pdf'),
            content: input(sql.VarBinary(sql.MAX), content),
          }),
        );
        assert.match(saved.fileName, /_File_Owner_evidence1\.pdf$/);
        const skillRead = (who: string, context: string) =>
          run('ReadPrivateFile', {
            actor_id: input(sql.UniqueIdentifier, who),
            context: input(sql.VarChar(20), context),
            record_id: input(sql.UniqueIdentifier, claim),
            file_id: input(sql.UniqueIdentifier, file),
          });
        assert.deepEqual(last(await skillRead(owner, 'skill')).content, content);
        await run('TransitionSkillClaim', {
          actor_id: input(sql.UniqueIdentifier, owner),
          claim_id: input(sql.UniqueIdentifier, claim),
          expected_revision: input(sql.Int, 2),
          action: input(sql.VarChar(20), 'SUBMIT'),
          feedback: input(sql.NVarChar(2000), 'Rollback-only file test'),
        });
        assert.deepEqual(last(await skillRead(manager, 'skill')).content, content);
        assert.deepEqual(last(await skillRead(manager, 'business-skill')).content, content);
      } else if (
        ['changed-manager', 'business-deny', 'unsubmitted-private', 'foreign-file'].includes(
          scenario,
        )
      ) {
        const file = randomUUID();
        await save(file, 1);
        if (scenario !== 'unsubmitted-private')
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('cert', sql.UniqueIdentifier, cert)
            .input('submission', sql.UniqueIdentifier, submission)
            .input('manager', sql.UniqueIdentifier, manager)
            .query(`UPDATE dbo.CapabilitySubmission SET status='SUBMITTING',reviewer_id=@manager WHERE account_id=@account AND id=@submission;
            INSERT dbo.CapabilitySubmissionItem(account_id,submission_id,kind,record_id,needs_review) VALUES(@account,@submission,'CERTIFICATION',@cert,1);
            UPDATE dbo.CertificationRecord SET status='SUBMITTED',reviewer_id=@manager WHERE account_id=@account AND id=@cert;
            UPDATE dbo.CapabilitySubmission SET status='SUBMITTED' WHERE account_id=@account AND id=@submission;`);
        if (scenario === 'changed-manager')
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('owner', sql.UniqueIdentifier, owner)
            .input('other', sql.UniqueIdentifier, other)
            .query(
              'UPDATE dbo.AccessOrgAssignment SET manager_id=@other WHERE account_id=@account AND person_id=@owner;',
            );
        if (scenario === 'business-deny')
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('manager', sql.UniqueIdentifier, manager)
            .query(
              "INSERT dbo.BusinessResponsibility(account_id,id,person_id,bundle,scope_kind,effect,active,valid_until,reason) VALUES(@account,NEWID(),@manager,'BUSINESS_OPERATIONS','ORGANIZATION','DENY',1,DATEADD(hour,1,SYSUTCDATETIME()),N'Rollback-only matching scope deny');",
            );
        await assert.rejects(
          read(
            scenario === 'foreign-file' ? randomUUID() : file,
            scenario === 'business-deny' ? 'business-cert' : 'certification',
            manager,
          ),
          (e: any) => e.number === (scenario === 'foreign-file' ? 51004 : 51003),
        );
      } else if (scenario === 'wrong-owner' || scenario === 'stale' || scenario === 'checksum') {
        const expected = scenario === 'wrong-owner' ? 51003 : scenario === 'stale' ? 51009 : 51000;
        await assert.rejects(
          save(
            randomUUID(),
            scenario === 'stale' ? 2 : 1,
            'certification',
            'sql',
            scenario === 'wrong-owner' ? other : owner,
          ),
          (e: any) => e.number === expected,
        );
      } else if (scenario === 'runtime-table-denied') {
        await assert.rejects(
          new sql.Request(tx).query(
            "EXECUTE AS USER=N'skill_management_runtime'; BEGIN TRY SELECT content FROM dbo.PrivateFileObject;REVERT;END TRY BEGIN CATCH REVERT;THROW;END CATCH;",
          ),
          (e: any) => e.number === 229,
        );
      } else {
        const binding = createHash('sha256').update(randomUUID()).digest(),
          total = 3145730;
        const part = (who: string, index: number, data: Buffer) =>
          run('StagePrivateUpload', {
            actor_id: input(sql.UniqueIdentifier, who),
            binding: input(sql.VarBinary(32), binding),
            part_index: input(sql.Int, index),
            part_count: input(sql.Int, 2),
            total_bytes: input(sql.Int, total),
            content: input(sql.VarBinary(sql.MAX), data),
          });
        await part(owner, 0, Buffer.alloc(3145728));
        await part(owner, 0, Buffer.alloc(3145728));
        const full = await part(owner, 1, Buffer.from('ok'));
        assert.equal((full.recordsets as sql.IRecordSet<any>[]).at(-1)!.length, 2);
        await assert.rejects(part(other, 1, Buffer.from('ok')), (e: any) => e.number === 51009);
      }
      results.push({ scenario, passed: true });
    } finally {
      if (!rolled) await tx.rollback();
      // XACT_ABORT inside an impersonated nested procedure can terminate the batch
      // before its REVERT handler runs. Restore the original setup context before
      // the pooled connection is reused by the next rollback-only scenario.
      const restored = await pool
        .request()
        .input('original', sql.NVarChar(128), originalUser)
        .query('IF USER_NAME()<>@original REVERT; SELECT USER_NAME() AS name;');
      assert.equal(restored.recordset[0].name, originalUser);
    }
  }
  assert.equal(
    (await pool.request().query("SELECT OBJECT_ID('dbo.PrivateFileObject') AS id")).recordset[0].id,
    originalRegistry,
    'DDL and fixture data must roll back',
  );
  console.log(JSON.stringify({ rollbackOnly: true, scenarios: results }));
});
