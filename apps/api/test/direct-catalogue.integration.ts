// Explicit opt-in; fixtures, grants, procedures and audit rows roll back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
import { commonLevels } from '../src/shared/proficiency.js';
assert.equal(process.env.RUN_DIRECT_CATALOGUE_SQL_TESTS, '1');
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
const migrations = await Promise.all(
  ['086_catalogue_forms_shared_criteria.sql', '087_direct_catalogue_management.sql'].map(name =>
    readFile(new URL('../../../database/migrations/' + name, import.meta.url), 'utf8'),
  ),
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
    'Only the original development test database is allowed.',
  );
  assert.ok(info.version >= 78);
  const original = (
    await pool
      .request()
      .query("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.SaveSkillCatalogue')) AS definition")
  ).recordset[0].definition;
  for (const scenario of [
    'new-issuer-reuse-edit-recovery',
    'empty-description-skill',
    'unauthorized',
    'stale',
    'foreign-skill',
    'reused-intent',
    'revoked-recovery',
    'denied-recovery',
    'linked-skills',
    'prepatched-procedure',
    'prepatched-description-batch',
    'unknown-procedure',
  ]) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const apply = async (migration: string) => {
        for (const batch of migration.split(/^GO\s*$/m))
          if (batch.trim()) await new sql.Request(tx).batch(batch);
      };
      await apply(migrations[0]);
      if (scenario === 'prepatched-procedure') {
        await new sql.Request(tx).batch(`
          DECLARE @skill nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.SaveSkillCatalogue'));
          SET @skill=REPLACE(@skill,N' IF @status=''PUBLISHED'' AND LEN(@description)=0 THROW 51000,''Describe the skill before publishing.'',1;',N' -- Description is optional for drafts and published skills.');
          SET @skill=N'ALTER '+SUBSTRING(@skill,CHARINDEX(N'PROCEDURE',UPPER(@skill)),LEN(@skill));
          EXEC sys.sp_executesql @skill;
        `);
      }
      if (scenario === 'prepatched-description-batch') {
        const first = migrations[1].split(/^GO\s*$/m)[0];
        await new sql.Request(tx).batch(first);
        const before: string = (
          await new sql.Request(tx).query(
            "SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.SaveSkillCatalogue')) AS definition",
          )
        ).recordset[0].definition;
        await new sql.Request(tx).batch(first);
        assert.equal(
          (
            await new sql.Request(tx).query(
              "SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.SaveSkillCatalogue')) AS definition",
            )
          ).recordset[0].definition,
          before,
          'Already patched skill procedures are preserved.',
        );
      }
      if (scenario === 'unknown-procedure') {
        await new sql.Request(tx).batch('ALTER PROCEDURE dbo.SaveSkillCatalogue AS SELECT 1;');
        await assert.rejects(
          apply(migrations[1]),
          (e: any) => e.number === 51000 && /differs from reviewed/.test(e.message),
        );
        console.log('PASS direct-catalogue ' + scenario);
        continue;
      }
      await apply(migrations[1]);
      const query = (text: string): Promise<sql.IResult<any>> =>
        new sql.Request(tx).input('a', sql.UniqueIdentifier, account).query(text);
      const actor: string = (
        await query(
          "SELECT TOP(1) person_id AS id FROM dbo.AccessPerson WHERE account_id=@a AND dbo.AccessCan(@a,person_id,'profile.view',1)=1 AND dbo.AccessCan(@a,person_id,'permissions.manage',0)=1 AND dbo.AccessCan(@a,person_id,'users.manage',0)=1 AND dbo.AccessCan(@a,person_id,'audit.view',0)=1 AND dbo.AccessCan(@a,person_id,'skill.catalogue.manage',0)=1 AND dbo.BusinessLegacyDenied(@a,person_id,'request.approve')=0 ORDER BY person_id",
        )
      ).recordset[0]?.id;
      assert.ok(actor);
      const revision = async (): Promise<number> =>
        (await query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@a')).recordset[0]
          .revision;
      const id = randomUUID(),
        name = 'Direct catalogue QA ' + randomUUID();
      const payload: Record<string, any> = {
        id,
        revision: await revision(),
        type: 'CERTIFICATION',
        targetId: null,
        isNew: true,
        reason: '',
        definition: {
          name,
          category: 'QA',
          description: '',
          active: true,
          providerName: name,
          relatedSkillIds: [],
        },
      };
      const run = async (body: object, operation = 'SAVE_MASTER', who = actor): Promise<any> => {
        const result = await new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .input('actor', sql.UniqueIdentifier, who)
          .input('op', sql.VarChar(30), operation)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(body))
          .query(
            "EXECUTE AS USER=N'skill_management_runtime'; BEGIN TRY EXEC dbo.SaveCatalogueMaster @a,@actor,@op,@payload; REVERT; END TRY BEGIN CATCH REVERT; THROW; END CATCH;",
          );
        return JSON.parse(result.recordset[0].json);
      };
      if (scenario === 'unauthorized') {
        const viewer = (
          await query(
            "SELECT TOP(1) person_id AS id FROM dbo.AccessPerson WHERE account_id=@a AND dbo.AccessCan(@a,person_id,'permissions.manage',0)=0",
          )
        ).recordset[0]?.id;
        assert.ok(viewer);
        await assert.rejects(run(payload, 'SAVE_MASTER', viewer), (e: any) => e.number === 51003);
      } else if (scenario === 'stale') {
        await assert.rejects(
          run({ ...payload, revision: payload.revision - 1 }),
          (e: any) => e.number === 51009,
        );
      } else if (scenario === 'foreign-skill') {
        await assert.rejects(
          run({
            ...payload,
            definition: { ...payload.definition, relatedSkillIds: [randomUUID()] },
          }),
          (e: any) => e.number === 51000,
        );
      } else if (scenario === 'linked-skills') {
        const skillId = randomUUID();
        await run({
          ...payload,
          id: skillId,
          type: 'SKILL',
          definition: {
            name: name + ' skill',
            category: 'QA',
            description: '',
            active: true,
            status: 'PUBLISHED',
            levels: commonLevels(),
            relatedCertificationIds: [],
          },
        });
        await run({
          ...payload,
          revision: await revision(),
          definition: { ...payload.definition, relatedSkillIds: [skillId] },
        });
        const mapping = async (): Promise<number> =>
          (
            await new sql.Request(tx)
              .input('a', sql.UniqueIdentifier, account)
              .input('id', sql.UniqueIdentifier, id)
              .query(
                'SELECT COUNT(*) AS n FROM dbo.CredentialSkillMapping WHERE account_id=@a AND credential_id=@id',
              )
          ).recordset[0].n;
        assert.equal(await mapping(), 1);
        const { relatedSkillIds: _omitted, ...definition } = payload.definition;
        await run({
          ...payload,
          id: randomUUID(),
          targetId: id,
          isNew: false,
          revision: await revision(),
          definition,
        });
        assert.equal(await mapping(), 1, 'Omitted mappings preserve current links.');
        await run({
          ...payload,
          id: randomUUID(),
          targetId: id,
          isNew: false,
          revision: await revision(),
          definition: { ...definition, relatedSkillIds: [] },
        });
        assert.equal(await mapping(), 0, 'Explicit empty mappings clear the suggestions.');
      } else if (scenario === 'empty-description-skill') {
        await run({
          ...payload,
          type: 'SKILL',
          definition: {
            name,
            category: 'QA',
            description: '',
            active: true,
            status: 'PUBLISHED',
            levels: commonLevels(),
            relatedCertificationIds: [],
          },
        });
        assert.equal(
          (
            await new sql.Request(tx)
              .input('a', sql.UniqueIdentifier, account)
              .input('id', sql.UniqueIdentifier, id)
              .query(
                'SELECT description,status FROM dbo.SkillCatalogue WHERE account_id=@a AND skill_id=@id',
              )
          ).recordset[0].description,
          '',
        );
      } else {
        assert.equal(await run(payload, 'RECOVER_MASTER'), null);
        const requestsBefore = (
          await query('SELECT COUNT(*) AS n FROM dbo.MasterAmendment WHERE account_id=@a')
        ).recordset[0].n;
        const saved = await run({ ...payload, accessRevision: payload.revision });
        assert.equal(saved.targetId.toLowerCase(), id);
        assert.equal(await revision(), payload.revision + 1);
        assert.equal(
          (await query('SELECT COUNT(*) AS n FROM dbo.MasterAmendment WHERE account_id=@a'))
            .recordset[0].n,
          requestsBefore,
        );
        const recovered = await run(payload, 'RECOVER_MASTER');
        assert.equal(recovered.replayed, true);
        assert.equal((await run(payload)).replayed, true);
        if (scenario === 'reused-intent') {
          await assert.rejects(
            run(
              { ...payload, definition: { ...payload.definition, name: name + ' changed' } },
              'RECOVER_MASTER',
            ),
            (e: any) => e.number === 51009,
          );
        } else if (scenario === 'denied-recovery') {
          await new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('actor', sql.UniqueIdentifier, actor)
            .query(
              "DELETE dbo.AccessPersonOverride WHERE account_id=@a AND person_id=@actor AND permission_code='request.approve' AND scope_kind='ORGANIZATION'; INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,valid_until,reason) VALUES(@a,@actor,'request.approve','ORGANIZATION','DENY',DATEADD(hour,1,SYSUTCDATETIME()),N'Rollback catalogue denial fixture');",
            );
          await assert.rejects(run(payload, 'RECOVER_MASTER'), (e: any) => e.number === 51003);
        } else if (scenario === 'revoked-recovery') {
          // Retiring the actor denies recovery even with the same previously saved intent.
          await new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('actor', sql.UniqueIdentifier, actor)
            .query('UPDATE dbo.AccessPerson SET active=0 WHERE account_id=@a AND person_id=@actor');
          await assert.rejects(run(payload, 'RECOVER_MASTER'), (e: any) => e.number === 51003);
        } else {
          const secondId = randomUUID();
          await run({
            ...payload,
            id: secondId,
            revision: await revision(),
            definition: { ...payload.definition, name: name + ' second' },
          });
          const providers: sql.IResult<{ id: string }> = await new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('name', sql.NVarChar(100), name)
            .query('SELECT id FROM dbo.CredentialProvider WHERE account_id=@a AND name=@name');
          assert.equal(providers.recordset.length, 1, 'The existing issuer is reused.');
          const providerId = providers.recordset[0].id;
          await run({
            id: randomUUID(),
            revision: await revision(),
            type: 'CERTIFICATION',
            targetId: id,
            isNew: false,
            reason: '',
            definition: {
              name: name + ' edited',
              category: 'QA',
              description: '',
              active: true,
              providerId,
              relatedSkillIds: [],
            },
          });
          const row: { name: string; revision: number } = (
            await new sql.Request(tx)
              .input('a', sql.UniqueIdentifier, account)
              .input('id', sql.UniqueIdentifier, id)
              .query(
                'SELECT name,revision FROM dbo.CredentialDefinition WHERE account_id=@a AND id=@id',
              )
          ).recordset[0];
          assert.equal(row.name, name + ' edited');
          assert.equal(row.revision, 2);
        }
      }
      console.log('PASS direct-catalogue ' + scenario);
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
  );
});
