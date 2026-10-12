// Development-only, rollback fixture including the migration DDL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
assert.equal(process.env.RUN_CAPABILITY_SQL_TESTS, '1');
const account = process.env.ACCESS_ACCOUNT_ID!;
await withDatabase(async pool => {
  const info = (
    await pool
      .request()
      .query('SELECT DB_NAME() AS name,(SELECT MAX(version) FROM dbo.SchemaMigration) AS version')
  ).recordset[0];
  assert.match(info.name, /-dev$/i);
  const source = await readFile(
    new URL('../../../database/migrations/071_linked_capability_submissions.sql', import.meta.url),
    'utf8',
  );
  for (const scenario of [
    'discard-restore',
    'discard-foreign',
    'discard-stale',
    'happy',
    'foreign',
    'stale',
    'missing-file',
    'unlinked',
    'manager-changed',
    'intake-file',
    'incomplete-decision',
    'snapshot',
    'publish-links',
    'standalone-block',
    'reroute',
    'legacy-returned',
  ].filter(
    s =>
      !process.env.CAPABILITY_SQL_SCENARIOS ||
      process.env.CAPABILITY_SQL_SCENARIOS.split(',').includes(s),
  )) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let aborted = false;
    tx.on('rollback', () => {
      aborted = true;
    });
    try {
      if (info.version < 71)
        for (const batch of source.split(/^GO\s*$/m))
          if (batch.trim()) await new sql.Request(tx).batch(batch);
      if (info.version < 72) {
        const compatibility = await readFile(
          new URL(
            '../../../database/migrations/072_legacy_certification_resubmission.sql',
            import.meta.url,
          ),
          'utf8',
        );
        for (const batch of compatibility.split(/^GO\s*$/m))
          if (batch.trim()) await new sql.Request(tx).batch(batch);
      }
      if (info.version < 73) {
        const removal = await readFile(
          new URL('../../../database/migrations/073_capability_draft_removal.sql', import.meta.url),
          'utf8',
        );
        for (const batch of removal.split(/^GO\s*$/m))
          if (batch.trim()) await new sql.Request(tx).batch(batch);
      }
      const owner = randomUUID(),
        manager = randomUUID(),
        outside = randomUUID(),
        id = randomUUID(),
        cert = randomUUID(),
        claim1 = randomUUID(),
        claim2 = randomUUID();
      await new sql.Request(tx)
        .input('a', sql.UniqueIdentifier, account)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('manager', sql.UniqueIdentifier, manager)
        .input('outside', sql.UniqueIdentifier, outside)
        .query(`UPDATE dbo.AccessWorkspace SET personal_baseline_enabled=1 WHERE account_id=@a;
   INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) SELECT @a,id,name,CONVERT(varchar(36),id),1 FROM(VALUES(@owner,N'Linked QA owner'),(@manager,N'Linked QA manager'),(@outside,N'Linked QA outsider'))p(id,name);
   INSERT dbo.AccessOrgAssignment(account_id,person_id,manager_id) VALUES(@a,@owner,@manager),(@a,@manager,NULL),(@a,@outside,NULL);`);
      const choices = (
        await new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .query(
            "SELECT TOP(2) skill_id,definition_revision FROM dbo.SkillCatalogue WHERE account_id=@a AND status='PUBLISHED' AND definition_revision IS NOT NULL ORDER BY skill_id",
          )
      ).recordset;
      assert.equal(choices.length, 2);
      const skills = choices.map((s, i) => ({
        id: i ? claim2 : claim1,
        revision: 0,
        skillId: s.skill_id.toLowerCase(),
        fields: {
          id: i ? claim2 : claim1,
          revision: 0,
          skillId: s.skill_id,
          definitionRevision: s.definition_revision,
          rank: 2,
          experienceMonths: 6,
          description: 'Rollback linked capability experience',
          projects: '',
          evidence: '',
          lastUsedOn: null,
        },
      }));
      const fields = {
        certificationName: 'Rollback multi-skill credential',
        provider: 'QA',
        category: 'QA',
        certificationDate: '2026-01-01',
        expiryDate: '2027-01-01',
        credentialId: 'QA-ID',
        credentialUrl: '',
        notes: '',
      };
      const command = {
        id,
        revision: 0,
        skills,
        certifications: [{ id: cert, revision: 0, fields, skillIds: skills.map(s => s.skillId) }],
      };
      const run = async (actor: string, operation: string, payload: object) => {
        const result = await new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .input('actor', sql.UniqueIdentifier, actor)
          .input('op', sql.VarChar(20), operation)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .query(
            `EXECUTE AS USER=N'skill_management_runtime';BEGIN TRY EXEC dbo.CapabilitySubmissionWorkspace @a,@actor,@op,@payload;REVERT;END TRY BEGIN CATCH REVERT;THROW;END CATCH;`,
          );
        return JSON.parse((result.recordsets as any[][]).flat().at(-1)?.json ?? '{}');
      };
      if (scenario.startsWith('discard-')) {
        const draft = await run(owner, 'INTAKE', {
          id,
          revision: 0,
          skills: [],
          certifications: [],
        });
        if (scenario === 'discard-foreign')
          await assert.rejects(
            run(outside, 'DISCARD', { id, revision: draft.revision }),
            (e: any) => e.number === 51003,
          );
        else if (scenario === 'discard-stale')
          await assert.rejects(
            run(owner, 'DISCARD', { id, revision: draft.revision + 1 }),
            (e: any) => e.number === 51009,
          );
        else {
          const removed = await run(owner, 'DISCARD', { id, revision: draft.revision });
          assert.equal(removed.status, 'DISCARDED');
          const retry = await run(owner, 'DISCARD', { id, revision: draft.revision });
          assert.equal(retry.revision, removed.revision);
          assert.ok(
            !(await run(owner, 'MINE', {})).records?.some((r: any) => r.id.toLowerCase() === id),
          );
          const restored = await run(owner, 'RESTORE', { id, revision: removed.revision });
          assert.equal(restored.status, 'DRAFT');
          assert.equal((await run(owner, 'GET', { id })).revision, restored.revision);
        }
        console.log('PASS rollback linked capabilities: ' + scenario);
        continue;
      }
      if (scenario === 'intake-file') {
        const draft = await run(owner, 'INTAKE', {
          id,
          revision: 0,
          skills: [],
          certifications: [
            {
              id: cert,
              revision: 0,
              reuse: false,
              fields: { ...fields, certificationName: '', certificationDate: '' },
              skillIds: [],
            },
          ],
        });
        assert.equal(draft.intake.certifications[0].fields.certificationName, '');
        const fileId = randomUUID();
        const payload = {
          id: fileId,
          revision: draft.revision,
          blobName: `${account}/certifications/${cert}/${fileId}`.toLowerCase(),
          bytes: 3,
          mimeType: 'application/pdf',
          fileName: 'rollback.pdf',
        };
        const staged = await new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .input('o', sql.UniqueIdentifier, owner)
          .input('i', sql.UniqueIdentifier, id)
          .input('c', sql.UniqueIdentifier, cert)
          .input('p', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .query(
            `EXECUTE AS USER=N'skill_management_runtime';BEGIN TRY EXEC dbo.CapabilityIntakeFiles @a,@o,@i,@c,'ADD',@p;REVERT;END TRY BEGIN CATCH REVERT;THROW;END CATCH;`,
          );
        command.revision = JSON.parse(staged.recordset[0].json).revision;
        const materialized = await run(owner, 'SAVE', command);
        assert.ok(!materialized.intake);
        assert.equal(materialized.certifications[0].hasImage, true);
        assert.equal((materialized.stagedFiles ?? []).length, 0);
        const submitted = await run(owner, 'SUBMIT', {
          id,
          revision: materialized.revision,
          skills: materialized.skills.map((r: any) => ({ id: r.id, revision: r.revision })),
          certifications: materialized.certifications.map((r: any) => ({
            id: r.id,
            revision: r.revision,
          })),
        });
        assert.equal(submitted.status, 'SUBMITTED');
        console.log('PASS rollback linked capabilities: ' + scenario);
        continue;
      }
      const saved = await run(owner, 'SAVE', command);
      assert.equal(saved.skills.length, 2);
      assert.equal(saved.certifications.length, 1);
      if (scenario === 'legacy-returned') {
        await new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .input('c', sql.UniqueIdentifier, cert)
          .input('e', sql.UniqueIdentifier, randomUUID())
          .query(
            "UPDATE dbo.CertificationRecord SET requires_skill_link=0,status='CHANGES_REQUESTED' WHERE account_id=@a AND id=@c;DELETE dbo.SkillCertificationLink WHERE account_id=@a AND certification_id=@c;INSERT dbo.CertificationImageRecord(account_id,certification_id,evidence_id,blob_name,bytes,width,height,active,mime_type,file_name) VALUES(@a,@c,@e,'rollback.pdf',3,NULL,NULL,1,'application/pdf','rollback.pdf');",
          );
        await assert.rejects(
          new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('o', sql.UniqueIdentifier, owner)
            .input(
              'p',
              sql.NVarChar(sql.MAX),
              JSON.stringify({ id: cert, revision: saved.certifications[0].revision }),
            )
            .query(
              "EXECUTE AS USER=N'skill_management_runtime';BEGIN TRY EXEC dbo.CertificationWorkspace @a,@o,'SUBMIT',@p;REVERT;END TRY BEGIN CATCH REVERT;THROW;END CATCH;",
            ),
          (e: any) => e.number === 51012,
        );
      } else if (scenario === 'standalone-block') {
        await assert.rejects(
          new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('c', sql.UniqueIdentifier, claim1)
            .query(
              "UPDATE dbo.SkillClaimDraft SET status='SUBMITTED' WHERE account_id=@a AND claim_id=@c",
            ),
          (e: any) => e.number === 51012,
        );
      } else if (scenario === 'foreign') {
        await assert.rejects(run(outside, 'GET', { id }), (e: any) => e.number === 51003);
      } else if (scenario === 'unlinked') {
        await new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .input('c', sql.UniqueIdentifier, cert)
          .query('DELETE dbo.SkillCertificationLink WHERE account_id=@a AND certification_id=@c');
        await assert.rejects(
          new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('c', sql.UniqueIdentifier, cert)
            .query(
              "UPDATE dbo.CertificationRecord SET status='SUBMITTED' WHERE account_id=@a AND id=@c",
            ),
          (e: any) => e.number === 51012,
        );
      } else {
        if (scenario !== 'missing-file')
          await new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('c', sql.UniqueIdentifier, cert)
            .input('e', sql.UniqueIdentifier, randomUUID())
            .query(
              "INSERT dbo.CertificationImageRecord(account_id,certification_id,evidence_id,blob_name,bytes,width,height,active,mime_type,file_name) VALUES(@a,@c,@e,'rollback.pdf',3,NULL,NULL,1,'application/pdf','rollback.pdf');UPDATE dbo.CertificationRecord SET revision=revision+1 WHERE account_id=@a AND id=@c",
            );
        const submit = {
          id,
          revision: saved.revision,
          skills: saved.skills.map((s: any) => ({ id: s.id, revision: s.revision })),
          certifications: saved.certifications.map((c: any) => ({
            id: c.id,
            revision: c.revision + (scenario === 'missing-file' ? 0 : 1),
          })),
        };
        if (scenario === 'stale') {
          submit.skills[0].revision--;
          await assert.rejects(run(owner, 'SUBMIT', submit), (e: any) => e.number === 51009);
        } else if (scenario === 'missing-file')
          await assert.rejects(run(owner, 'SUBMIT', submit), (e: any) => e.number === 51012);
        else {
          const submitted = await run(owner, 'SUBMIT', submit);
          assert.equal(submitted.status, 'SUBMITTED');
          assert.ok(submitted.skills.every((s: any) => s.status === 'SUBMITTED'));
          if (scenario === 'reroute') {
            await new sql.Request(tx)
              .input('a', sql.UniqueIdentifier, account)
              .input('o', sql.UniqueIdentifier, owner)
              .input('m', sql.UniqueIdentifier, outside)
              .query(
                'UPDATE dbo.AccessOrgAssignment SET manager_id=@m WHERE account_id=@a AND person_id=@o',
              );
            const ownerView = await run(owner, 'GET', { id });
            assert.equal(ownerView.canReroute, true);
            const rerouted = await run(owner, 'REROUTE', {
              id,
              revision: submitted.revision,
              skills: submitted.skills.map((r: any) => ({ id: r.id, revision: r.revision })),
              certifications: submitted.certifications.map((r: any) => ({
                id: r.id,
                revision: r.revision,
              })),
            });
            assert.equal(rerouted.reviewerId.toLowerCase(), outside);
            assert.equal((await run(outside, 'GET', { id })).status, 'SUBMITTED');
          } else if (scenario === 'manager-changed') {
            await new sql.Request(tx)
              .input('a', sql.UniqueIdentifier, account)
              .input('o', sql.UniqueIdentifier, owner)
              .input('m', sql.UniqueIdentifier, outside)
              .query(
                'UPDATE dbo.AccessOrgAssignment SET manager_id=@m WHERE account_id=@a AND person_id=@o',
              );
            await assert.rejects(run(manager, 'GET', { id }), (e: any) => e.number === 51003);
          } else if (scenario === 'incomplete-decision') {
            await assert.rejects(
              run(manager, 'DECIDE', {
                id,
                revision: submitted.revision,
                decisions: [
                  {
                    id: submitted.skills[0].id,
                    kind: 'SKILL',
                    revision: submitted.skills[0].revision,
                    action: 'APPROVE',
                    feedback: 'Incomplete batch',
                  },
                ],
              }),
              (e: any) => e.number === 51000,
            );
          } else {
            const queue = await run(manager, 'QUEUE', {});
            assert.ok(queue.records.some((r: any) => r.id.toLowerCase() === id));
            const decisions = [
              ...submitted.skills.map((s: any) => ({
                id: s.id,
                kind: 'SKILL',
                revision: s.revision,
                action: 'APPROVE',
                feedback: 'Reviewed skill experience',
              })),
              ...submitted.certifications.map((c: any) => ({
                id: c.id,
                kind: 'CERTIFICATION',
                revision: c.revision,
                action: scenario === 'publish-links' ? 'APPROVE' : 'REQUEST_CHANGES',
                feedback: 'Clarify issuer verification',
              })),
            ];
            const reviewed = await run(manager, 'DECIDE', {
              id,
              revision: submitted.revision,
              decisions,
            });
            assert.equal(reviewed.status, 'REVIEWED');
            assert.ok(reviewed.skills.every((s: any) => s.status === 'APPROVED'));
            assert.equal(
              reviewed.certifications[0].status,
              scenario === 'publish-links' ? 'APPROVED' : 'CHANGES_REQUESTED',
            );
            if (scenario === 'snapshot') {
              const corrected = {
                ...command,
                id: randomUUID(),
                revision: 0,
                skills: reviewed.skills.map((r: any) => ({
                  id: r.id,
                  revision: r.revision,
                  skillId: r.skillId,
                })),
                certifications: [
                  {
                    ...command.certifications[0],
                    revision: reviewed.certifications[0].revision,
                    fields: { ...fields, certificationName: 'Corrected later title' },
                  },
                ],
              };
              await run(owner, 'SAVE', corrected);
              const historical = await run(owner, 'GET', { id });
              assert.equal(
                historical.certifications[0].certificationName,
                fields.certificationName,
              );
              assert.equal(historical.certifications[0].status, 'CHANGES_REQUESTED');
              assert.equal(historical.certifications[0].relatedSkills.length, 2);
            }
            if (scenario === 'publish-links') {
              const reused = {
                id: randomUUID(),
                revision: 0,
                skills: reviewed.skills.map((r: any) => ({
                  id: r.id,
                  revision: r.revision,
                  skillId: r.skillId,
                })),
                certifications: [
                  {
                    id: cert,
                    revision: reviewed.certifications[0].revision,
                    skillIds: skills.map(s => s.skillId),
                  },
                ],
              };
              const linked = await run(owner, 'SAVE', reused);
              const published = await run(owner, 'PUBLISH_LINKS', {
                id: reused.id,
                revision: linked.revision,
                skills: linked.skills.map((r: any) => ({ id: r.id, revision: r.revision })),
                certifications: linked.certifications.map((r: any) => ({
                  id: r.id,
                  revision: r.revision,
                })),
              });
              assert.equal(published.status, 'LINKED');
              assert.ok(published.skills.every((r: any) => r.status === 'APPROVED'));
              assert.ok(published.reviewerId == null);
            }
          }
        }
      }
      console.log('PASS rollback linked capabilities: ' + scenario);
    } finally {
      if (!aborted) await tx.rollback();
    }
  }
});
