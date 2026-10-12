import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
assert.equal(process.env.RUN_CERTIFICATION_IDENTITY_SQL_TESTS, '1');
const account = process.env.ACCESS_ACCOUNT_ID!;
const source = await readFile(
  new URL('../../../database/migrations/075_certification_duplicate_identity.sql', import.meta.url),
  'utf8',
);
await withDatabase(async pool => {
  assert.match(
    (await pool.request().query('SELECT DB_NAME() AS name')).recordset[0].name,
    /-dev$/i,
  );
  for (const scenario of [
    'identity',
    'printed-id',
    'blank-id',
    'valid-renewal',
    'foreign-renewal',
    'group-renewal',
  ]) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let aborted = false;
    tx.on('rollback', () => (aborted = true));
    const owner = randomUUID(),
      other = randomUUID(),
      manager = randomUUID(),
      id = randomUUID();
    try {
      for (const b of source.split(/^GO\s*$/m)) if (b.trim()) await new sql.Request(tx).batch(b);
      await new sql.Request(tx)
        .input('a', sql.UniqueIdentifier, account)
        .input('o', sql.UniqueIdentifier, owner)
        .input('x', sql.UniqueIdentifier, other)
        .input('m', sql.UniqueIdentifier, manager)
        .query(`UPDATE dbo.AccessWorkspace SET personal_baseline_enabled=1 WHERE account_id=@a;
   INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) SELECT @a,id,N'Rollback identity test',CONVERT(varchar(36),id),1 FROM(VALUES(@o),(@x),(@m))p(id);
   INSERT dbo.AccessOrgAssignment(account_id,person_id,manager_id) VALUES(@a,@o,@m),(@a,@x,@m),(@a,@m,NULL);`);
      const fields = {
        certificationName: 'Azure Developer',
        provider: 'Microsoft',
        category: 'Cloud',
        certificationDate: '2026-01-01',
        expiryDate: '2026-01-02',
        credentialId: scenario === 'blank-id' ? '' : 'CERT-101',
        credentialUrl: '',
        notes: 'Rollback only',
      };
      const save = (
        actor: string,
        record: string,
        f = fields,
        renewedFromId?: string,
        revision = 0,
      ) =>
        new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('operation', sql.VarChar(20), 'SAVE')
          .input(
            'payload',
            sql.NVarChar(sql.MAX),
            JSON.stringify({
              id: record,
              revision,
              fields: f,
              ...(renewedFromId ? { renewedFromId } : {}),
            }),
          )
          .execute('dbo.CertificationWorkspace');
      await save(owner, id);
      await save(owner, id, fields, undefined, 1); // Same-record edits and request identity are distinct from business duplicates.
      await save(other, randomUUID()); // No cross-employee false positive.
      if (scenario === 'identity' || scenario === 'blank-id')
        await assert.rejects(
          () =>
            save(owner, randomUUID(), {
              ...fields,
              certificationName: ' azure  developer ',
              provider: ' MICROSOFT ',
            }),
          (e: any) => e.number === 51014,
        );
      else if (scenario === 'printed-id')
        await assert.rejects(
          () =>
            save(owner, randomUUID(), {
              ...fields,
              certificationName: 'Alias title',
              credentialId: ' cert-101 ',
            }),
          (e: any) => e.number === 51014,
        );
      else {
        await new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .input('id', sql.UniqueIdentifier, id)
          .query(
            "UPDATE dbo.CertificationRecord SET status='APPROVED',requires_skill_link=0 WHERE account_id=@a AND id=@id",
          );
        const renewed = { ...fields, certificationDate: '2026-02-01', expiryDate: '2099-01-01' };
        const renewal = randomUUID();
        if (scenario === 'foreign-renewal')
          await assert.rejects(
            () => save(other, renewal, renewed, id),
            (e: any) => e.number === 51013,
          );
        else if (scenario === 'valid-renewal') {
          await save(owner, renewal, renewed, id);
          const linked = (
            await new sql.Request(tx)
              .input('a', sql.UniqueIdentifier, account)
              .input('id', sql.UniqueIdentifier, renewal)
              .query(
                'SELECT renewed_from_id AS source FROM dbo.CertificationRecord WHERE account_id=@a AND id=@id',
              )
          ).recordset[0];
          assert.equal(linked.source.toLowerCase(), id);
          // A later valid generation may share identity with all its own ancestors.
          await new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('id', sql.UniqueIdentifier, renewal)
            .query(
              "UPDATE dbo.CertificationRecord SET status='APPROVED',requires_skill_link=0 WHERE account_id=@a AND id=@id",
            );
          await save(owner, randomUUID(), { ...renewed, expiryDate: '2099-02-01' }, renewal);
          await assert.rejects(
            () => save(owner, randomUUID(), renewed),
            (e: any) => e.number === 51014,
          );
        } else {
          // Group save must carry the renewal source before its initial certificate INSERT.
          const group = randomUUID(),
            claim = randomUUID();
          const existing = (
            await new sql.Request(tx)
              .input('a', sql.UniqueIdentifier, account)
              .query(
                "SELECT TOP(1) s.skill_id AS id,s.definition_revision AS definition FROM dbo.SkillCatalogue s JOIN dbo.SkillDefinitionVersion v ON v.account_id=s.account_id AND v.skill_id=s.skill_id AND v.definition_revision=s.definition_revision WHERE s.account_id=@a AND s.status='PUBLISHED' AND v.framework_id IN('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003')",
              )
          ).recordset[0];
          assert.ok(existing);
          // Migration 074 may already be deployed; use a rollback-only current definition when required.
          const version = (
            await new sql.Request(tx).query(
              "SELECT OBJECT_ID('dbo.SkillCurrentFramework') AS triggerId",
            )
          ).recordset[0];
          if (version.triggerId) {
            const v = (
              await new sql.Request(tx)
                .input('a', sql.UniqueIdentifier, account)
                .query(
                  "SELECT TOP(1) s.skill_id AS id,s.definition_revision AS definition FROM dbo.SkillCatalogue s JOIN dbo.SkillDefinitionVersion v ON v.account_id=s.account_id AND v.skill_id=s.skill_id AND v.definition_revision=s.definition_revision WHERE s.account_id=@a AND s.status='PUBLISHED' AND v.framework_id='00000000-0000-4000-8000-000000000003'",
                )
            ).recordset[0];
            Object.assign(existing, v);
          }
          const payload = {
            id: group,
            revision: 0,
            skills: [
              {
                id: claim,
                revision: 0,
                skillId: existing.id,
                fields: {
                  skillId: existing.id,
                  definitionRevision: existing.definition,
                  rank: 1,
                  experienceMonths: 1,
                  lastUsedOn: null,
                  description: 'Rollback-only linked skill',
                  projects: '',
                  evidence: '',
                },
              },
            ],
            certifications: [
              {
                id: renewal,
                revision: 0,
                fields: renewed,
                renewedFromId: id,
                skillIds: [existing.id],
              },
            ],
          };
          await new sql.Request(tx)
            .input('account_id', sql.UniqueIdentifier, account)
            .input('actor_id', sql.UniqueIdentifier, owner)
            .input('operation', sql.VarChar(20), 'SAVE')
            .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
            .execute('dbo.CapabilitySubmissionWorkspace');
          const linked = (
            await new sql.Request(tx)
              .input('a', sql.UniqueIdentifier, account)
              .input('id', sql.UniqueIdentifier, renewal)
              .query(
                'SELECT renewed_from_id AS source FROM dbo.CertificationRecord WHERE account_id=@a AND id=@id',
              )
          ).recordset[0];
          assert.equal(linked.source.toLowerCase(), id);
        }
      }
      console.log('Credential identity SQL passed: ' + scenario);
    } finally {
      if (!aborted) await tx.rollback();
    }
    const after = await pool
      .request()
      .input('a', sql.UniqueIdentifier, account)
      .input('o', sql.UniqueIdentifier, owner)
      .query('SELECT COUNT(*) AS n FROM dbo.AccessPerson WHERE account_id=@a AND person_id=@o');
    assert.equal(after.recordset[0].n, 0);
  }
});
