// Explicit development opt-in. Procedure changes, fixtures and audit rows all roll back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
import { commonLevels } from '../src/modules/skills/proficiency.js';
assert.equal(process.env.RUN_CATALOGUE_FORMS_SQL_TESTS, '1');
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
const migration = await readFile(
  new URL('../../../database/migrations/086_catalogue_forms_shared_criteria.sql', import.meta.url),
  'utf8',
);
await withDatabase(async pool => {
  const info = (
    await pool
      .request()
      .query('SELECT DB_NAME() AS name,(SELECT MAX(version) FROM dbo.SchemaMigration) AS version')
  ).recordset[0];
  assert.equal(
    info.name,
    'skill-management-dev',
    'Use the original development test database, not organization hosting.',
  );
  assert.ok(info.version >= 78);
  const original = (
    await pool
      .request()
      .query("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.SaveSkillCatalogue')) AS definition")
  ).recordset[0].definition;
  for (const scenario of [
    'round-trip',
    'clear',
    'unknown-certification',
    'stale',
    'denied',
    'pending-certification',
    'pending-skill',
    'credential-limit',
    'skill-amendment',
  ]) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const batch of migration.split(/^GO\s*$/m))
        if (batch.trim()) await new sql.Request(tx).batch(batch);
      const query = (text: string): Promise<sql.IResult<any>> =>
        new sql.Request(tx).input('a', sql.UniqueIdentifier, account).query(text);
      const actor: string = (
        await query(
          "SELECT TOP(1) person_id AS id FROM dbo.AccessPerson WHERE account_id=@a AND dbo.AccessCan(@a,person_id,'skill.catalogue.manage',0)=1 AND dbo.BusinessAmendCan(@a,person_id)=1 AND dbo.AccessCan(@a,person_id,'permissions.manage',0)=1 AND dbo.AccessCan(@a,person_id,'users.manage',0)=1 AND dbo.AccessCan(@a,person_id,'audit.view',0)=1 ORDER BY person_id",
        )
      ).recordset[0]?.id;
      assert.ok(actor, 'An existing authorized catalogue operator is required.');
      const provider = randomUUID(),
        credential = randomUUID(),
        skill = randomUUID(),
        name = 'Catalogue forms QA ' + randomUUID();
      await new sql.Request(tx)
        .input('a', sql.UniqueIdentifier, account)
        .input('p', sql.UniqueIdentifier, provider)
        .input('c', sql.UniqueIdentifier, credential)
        .input('name', sql.NVarChar(100), name)
        .query(
          "INSERT dbo.CredentialProvider(account_id,id,name,active,revision) VALUES(@a,@p,@name,1,1); INSERT dbo.CredentialDefinition(account_id,id,name,provider_id,category,description,active,revision) VALUES(@a,@c,@name,@p,N'QA',N'Rollback fixture',1,1);",
        );
      const revision = async () =>
        (await query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@a')).recordset[0]
          .revision;
      const save = async (
        isNew: boolean,
        ids: string[] | undefined,
        version: number | undefined = undefined,
        who = actor,
      ) => {
        return new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .input('actor', sql.UniqueIdentifier, who)
          .input('rev', sql.Int, version ?? (await revision()))
          .input('id', sql.UniqueIdentifier, skill)
          .input('new', sql.Bit, isNew)
          .input(
            'payload',
            sql.NVarChar(sql.MAX),
            JSON.stringify({
              name,
              category: 'QA',
              description: 'Rollback skill',
              status: 'PUBLISHED',
              levels: [{ rank: 1, name: 'Forged', description: 'Caller-specific criteria' }],
              ...(ids === undefined ? {} : { relatedCertificationIds: ids }),
            }),
          )
          .query(
            "EXECUTE AS USER=N'skill_management_runtime'; BEGIN TRY EXEC dbo.SaveSkillCatalogue @a,@actor,@rev,@id,@new,@payload; REVERT; END TRY BEGIN CATCH REVERT; THROW; END CATCH;",
          );
      };
      const run = async (operation: string, payload: object): Promise<any> => {
        const result = await new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .input('actor', sql.UniqueIdentifier, actor)
          .input('op', sql.VarChar(30), operation)
          .input(
            'payload',
            sql.NVarChar(sql.MAX),
            JSON.stringify({ ...payload, accessRevision: await revision() }),
          )
          .query(
            "EXECUTE AS USER=N'skill_management_runtime'; BEGIN TRY EXEC dbo.BusinessWorkflow @a,@actor,@op,@payload; REVERT; END TRY BEGIN CATCH REVERT; THROW; END CATCH;",
          );
        return JSON.parse(result.recordset[0].json);
      };
      if (scenario === 'unknown-certification')
        await assert.rejects(save(true, [randomUUID()]), (e: any) => e.number === 51000);
      else if (scenario === 'stale')
        await assert.rejects(
          save(true, [credential], (await revision()) - 1),
          (e: any) => e.number === 51009,
        );
      else if (scenario === 'denied') {
        const viewer = (
          await query(
            "SELECT TOP(1) person_id AS id FROM dbo.AccessPerson WHERE account_id=@a AND dbo.AccessCan(@a,person_id,'skill.catalogue.manage',0)=0",
          )
        ).recordset[0]?.id;
        assert.ok(viewer);
        await assert.rejects(
          save(true, [credential], await revision(), viewer),
          (e: any) => e.number === 51003,
        );
      } else {
        await save(true, [credential]);
        const levels: sql.IRecordSet<{ rank: number; name: string; description: string }> = (
          await new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('s', sql.UniqueIdentifier, skill)
            .query(
              'SELECT rank,display_name AS name,description FROM dbo.SkillProficiencyLevel WHERE account_id=@a AND skill_id=@s ORDER BY rank',
            )
        ).recordset;
        assert.deepEqual(Array.from(levels), commonLevels());
        const masters = await run('MASTERS', { search: name, page: 1 });
        assert.equal(masters.skills[0].relatedCertifications[0].id.toLowerCase(), credential);
        assert.equal(masters.certifications[0].relatedSkillIds[0].toLowerCase(), skill);
        if (scenario === 'credential-limit') {
          await new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('s', sql.UniqueIdentifier, skill)
            .input('p', sql.UniqueIdentifier, provider)
            .input('name', sql.NVarChar(100), name).query(`
            DECLARE @extra TABLE(id uniqueidentifier PRIMARY KEY,n int);
            INSERT @extra SELECT NEWID(),n FROM (VALUES(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14),(15),(16),(17),(18),(19)) x(n);
            INSERT dbo.CredentialDefinition(account_id,id,name,provider_id,category,description,active,revision) SELECT @a,id,@name+CONVERT(nvarchar(2),n),@p,N'QA',N'Rollback limit fixture',1,1 FROM @extra;
            INSERT dbo.CredentialSkillMapping(account_id,credential_id,skill_id) SELECT @a,id,@s FROM @extra;
          `);
          const id = randomUUID();
          await run('PROPOSE', {
            id,
            revision: await revision(),
            type: 'CERTIFICATION',
            isNew: true,
            targetId: null,
            reason: 'Rollback limit test',
            definition: {
              name: name + ' twenty first',
              category: 'QA',
              description: 'QA',
              active: true,
              providerId: provider,
              relatedSkillIds: [skill],
            },
          });
          await assert.rejects(
            run('APPROVE_AMENDMENT', { id, revision: 1, note: 'Rollback limit decision' }),
            (e: any) => e.number === 51000 && /twenty certifications/.test(e.message),
          );
        } else if (scenario === 'skill-amendment') {
          const id = randomUUID();
          await run('PROPOSE', {
            id,
            revision: await revision(),
            type: 'SKILL',
            isNew: false,
            targetId: skill,
            reason: 'Rollback amendment test',
            definition: {
              name,
              category: 'QA',
              description: 'Updated description',
              active: true,
              status: 'PUBLISHED',
              levels: commonLevels(),
              relatedCertificationIds: [],
            },
          });
          await run('APPROVE_AMENDMENT', { id, revision: 1, note: 'Rollback approval' });
          assert.equal((await run('AMENDMENT', { id })).status, 'APPROVED');
          assert.equal(
            (await run('MASTERS', { search: name, page: 1 })).certifications[0].relatedSkillIds
              .length,
            0,
          );
        } else if (scenario === 'clear') {
          await save(false, undefined);
          assert.equal(
            (await run('MASTERS', { search: name, page: 1 })).certifications[0].relatedSkillIds
              .length,
            1,
          );
          await save(false, []);
          assert.equal(
            (await run('MASTERS', { search: name, page: 1 })).certifications[0].relatedSkillIds
              .length,
            0,
          );
        } else if (scenario.startsWith('pending-')) {
          const isSkill = scenario === 'pending-skill',
            id = randomUUID();
          await run('PROPOSE', {
            id,
            revision: await revision(),
            type: isSkill ? 'SKILL' : 'CERTIFICATION',
            targetId: isSkill ? skill : credential,
            isNew: false,
            reason: 'Rollback concurrency test',
            definition: isSkill
              ? {
                  name,
                  category: 'QA',
                  description: 'QA',
                  active: true,
                  status: 'PUBLISHED',
                  levels: commonLevels(),
                  relatedCertificationIds: [credential],
                }
              : {
                  name,
                  category: 'QA',
                  description: 'QA',
                  active: true,
                  providerId: provider,
                  relatedSkillIds: [skill],
                },
          });
          const beforeDetail = await run('AMENDMENT', { id });
          assert.equal(
            beforeDetail.definition[
              isSkill ? 'relatedCertificationDetails' : 'relatedSkillDetails'
            ][0].name,
            name,
          );
          if (isSkill) {
            const certificateEdit = randomUUID();
            await run('PROPOSE', {
              id: certificateEdit,
              revision: await revision(),
              type: 'CERTIFICATION',
              targetId: credential,
              isNew: false,
              reason: 'Change skill suggestions',
              definition: {
                name,
                category: 'QA',
                description: 'QA',
                active: true,
                providerId: provider,
                relatedSkillIds: [],
              },
            });
            await run('APPROVE_AMENDMENT', {
              id: certificateEdit,
              revision: 1,
              note: 'Rollback mapping change',
            });
          } else await save(false, []);
          const afterDetail = await run('AMENDMENT', { id });
          assert.equal(afterDetail.targetChanged, true);
          await assert.rejects(
            run('APPROVE_AMENDMENT', { id, revision: 1, note: 'Rollback decision' }),
            (e: any) => e.number === 51009,
          );
        } else {
          const options = await new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('actor', sql.UniqueIdentifier, actor)
            .input('name', sql.NVarChar(100), name)
            .query(
              "EXECUTE AS USER=N'skill_management_runtime';BEGIN TRY EXEC dbo.ReadCatalogueCertifications @a,@actor,@name,1;REVERT;END TRY BEGIN CATCH REVERT;THROW;END CATCH;",
            );
          const sets = options.recordsets as unknown as sql.IRecordSet<any>[];
          assert.equal(sets[0][0].total, 1);
          assert.equal(sets[1][0].id.toLowerCase(), credential);
          const catalogue = await new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('actor', sql.UniqueIdentifier, actor)
            .input('name', sql.NVarChar(100), name)
            .query(
              "EXECUTE AS USER=N'skill_management_runtime';BEGIN TRY EXEC dbo.ReadSkillCatalogue @a,@actor,@name,'PUBLISHED',1;REVERT;END TRY BEGIN CATCH REVERT;THROW;END CATCH;",
            );
          const catalogueSets = catalogue.recordsets as unknown as sql.IRecordSet<any>[];
          assert.equal(catalogueSets[3][0].id.toLowerCase(), credential);
          assert.equal(catalogueSets[3][0].skillId.toLowerCase(), skill);

          const audit: { after_json: string } = (
            await new sql.Request(tx)
              .input('a', sql.UniqueIdentifier, account)
              .input('s', sql.UniqueIdentifier, skill)
              .query(
                "SELECT TOP(1) after_json FROM dbo.AccessAudit WHERE account_id=@a AND target_id=@s AND action='skill.created' ORDER BY revision DESC",
              )
          ).recordset[0];
          assert.equal(
            JSON.parse(audit.after_json).relatedCertificationIds[0].toLowerCase(),
            credential,
          );
        }
      }
      console.log('PASS catalogue-forms ' + scenario);
    } finally {
      await tx.rollback().catch(() => {});
    }
  }
  assert.equal(
    (
      await pool
        .request()
        .query("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.SaveSkillCatalogue')) AS definition")
    ).recordset[0].definition,
    original,
    'All procedure changes rolled back.',
  );
});
