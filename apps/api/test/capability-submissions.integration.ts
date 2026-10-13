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
    'analytics-many-to-many',
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
    'renewal-approved',
    'renewal-returned',
    'renewal-expiry',
    'catalogue-read',
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
      const recoveryMetadata = await readFile(
        new URL(
          '../../../database/migrations/077_capability_draft_recovery_metadata.sql',
          import.meta.url,
        ),
        'utf8',
      );
      for (const batch of recoveryMetadata.split(/^GO\s*$/m))
        if (batch.trim()) await new sql.Request(tx).batch(batch);
      const queueTotals = await readFile(
        new URL(
          '../../../database/migrations/079_combined_review_queue_totals.sql',
          import.meta.url,
        ),
        'utf8',
      );
      for (const batch of queueTotals.split(/^GO\s*$/m))
        if (batch.trim()) await new sql.Request(tx).batch(batch);
      const renewalPortfolio = await readFile(
        new URL('../../../database/migrations/080_approved_renewal_portfolio.sql', import.meta.url),
        'utf8',
      );
      for (const batch of renewalPortfolio.split(/^GO\s*$/m))
        if (batch.trim()) await new sql.Request(tx).batch(batch);
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
      if (scenario === 'analytics-many-to-many')
        await new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .input('m', sql.UniqueIdentifier, manager)
          .query(
            "INSERT dbo.BusinessResponsibility VALUES(@a,NEWID(),@m,'BUSINESS_OPERATIONS','ORGANIZATION',NULL,'ALLOW',1,NULL,N'Rollback analytics fixture');",
          );
      const choices = (
        await new sql.Request(tx)
          .input('a', sql.UniqueIdentifier, account)
          .query(
            "SELECT TOP(2) c.skill_id,c.definition_revision FROM dbo.SkillCatalogue c JOIN dbo.SkillDefinitionVersion v ON v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision WHERE c.account_id=@a AND c.status='PUBLISHED' AND v.framework_id='00000000-0000-4000-8000-000000000003' ORDER BY c.skill_id",
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
      if (scenario.startsWith('renewal-')) fields.expiryDate = '2026-02-01';
      if (scenario === 'renewal-expiry') fields.expiryDate = new Date().toISOString().slice(0, 10);
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
      if (scenario === 'catalogue-read') {
        const choices = await run(owner, 'CATALOGUE', { search: 'Oracle', page: 1 });
        assert.ok(choices.total > 0);
        assert.ok(choices.credentials.length > 0 && choices.credentials.length <= 10);
        assert.ok(
          choices.credentials.every(
            (c: any) => c.name && c.provider && c.relatedSkills.length <= 10,
          ),
        );
        assert.ok(!('claims' in choices) && !('certifications' in choices));
        await assert.rejects(
          run(owner, 'CATALOGUE', { search: 'Oracle', page: 1, personId: outside }),
          (e: any) => e.number === 51000,
        );
        console.log('PASS rollback linked capabilities: ' + scenario);
        continue;
      }
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
      if (scenario === 'analytics-many-to-many')
        command.certifications.push({
          id: randomUUID(),
          revision: 0,
          fields: {
            ...fields,
            certificationName: 'Rollback second credential',
            credentialId: 'QA-ID-2',
          },
          skillIds: skills.map(s => s.skillId),
        });
      const saved = await run(owner, 'SAVE', command);
      assert.equal(saved.skills.length, 2);
      assert.equal(saved.certifications.length, command.certifications.length);
      const reopened = await run(owner, 'GET', { id });
      assert.equal(reopened.skills[0].levels.length, 4);
      assert.deepEqual(
        reopened.skills[0].levels.map((v: any) => v.name),
        ['Foundation', 'Autonomous', 'Experienced', 'Expert'],
      );
      assert.ok(reopened.skills[0].levels.every((v: any) => v.description.length > 0));
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
          for (const certificate of command.certifications)
            await new sql.Request(tx)
              .input('a', sql.UniqueIdentifier, account)
              .input('c', sql.UniqueIdentifier, certificate.id)
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
          if (scenario === 'analytics-many-to-many')
            for (const certificate of command.certifications) {
              const files = await new sql.Request(tx)
                .input('a', sql.UniqueIdentifier, account)
                .input('m', sql.UniqueIdentifier, manager)
                .input('c', sql.UniqueIdentifier, certificate.id)
                .query("EXEC dbo.BusinessRecordFiles @a,@m,'certifications',@c;");
              assert.equal(JSON.parse(files.recordset[0].json).items.length, 1);
            }

          const notifications = await new sql.Request(tx)
            .input('a', sql.UniqueIdentifier, account)
            .input('m', sql.UniqueIdentifier, manager)
            .query('EXEC dbo.ReadCapabilitySubmissionNotifications @a,@m;');
          assert.equal(
            notifications.recordset.filter((row: any) => row.href.toLowerCase().endsWith(id))
              .length,
            1,
          );

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
            const queueRecord = queue.records.find((r: any) => r.id.toLowerCase() === id);
            assert.ok(queueRecord);
            assert.equal(queueRecord.total, 1);
            assert.equal(queueRecord.personId.toLowerCase(), owner);
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
                action: [
                  'publish-links',
                  'analytics-many-to-many',
                  'renewal-approved',
                  'renewal-returned',
                  'renewal-expiry',
                ].includes(scenario)
                  ? 'APPROVE'
                  : 'REQUEST_CHANGES',
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
              [
                'publish-links',
                'analytics-many-to-many',
                'renewal-approved',
                'renewal-returned',
                'renewal-expiry',
              ].includes(scenario)
                ? 'APPROVED'
                : 'CHANGES_REQUESTED',
            );
            if (scenario === 'analytics-many-to-many') {
              const counts = await new sql.Request(tx)
                .input('a', sql.UniqueIdentifier, account)
                .input('o', sql.UniqueIdentifier, owner)
                .query(`SELECT COUNT(*) AS links FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft c ON c.account_id=l.account_id AND c.claim_id=l.claim_id WHERE l.account_id=@a AND c.person_id=@o;
                SELECT COUNT(*) AS skills FROM dbo.SkillClaimDraft WHERE account_id=@a AND person_id=@o AND status='APPROVED';
                SELECT COUNT(*) AS certificates FROM dbo.CertificationRecord WHERE account_id=@a AND person_id=@o AND status='APPROVED';`);
              assert.equal((counts.recordsets as any)[0][0].links, 4);
              assert.equal((counts.recordsets as any)[1][0].skills, 2);
              assert.equal((counts.recordsets as any)[2][0].certificates, 2);
              await new sql.Request(tx)
                .input('a', sql.UniqueIdentifier, account)
                .input('m', sql.UniqueIdentifier, manager)
                .query(
                  "INSERT dbo.BusinessResponsibility VALUES(@a,NEWID(),@m,'BUSINESS_OPERATIONS','ORGANIZATION',NULL,'ALLOW',1,NULL,N'Rollback analytics fixture');",
                );
              const analytics = await new sql.Request(tx)
                .input('a', sql.UniqueIdentifier, account)
                .input('m', sql.UniqueIdentifier, manager)
                .input(
                  'p',
                  sql.NVarChar(sql.MAX),
                  JSON.stringify({
                    dataset: 'certifications',
                    status: 'APPROVED',
                    search: owner,
                    minRank: 1,
                    maxRank: 4,
                    page: 1,
                    sort: 'updated_desc',
                  }),
                )
                .query('EXEC dbo.BusinessDashboard @a,@m,@p,0;');
              const facts = JSON.parse(analytics.recordset[0].json);
              assert.equal(facts.summary.employees, 1);
              assert.equal(facts.summary.certified, 1);
              assert.equal(facts.summary.skilled, 1);
              assert.equal(facts.total, 2);
              assert.equal(facts.rows.length, 2);
              assert.equal(facts.distribution.find((v: any) => v.label === 'QA').value, 2);
            }
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
              const resaved = await run(owner, 'SAVE', corrected);
              const historical = await run(owner, 'GET', { id });
              assert.equal(
                historical.certifications[0].certificationName,
                fields.certificationName,
              );
              assert.equal(historical.certifications[0].status, 'CHANGES_REQUESTED');
              assert.equal(historical.certifications[0].relatedSkills.length, 2);
              const resubmitted = await run(owner, 'SUBMIT', {
                id: corrected.id,
                revision: resaved.revision,
                skills: resaved.skills.map((row: any) => ({ id: row.id, revision: row.revision })),
                certifications: resaved.certifications.map((row: any) => ({
                  id: row.id,
                  revision: row.revision,
                })),
              });
              assert.ok(
                resubmitted.skills.every(
                  (row: any) => row.status === 'APPROVED' && !row.needsReview,
                ),
              );
              const complete = await run(manager, 'DECIDE', {
                id: corrected.id,
                revision: resubmitted.revision,
                decisions: resubmitted.certifications.map((row: any) => ({
                  id: row.id,
                  kind: 'CERTIFICATION',
                  revision: row.revision,
                  action: 'APPROVE',
                  feedback: 'Corrected credential reviewed',
                })),
              });
              assert.equal(complete.certifications[0].status, 'APPROVED');
              assert.equal(
                (await run(owner, 'GET', { id })).certifications[0].status,
                'CHANGES_REQUESTED',
              );
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
            if (scenario.startsWith('renewal-')) {
              const nextId = randomUUID(),
                nextCert = randomUUID();
              const next = await run(owner, 'SAVE', {
                id: nextId,
                revision: 0,
                skills: reviewed.skills.map((s: any) => ({
                  id: s.id,
                  revision: s.revision,
                  skillId: s.skillId,
                })),
                certifications: [
                  {
                    id: nextCert,
                    revision: 0,
                    renewedFromId: cert,
                    fields: {
                      ...fields,
                      certificationDate: new Date().toISOString().slice(0, 10),
                      expiryDate: '2028-01-01',
                      credentialId: 'QA-NEW-ID',
                    },
                    skillIds: skills.map(s => s.skillId),
                  },
                ],
              });
              await new sql.Request(tx)
                .input('a', sql.UniqueIdentifier, account)
                .input('c', sql.UniqueIdentifier, nextCert)
                .input('e', sql.UniqueIdentifier, randomUUID())
                .query(
                  "INSERT dbo.CertificationImageRecord(account_id,certification_id,evidence_id,blob_name,bytes,width,height,active,mime_type,file_name) VALUES(@a,@c,@e,'renewed.pdf',3,NULL,NULL,1,'application/pdf','renewed.pdf');UPDATE dbo.CertificationRecord SET revision=revision+1 WHERE account_id=@a AND id=@c",
                );
              const nextSubmitted = await run(owner, 'SUBMIT', {
                id: nextId,
                revision: next.revision,
                skills: next.skills.map((s: any) => ({ id: s.id, revision: s.revision })),
                certifications: next.certifications.map((c: any) => ({
                  id: c.id,
                  revision: c.revision + 1,
                })),
              });
              const before = await new sql.Request(tx)
                .input('a', sql.UniqueIdentifier, account)
                .input('c', sql.UniqueIdentifier, cert)
                .query(
                  'SELECT supersededById,activeRenewalId FROM dbo.CertificationPortfolio WHERE account_id=@a AND id=@c',
                );
              assert.equal(before.recordset[0].supersededById, null);
              assert.equal(before.recordset[0].activeRenewalId.toLowerCase(), nextCert);
              const approvedRenewal = scenario !== 'renewal-returned';
              await run(manager, 'DECIDE', {
                id: nextId,
                revision: nextSubmitted.revision,
                decisions: nextSubmitted.certifications.map((c: any) => ({
                  id: c.id,
                  kind: 'CERTIFICATION',
                  revision: c.revision,
                  action: approvedRenewal ? 'APPROVE' : 'REQUEST_CHANGES',
                  feedback: 'Renewal dates and new ID checked',
                })),
              });
              const after = await new sql.Request(tx)
                .input('a', sql.UniqueIdentifier, account)
                .input('o', sql.UniqueIdentifier, owner)
                .query(
                  "SELECT id,supersededById,credential_id FROM dbo.CertificationPortfolio WHERE account_id=@a AND person_id=@o; SELECT id FROM dbo.CurrentCertificationRecord WHERE account_id=@a AND person_id=@o AND status='APPROVED'",
                );
              const sets = after.recordsets as any[][];
              assert.equal(sets[0].length, 2);
              const old = sets[0].find((c: any) => c.id.toLowerCase() === cert);
              assert.equal(
                old.supersededById?.toLowerCase() ?? null,
                approvedRenewal ? nextCert : null,
              );
              assert.equal(sets[1].length, 1);
              assert.equal(sets[1][0].id.toLowerCase(), approvedRenewal ? nextCert : cert);
              const analytics = await new sql.Request(tx)
                .input('account_id', sql.UniqueIdentifier, account)
                .input('actor_id', sql.UniqueIdentifier, manager)
                .execute('dbo.CertificationReviewAnalytics');
              assert.equal(analytics.recordset[0].reviewed, 1);
              assert.equal(analytics.recordset[0].expired, approvedRenewal ? 0 : 1);
              const notes = await new sql.Request(tx)
                .input('account_id', sql.UniqueIdentifier, account)
                .input('actor_id', sql.UniqueIdentifier, owner)
                .execute('dbo.ReadCapabilitySubmissionNotifications');
              assert.ok(
                notes.recordset.some(
                  (n: any) =>
                    n.href.toLowerCase().endsWith(nextId) &&
                    n.actorName === 'Linked QA manager' &&
                    n.body.includes(approvedRenewal ? '1 approved' : '1 changes requested'),
                ),
              );
              const expiryNotes = await new sql.Request(tx)
                .input('account_id', sql.UniqueIdentifier, account)
                .input('actor_id', sql.UniqueIdentifier, owner)
                .execute('dbo.CertificationExpiryNotifications');
              assert.ok(
                !expiryNotes.recordset.some((n: any) => n.href.toLowerCase().endsWith(cert)),
              );
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
