// Opt-in DEVELOPMENT ONLY. All synthetic data, grants, DDL and procedures roll back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
import { businessQuery } from '../src/modules/business/business.js';
assert.equal(
  process.env.RUN_BUSINESS_SQL_TESTS,
  '1',
  'Explicitly set RUN_BUSINESS_SQL_TESTS=1 for rollback verification.',
);
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
const migrations = await Promise.all(
  [
    '060_business_operations.sql',
    '061_business_workflows.sql',
    '062_business_audit_reliability.sql',
    '063_credential_renewal_reliability.sql',
    '064_business_workflow_recovery.sql',
  ].map(file => readFile(new URL('../../../database/migrations/' + file, import.meta.url), 'utf8')),
);
await withDatabase(async pool => {
  const info = (
    await pool
      .request()
      .query('SELECT DB_NAME() AS name,(SELECT MAX(version) FROM dbo.SchemaMigration) AS version')
  ).recordset[0];
  assert.match(info.name, /(?:^|-)dev$/i, 'Never run this fixture against a production database.');
  assert.ok(info.version >= 58);
  const scenarios = [
    'scope-and-personal',
    'organization-boundary',
    'organization-runtime-boundary',
    'renewal-validity',
    'renewal-conflict',
    'workflow-and-matching',
    'scoped-deny',
    'foreign-scope',
    'stale-preview',
    'inactive-actor',
    'individual-deny',
    'inactive-member',
    'stale-master',
    'responsibility-policy',
    'scope-lifecycle',
    'administration-lockout',
    'administration-profile-denied',
  ] as const;
  const selected = process.env.BUSINESS_SQL_SCENARIO;
  assert.ok(!selected || scenarios.some(s => s === selected), 'Unknown SQL scenario.');
  for (const scenario of scenarios.filter(s => !selected || s === selected)) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let rolledBack = false;
    tx.on('rollback', () => {
      rolledBack = true;
    });
    try {
      for (let i = 0; i < migrations.length; i++)
        if (info.version < 60 + i)
          for (const batch of migrations[i].split(/^GO\s*$/m))
            if (batch.trim()) await new sql.Request(tx).batch(batch);
      const ids = Object.fromEntries(
        [
          'admin',
          'lead',
          'alice',
          'bob',
          'dana',
          'inactive',
          'outside',
          'a',
          'b',
          'ga',
          'gb',
          'certA',
          'certB',
          'draft',
          'skill',
          'claimA',
          'claimB',
        ].map(k => [k, randomUUID()]),
      );
      let req = new sql.Request(tx).input('account', sql.UniqueIdentifier, account);
      for (const [name, id] of Object.entries(ids)) req = req.input(name, sql.UniqueIdentifier, id);
      await req.query(`
    UPDATE dbo.AccessWorkspace SET personal_baseline_enabled=1 WHERE account_id=@account;
    INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) SELECT @account,id,name,'BQA-'+CONVERT(varchar(36),id),active FROM (VALUES(@admin,N'BQA Admin',1),(@lead,N'BQA Lead without reports',1),(@alice,N'BQA Alice',1),(@bob,N'BQA Bob',1),(@dana,N'BQA Dana',1),(@inactive,N'BQA Inactive',0),(@outside,N'BQA Outside',1)) p(id,name,active);
    INSERT dbo.AccessOrgAssignment(account_id,person_id,manager_id) SELECT @account,id,NULL FROM (VALUES(@admin),(@lead),(@alice),(@bob),(@dana),(@inactive),(@outside)) p(id);
    INSERT dbo.BusinessProject VALUES(@account,@a,N'BQA A '+CONVERT(varchar(36),@a),NULL,1),(@account,@b,N'BQA B '+CONVERT(varchar(36),@b),NULL,1);
    INSERT dbo.BusinessProjectMember VALUES(@account,@a,@alice,1),(@account,@b,@alice,1),(@account,@b,@bob,1),(@account,@a,@dana,1),(@account,@a,@inactive,1);
    INSERT dbo.BusinessResponsibility VALUES(@account,NEWID(),@admin,'SYSTEM_ADMIN','ORGANIZATION',NULL,'ALLOW',1,NULL,N'Rollback fixture'),(@account,@ga,@lead,'BUSINESS_OPERATIONS','PROJECT',@a,'ALLOW',1,NULL,N'Rollback fixture'),(@account,@gb,@lead,'BUSINESS_OPERATIONS','PROJECT',@b,'ALLOW',1,NULL,N'Rollback fixture');
    INSERT dbo.CertificationRecord(account_id,id,person_id,revision,certification_name,provider,category,issue_date,expiry_date,credential_id,credential_url,notes,status,submitted_at,reviewed_at)
    VALUES(@account,@certA,@alice,1,N'BQA Credential',N'BQA Provider',N'Cloud',DATEADD(day,-30,CONVERT(date,SYSUTCDATETIME())),DATEADD(day,10,CONVERT(date,SYSUTCDATETIME())),'','','private notes must not escape','APPROVED',SYSUTCDATETIME(),SYSUTCDATETIME()),
    (@account,@certB,@bob,1,N'BQA Credential',N'BQA Provider',N'Cloud',DATEADD(day,-30,CONVERT(date,SYSUTCDATETIME())),DATEADD(day,-1,CONVERT(date,SYSUTCDATETIME())),'','','private notes must not escape','APPROVED',SYSUTCDATETIME(),SYSUTCDATETIME()),
    (@account,@draft,@alice,1,N'Hidden draft',N'BQA Provider',N'Cloud',CONVERT(date,SYSUTCDATETIME()),NULL,'','','private draft','DRAFT',NULL,NULL);
    DECLARE @auditBase int=(SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account);
    INSERT dbo.AccessAudit(account_id,revision,actor_id,target_id,action,after_json)
    SELECT @account,@auditBase+ROW_NUMBER() OVER(ORDER BY c.id,e.action),c.person_id,c.id,e.action,(SELECT c.person_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)
    FROM dbo.CertificationRecord c CROSS JOIN (VALUES('certification.submitted'),('certification.approved')) e(action) WHERE c.account_id=@account AND c.id IN(@certA,@certB);
    UPDATE dbo.AccessWorkspace SET revision=@auditBase+4 WHERE account_id=@account;
   `);
      const execute = async (
        procedure: string,
        actor: string,
        payload?: object,
        operation?: string,
      ): Promise<sql.IResult<{ json: string }>> => {
        let r: sql.Request = new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('actor', sql.UniqueIdentifier, actor);
        if (payload) r = r.input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload));
        if (operation) r = r.input('operation', sql.VarChar(30), operation);
        return r.query(
          `EXECUTE AS USER=N'skill_management_runtime'; BEGIN TRY EXEC dbo.${procedure} @account_id=@account,@actor_id=@actor${payload ? ',@payload=@payload' : ''}${operation ? ',@operation=@operation' : ''}; REVERT;END TRY BEGIN CATCH REVERT;THROW;END CATCH;`,
        );
      };
      const recover = async (
        actor: string,
        operation: string,
        payload: Record<string, unknown>,
      ) => {
        const { accessRevision: _access, ...command } = payload;
        return JSON.parse(
          (await execute('BusinessWorkflowRecovery', actor, command, operation)).recordset[0].json,
        );
      };
      const read = async (scopeId?: string) =>
        JSON.parse(
          (
            await execute(
              'BusinessDashboard',
              ids.lead,
              businessQuery({ dataset: 'certifications', ...(scopeId ? { scopeId } : {}) }),
            )
          ).recordset[0].json,
        );
      if (scenario === 'organization-boundary' || scenario === 'organization-runtime-boundary') {
        const foreignAccount = randomUUID(),
          foreignPerson = randomUUID(),
          organizationGrant = randomUUID();
        const boundaryRequest = (): sql.Request =>
          new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('foreign', sql.UniqueIdentifier, foreignAccount)
            .input('foreignPerson', sql.UniqueIdentifier, foreignPerson)
            .input('lead', sql.UniqueIdentifier, ids.lead)
            .input('org', sql.UniqueIdentifier, organizationGrant)
            .input('a', sql.UniqueIdentifier, ids.a)
            .input('alice', sql.UniqueIdentifier, ids.alice)
            .input('bob', sql.UniqueIdentifier, ids.bob)
            .input('inactive', sql.UniqueIdentifier, ids.inactive);
        await boundaryRequest().query(`
          INSERT dbo.Account(account_id,account_code,display_name,entra_tenant_id,status)
          VALUES(@foreign,'BQA-foreign-'+CONVERT(varchar(36),@foreign),N'Foreign fixture',NEWID(),'ACTIVE');
          INSERT dbo.AccessWorkspace(account_id,revision) VALUES(@foreign,1);
          INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active)
          VALUES(@foreign,@foreignPerson,N'Foreign employee','BQA-'+CONVERT(varchar(36),@foreignPerson),1);
          UPDATE dbo.BusinessResponsibility SET active=0 WHERE account_id=@account AND person_id=@lead;
          INSERT dbo.BusinessResponsibility VALUES(@account,@org,@lead,'BUSINESS_OPERATIONS','ORGANIZATION',NULL,'ALLOW',1,NULL,N'Fixture');
        `);
        const flags = async (): Promise<Record<string, boolean | number>> =>
          (
            await boundaryRequest().query(`
          SELECT dbo.BusinessScopeValid(@account,'ORGANIZATION',NULL) AS valid,
            dbo.BusinessScopeValid(@account,'ORGANIZATION',@a) AS invalidBinding,
            dbo.BusinessScopeValid(NEWID(),'ORGANIZATION',NULL) AS unknownAccount,
            dbo.BusinessScopeMatches(@account,@alice,'ORGANIZATION',NULL) AS ownMember,
            dbo.BusinessScopeMatches(@account,@foreignPerson,'ORGANIZATION',NULL) AS foreignMember,
            dbo.BusinessScopeMatches(@account,@inactive,'ORGANIZATION',NULL) AS inactiveMember,
            dbo.BusinessScopeMatches(@account,@alice,'ORGANIZATION',@a) AS invalidMatch,
            (SELECT COUNT(*) FROM dbo.BusinessScopePeople(@account,'ORGANIZATION',@a)) AS invalidPeople,
            dbo.BusinessCan(@account,@lead,@alice,NULL) AS aliceAllowed,
            dbo.BusinessCan(@account,@lead,@bob,NULL) AS bobAllowed,
            dbo.BusinessCan(@account,@lead,@foreignPerson,NULL) AS foreignAllowed;
        `)
          ).recordset[0];
        assert.deepEqual(await flags(), {
          valid: true,
          invalidBinding: false,
          unknownAccount: false,
          ownMember: true,
          foreignMember: false,
          inactiveMember: false,
          invalidMatch: false,
          invalidPeople: 0,
          aliceAllowed: true,
          bobAllowed: true,
          foreignAllowed: false,
        });
        const readOrganization = async () =>
          JSON.parse(
            (
              await execute(
                'BusinessDashboard',
                ids.lead,
                businessQuery({ dataset: 'certifications', search: 'BQA' }),
              )
            ).recordset[0].json,
          );
        const result = await readOrganization();
        assert.equal(result.total, 2);
        assert.ok(!JSON.stringify(result).includes(foreignPerson));
        assert.ok(!JSON.stringify(result).includes(ids.inactive));
        if (scenario === 'organization-runtime-boundary') {
          await assert.rejects(
            boundaryRequest().query(`EXECUTE AS USER=N'skill_management_runtime';
              BEGIN TRY EXEC dbo.BusinessContext @account_id=@foreign,@actor_id=@foreignPerson; REVERT;
              END TRY BEGIN CATCH REVERT;THROW;END CATCH;`),
            e => (e as { number: number }).number === 51003,
          );
        } else {
          await boundaryRequest().query(
            `INSERT dbo.BusinessResponsibility VALUES(@account,NEWID(),@lead,'BUSINESS_OPERATIONS','PROJECT',@a,'DENY',1,DATEADD(hour,1,SYSUTCDATETIME()),N'Fixture');`,
          );
          const denied = await flags();
          assert.equal(denied.aliceAllowed, false);
          assert.equal(denied.bobAllowed, true);
          assert.equal((await readOrganization()).total, 1);
          await boundaryRequest().query(
            "UPDATE dbo.Account SET status='SUSPENDED' WHERE account_id=@account;",
          );
          assert.equal((await flags()).valid, false);
          const count: number = (
            await boundaryRequest().query(
              "SELECT COUNT(*) AS people FROM dbo.BusinessScopePeople(@account,'ORGANIZATION',NULL)",
            )
          ).recordset[0].people;
          assert.equal(count, 0);
          await assert.rejects(read(), e => (e as { number: number }).number === 51003);
        }
      } else if (scenario === 'renewal-validity' || scenario === 'renewal-conflict') {
        const request = (): sql.Request =>
          new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('actor', sql.UniqueIdentifier, ids.alice)
            .input('source', sql.UniqueIdentifier, ids.certA)
            .input('renewal', sql.UniqueIdentifier, ids.draft);
        const notifications = async (): Promise<any[]> =>
          (
            await request().query(
              "EXECUTE AS USER=N'skill_management_runtime';EXEC dbo.CertificationExpiryNotifications @account,@actor;REVERT;",
            )
          ).recordset;
        assert.equal(
          (await notifications()).find((r: any) => r.id.toLowerCase().includes(ids.certA)).href,
          '/certifications?renew=' + ids.certA,
        );
        const validity: { expired: boolean; unrelated: boolean; permanent: boolean } = (
          await request().query(
            "SELECT dbo.CertificationRenewalValid(@account,@source,@actor,N'BQA Credential',N'BQA Provider',CONVERT(date,SYSUTCDATETIME()),DATEADD(day,-1,CONVERT(date,SYSUTCDATETIME()))) AS expired,dbo.CertificationRenewalValid(@account,@source,@actor,N'Other credential',N'BQA Provider',CONVERT(date,SYSUTCDATETIME()),NULL) AS unrelated,dbo.CertificationRenewalValid(@account,@source,@actor,N'BQA Credential',N'BQA Provider',CONVERT(date,SYSUTCDATETIME()),NULL) AS permanent",
          )
        ).recordset[0];
        assert.equal(validity.expired, false);
        assert.equal(validity.unrelated, false);
        assert.equal(validity.permanent, true);
        await request().query(
          "UPDATE dbo.CertificationRecord SET certification_name=N'BQA Credential',provider=N'BQA Provider',expiry_date=DATEADD(day,90,CONVERT(date,SYSUTCDATETIME())) WHERE account_id=@account AND id=@renewal;EXECUTE AS USER=N'skill_management_runtime';EXEC dbo.LinkCertificationRenewal @account,@actor,@renewal,@source;REVERT;",
        );
        if (scenario === 'renewal-validity') {
          assert.ok(
            (await notifications()).some((r: any) => r.id.toLowerCase().includes(ids.certA)),
          );
          await request().query(
            "UPDATE dbo.CertificationRecord SET status='SUBMITTED' WHERE account_id=@account AND id=@renewal;",
          );
          assert.equal(
            (await notifications()).some((r: any) => r.id.toLowerCase().includes(ids.certA)),
            false,
          );
          await request().query(
            'UPDATE dbo.CertificationRecord SET issue_date=DATEADD(day,-30,CONVERT(date,SYSUTCDATETIME())),expiry_date=DATEADD(day,-1,CONVERT(date,SYSUTCDATETIME())) WHERE account_id=@account AND id=@renewal;',
          );
          assert.ok(
            (await notifications()).some((r: any) => r.id.toLowerCase().includes(ids.certA)),
          );
          await request().query(
            "UPDATE dbo.CertificationRecord SET status='CHANGES_REQUESTED' WHERE account_id=@account AND id=@renewal;",
          );
          await assert.rejects(
            execute(
              'CertificationWorkspace',
              ids.alice,
              {
                id: ids.draft,
                revision: 1,
                fields: {
                  certificationName: 'BQA Credential',
                  provider: 'BQA Provider',
                  category: 'Cloud',
                  certificationDate: new Date().toISOString().slice(0, 10),
                  expiryDate: new Date().toISOString().slice(0, 10),
                  credentialId: '',
                  credentialUrl: '',
                  notes: '',
                },
              },
              'SAVE',
            ),
            (e: any) => e.number === 51013,
          );
        } else {
          await request().query(
            "UPDATE dbo.CertificationRecord SET status='CHANGES_REQUESTED' WHERE account_id=@account AND id=@renewal;",
          );
          await request()
            .input('second', sql.UniqueIdentifier, randomUUID())
            .query(
              "INSERT dbo.CertificationRecord(account_id,id,person_id,revision,certification_name,provider,category,issue_date,expiry_date,credential_id,credential_url,notes,status) SELECT account_id,@second,person_id,1,certification_name,provider,category,issue_date,expiry_date,'','','','DRAFT' FROM dbo.CertificationRecord WHERE account_id=@account AND id=@renewal;EXECUTE AS USER=N'skill_management_runtime';EXEC dbo.LinkCertificationRenewal @account,@actor,@second,@source;REVERT;",
            );
          await assert.rejects(
            execute(
              'CertificationWorkspace',
              ids.alice,
              {
                id: ids.draft,
                revision: 1,
                fields: {
                  certificationName: 'BQA Credential',
                  provider: 'BQA Provider',
                  category: 'Cloud',
                  certificationDate: new Date().toISOString().slice(0, 10),
                  expiryDate: null,
                  credentialId: '',
                  credentialUrl: '',
                  notes: '',
                },
              },
              'SAVE',
            ),
            (e: any) => [2601, 2627].includes(e.number),
          );
        }
      } else if (scenario === 'scope-and-personal') {
        const result = await read();
        assert.equal(result.summary.employees, 3);
        assert.equal(result.summary.certified, 1);
        assert.equal(result.summary.expired, 1);
        assert.equal(result.total, 2);
        assert.ok(!JSON.stringify(result).includes('private'));
        assert.ok(
          result.activity.length > 0,
          'Blank activity dates must not filter everything out.',
        );
        const policy: { profile: boolean; claim: boolean; review: boolean; amend: boolean } = (
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('lead', sql.UniqueIdentifier, ids.lead)
            .input('person', sql.UniqueIdentifier, ids.outside)
            .query(
              "SELECT dbo.AccessCan(@account,@person,'profile.view',1) AS profile,dbo.AccessCan(@account,@person,'skill.claim',1) AS claim,dbo.AccessCan(@account,@lead,'skill.verify',0) AS review,dbo.BusinessAmendCan(@account,@lead) AS amend",
            )
        ).recordset[0];
        assert.equal(policy.profile, true);
        assert.equal(policy.claim, true);
        assert.equal(policy.review, false);
        assert.equal(policy.amend, true);
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('alice', sql.UniqueIdentifier, ids.alice)
          .input('a', sql.UniqueIdentifier, ids.a)
          .input('ga', sql.UniqueIdentifier, ids.ga)
          .query(
            'UPDATE dbo.BusinessProjectMember SET active=0 WHERE account_id=@account AND project_id=@a AND person_id=@alice;UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account;',
          );
        assert.equal((await read(ids.ga)).summary.employees, 1);
      } else if (scenario === 'workflow-and-matching') {
        const revision = async (): Promise<number> =>
          Number(
            (
              await new sql.Request(tx)
                .input('account', sql.UniqueIdentifier, account)
                .query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account')
            ).recordset[0].revision,
          );
        const providerRequest = randomUUID();
        let rev: number = await revision();
        const proposeProvider = {
          id: providerRequest,
          revision: rev,
          accessRevision: rev,
          type: 'PROVIDER',
          isNew: true,
          targetId: null,
          reason: 'Fixture',
          definition: { name: 'BQA Provider', active: true },
        };
        await execute('BusinessWorkflow', ids.lead, proposeProvider, 'PROPOSE');
        assert.equal((await recover(ids.lead, 'PROPOSE', proposeProvider)).replayed, true);
        await execute('BusinessWorkflow', ids.lead, proposeProvider, 'PROPOSE');
        rev = await revision();
        await execute(
          'BusinessWorkflow',
          ids.admin,
          { id: providerRequest, revision: 1, accessRevision: rev, note: 'Reviewed' },
          'APPROVE_AMENDMENT',
        );
        rev = await revision();
        await execute(
          'BusinessWorkflow',
          ids.admin,
          { id: providerRequest, revision: 1, accessRevision: rev, note: 'Reviewed' },
          'APPROVE_AMENDMENT',
        );
        assert.equal(
          (
            await recover(ids.admin, 'APPROVE_AMENDMENT', {
              id: providerRequest,
              revision: 1,
              note: 'Reviewed',
            })
          ).replayed,
          true,
        );
        const provider = (
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('id', sql.UniqueIdentifier, providerRequest)
            .query(
              'SELECT target_id AS id FROM dbo.MasterAmendment WHERE account_id=@account AND id=@id',
            )
        ).recordset[0].id;
        const certificationRequest = randomUUID();
        rev = await revision();
        await execute(
          'BusinessWorkflow',
          ids.lead,
          {
            id: certificationRequest,
            revision: rev,
            accessRevision: rev,
            type: 'CERTIFICATION',
            isNew: true,
            targetId: null,
            reason: 'Fixture',
            definition: {
              name: 'BQA Credential',
              providerId: provider,
              category: 'Cloud',
              description: 'QA',
              active: true,
            },
          },
          'PROPOSE',
        );
        rev = await revision();
        await execute(
          'BusinessWorkflow',
          ids.admin,
          { id: certificationRequest, revision: 1, accessRevision: rev, note: 'Reviewed' },
          'APPROVE_AMENDMENT',
        );
        const masterOptions = JSON.parse(
          (await execute('BusinessWorkflow', ids.lead, { page: 1, search: 'BQA' }, 'MASTERS'))
            .recordset[0].json,
        );
        assert.equal(masterOptions.providerTotal, 1);
        assert.equal(masterOptions.certificationTotal, 1);
        assert.equal(masterOptions.pageSize, 25);
        const definition = (
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('id', sql.UniqueIdentifier, certificationRequest)
            .query(
              'SELECT target_id AS id FROM dbo.MasterAmendment WHERE account_id=@account AND id=@id',
            )
        ).recordset[0].id;
        const skillRequest = randomUUID();
        rev = await revision();
        await execute(
          'BusinessWorkflow',
          ids.lead,
          {
            id: skillRequest,
            revision: rev,
            accessRevision: rev,
            type: 'SKILL',
            isNew: true,
            targetId: null,
            reason: 'Fixture skill',
            definition: {
              name: 'BQA Cloud skill',
              category: 'Cloud',
              description: 'Canonical architecture skill',
              active: true,
              status: 'PUBLISHED',
              levels: ['Awareness', 'Foundation', 'Practitioner', 'Advanced', 'Expert'].map(
                (name, index) => ({
                  rank: index + 1,
                  name,
                  description: 'Criteria ' + (index + 1),
                }),
              ),
            },
          },
          'PROPOSE',
        );
        rev = await revision();
        await execute(
          'BusinessWorkflow',
          ids.admin,
          { id: skillRequest, revision: 1, accessRevision: rev, note: 'Review five criteria' },
          'APPROVE_AMENDMENT',
        );
        const skillMaster = (
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('id', sql.UniqueIdentifier, skillRequest)
            .query(
              'SELECT m.target_id AS id,s.definition_revision AS version FROM dbo.MasterAmendment m JOIN dbo.SkillCatalogue s ON s.account_id=m.account_id AND s.skill_id=m.target_id WHERE m.account_id=@account AND m.id=@id',
            )
        ).recordset[0];
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('skill', sql.UniqueIdentifier, skillMaster.id)
          .input('version', sql.Int, skillMaster.version)
          .input('alice', sql.UniqueIdentifier, ids.alice)
          .input('bob', sql.UniqueIdentifier, ids.bob)
          .query(
            "INSERT dbo.SkillClaimDraft(account_id,claim_id,person_id,skill_id,revision,definition_revision,skill_name,category,claimed_rank,level_name,level_description,experience_months,description,status,submitted_at,reviewed_at) VALUES(@account,NEWID(),@alice,@skill,1,@version,N'BQA Cloud skill',N'Cloud',3,N'Practitioner',N'Criteria 3',24,N'private experience','APPROVED',SYSUTCDATETIME(),SYSUTCDATETIME()),(@account,NEWID(),@bob,@skill,1,@version,N'BQA Cloud skill',N'Cloud',2,N'Foundation',N'Criteria 2',12,N'private experience','APPROVED',SYSUTCDATETIME(),SYSUTCDATETIME())",
          );
        const skillChoices = JSON.parse(
          (
            await execute(
              'BusinessWorkflow',
              ids.lead,
              { page: 1, search: 'BQA Cloud skill' },
              'MASTERS',
            )
          ).recordset[0].json,
        );
        assert.equal(skillChoices.skills[0].levels.length, 5);
        assert.equal(skillChoices.skills[0].levels[2].description, 'Criteria 3');
        const demand = randomUUID();
        rev = await revision();
        const payload: Record<string, unknown> = {
          id: demand,
          revision: rev,
          accessRevision: rev,
          scopeId: ids.gb,
          title: 'BQA Demand',
          description: 'Fixture',
          requirements: {
            skills: [{ id: skillMaster.id, minRank: 3 }],
            certifications: [definition],
          },
        };
        await execute('BusinessWorkflow', ids.lead, payload, 'SAVE_DEMAND');
        const { accessRevision: _recoveryRevision, ...recoverPayload } = payload;
        const recovered = JSON.parse(
          (await execute('BusinessWorkflowRecovery', ids.lead, recoverPayload, 'SAVE_DEMAND'))
            .recordset[0].json,
        );
        assert.equal(recovered.replayed, true);
        assert.equal(
          JSON.parse(
            (
              await execute(
                'BusinessWorkflowRecovery',
                ids.lead,
                { ...recoverPayload, title: 'Changed' },
                'SAVE_DEMAND',
              )
            ).recordset[0].json,
          ),
          null,
        );
        assert.equal(
          JSON.parse(
            (await execute('BusinessWorkflowRecovery', ids.admin, recoverPayload, 'SAVE_DEMAND'))
              .recordset[0].json,
          ),
          null,
        );

        await execute('BusinessWorkflow', ids.lead, payload, 'SAVE_DEMAND');
        const matched = JSON.parse(
          (await execute('BusinessWorkflow', ids.lead, { id: demand, page: 1 }, 'MATCHES'))
            .recordset[0].json,
        );
        assert.equal(matched.total, 2);
        assert.equal(matched.required, 2);
        assert.equal(
          matched.rows.find((p: { id: string }) => p.id.toLowerCase() === ids.alice).matched,
          2,
        );
        assert.equal(
          matched.rows.find((p: { id: string }) => p.id.toLowerCase() === ids.alice).eligible,
          true,
        );
        assert.equal(
          matched.rows.find((p: { id: string }) => p.id.toLowerCase() === ids.bob).eligible,
          false,
        );
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('bob', sql.UniqueIdentifier, ids.bob)
          .query(
            'UPDATE dbo.SkillClaimDraft SET claimed_rank=8 WHERE account_id=@account AND person_id=@bob',
          );
        const historical = JSON.parse(
          (await execute('BusinessDashboard', ids.lead, businessQuery({ dataset: 'skills' })))
            .recordset[0].json,
        );
        assert.equal(historical.summary.skilled, 2);
        assert.equal(
          historical.rows.find((r: { id: string; employeeCode: string }) =>
            r.employeeCode.endsWith(ids.bob.toUpperCase()),
          ).recordedRank,
          8,
        );
        assert.ok(
          historical.coverage.some(
            (c: { rank: number; holders: number }) => c.rank === 5 && c.holders === 1,
          ),
        );
        rev = await revision();
        const shortlist = {
          id: demand,
          personId: ids.alice,
          revision: 1,
          accessRevision: rev,
          note: 'Current reviewed credential',
        };
        await execute('BusinessWorkflow', ids.lead, shortlist, 'SHORTLIST');
        assert.equal((await recover(ids.lead, 'SHORTLIST', shortlist)).replayed, true);
        await execute('BusinessWorkflow', ids.lead, shortlist, 'SHORTLIST');
        const counts: { count: number } = (
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('id', sql.UniqueIdentifier, demand)
            .query(
              'SELECT COUNT(*) AS count FROM dbo.BusinessShortlist WHERE account_id=@account AND demand_id=@id',
            )
        ).recordset[0];
        assert.equal(counts.count, 1);
        const legacyFramework = randomUUID();
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('framework', sql.UniqueIdentifier, legacyFramework)
          .input('skill', sql.UniqueIdentifier, skillMaster.id)
          .input('bob', sql.UniqueIdentifier, ids.bob).query(`
          INSERT dbo.ProficiencyFramework(framework_id,account_id) VALUES(@framework,@account);
          INSERT dbo.ProficiencyLevel VALUES(@framework,8,N'Legacy stage eight',N'Custom framework; no standard equivalence defined');
          INSERT dbo.SkillDefinitionVersion(account_id,skill_id,definition_revision,framework_id,display_name,category,description,status) VALUES(@account,@skill,999991,@framework,N'Old custom skill',N'Cloud',N'Custom criteria','PUBLISHED');
          INSERT dbo.SkillVersionCriterion VALUES(@account,@skill,999991,@framework,8,N'Custom criteria');
          UPDATE dbo.SkillClaimDraft SET definition_revision=999991,claimed_rank=8,level_name=N'Legacy stage eight' WHERE account_id=@account AND person_id=@bob AND skill_id=@skill;
        `);
        const legacyMatch: { matched: boolean }[] = (
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('bob', sql.UniqueIdentifier, ids.bob)
            .input(
              'requirements',
              sql.NVarChar(sql.MAX),
              JSON.stringify({ skills: [{ id: skillMaster.id, minRank: 5 }], certifications: [] }),
            )
            .query('SELECT * FROM dbo.BusinessMatchRequirements(@account,@bob,@requirements)')
        ).recordset;
        assert.equal(legacyMatch[0].matched, false);

        const secondSkill = randomUUID();
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('skill', sql.UniqueIdentifier, skillMaster.id)
          .input('secondSkill', sql.UniqueIdentifier, secondSkill)
          .input('dana', sql.UniqueIdentifier, ids.dana).query(`
          UPDATE dbo.SkillCatalogue SET display_name=N'BQA Renamed Cloud skill' WHERE account_id=@account AND skill_id=@skill;
          INSERT dbo.SkillCatalogue(account_id,skill_id,display_name,category,description,status,definition_revision) VALUES(@account,@secondSkill,N'BQA Cloud skill',N'Cloud',N'New skill with former name','PUBLISHED',999992);
          INSERT dbo.SkillDefinitionVersion(account_id,skill_id,definition_revision,framework_id,display_name,category,description,status) VALUES(@account,@secondSkill,999992,'00000000-0000-4000-8000-000000000002',N'BQA Cloud skill',N'Cloud',N'New skill with former name','PUBLISHED');
          INSERT dbo.SkillVersionCriterion VALUES(@account,@secondSkill,999992,'00000000-0000-4000-8000-000000000002',3,N'Practitioner criteria');
          INSERT dbo.SkillClaimDraft(account_id,claim_id,person_id,skill_id,revision,definition_revision,skill_name,category,claimed_rank,level_name,level_description,experience_months,description,status,submitted_at,reviewed_at) VALUES(@account,NEWID(),@dana,@secondSkill,1,999992,N'BQA Cloud skill',N'Cloud',3,N'Practitioner',N'Criteria 3',24,N'Fixture','APPROVED',SYSUTCDATETIME(),SYSUTCDATETIME());
        `);
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('cert', sql.UniqueIdentifier, ids.certA)
          .query(
            "UPDATE dbo.CertificationRecord SET status='CHANGES_REQUESTED' WHERE account_id=@account AND id=@cert;",
          );
        const collision = JSON.parse(
          (await execute('BusinessDashboard', ids.lead, businessQuery({ dataset: 'skills' })))
            .recordset[0].json,
        );
        const cells = collision.coverage.filter(
          (c: any) => c.label === 'BQA Cloud skill' && c.rank === 3,
        );
        assert.equal(cells.length, 1);
        assert.ok(
          collision.coverage.some(
            (c: any) =>
              c.id.toLowerCase() === skillMaster.id.toLowerCase() &&
              c.label === 'BQA Renamed Cloud skill',
          ),
        );
        assert.equal(new Set(collision.coverage.map((c: any) => c.id)).size, 2);
        const renderedCell = collision.coverage.find(
          (c: any) => c.label === 'BQA Cloud skill' && c.rank === 3,
        );
        assert.equal(renderedCell.holders, 1);
        const currentMonth = new Date().toISOString().slice(0, 7);
        const beforeActivity = collision.activity.find((m: any) => m.label === currentMonth);
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('cert', sql.UniqueIdentifier, ids.certA)
          .query(
            "UPDATE dbo.CertificationRecord SET status='SUBMITTED',submitted_at=SYSUTCDATETIME(),reviewed_at=NULL WHERE account_id=@account AND id=@cert;",
          );
        const afterActivity = JSON.parse(
          (await execute('BusinessDashboard', ids.lead, businessQuery({ dataset: 'skills' })))
            .recordset[0].json,
        ).activity.find((m: any) => m.label === currentMonth);
        assert.equal(afterActivity.decisions, beforeActivity.decisions);
        // Returning to a private draft cannot erase already audited public events.
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('cert', sql.UniqueIdentifier, ids.certA)
          .query(
            "UPDATE dbo.CertificationRecord SET status='DRAFT',submitted_at=NULL,reviewed_at=NULL WHERE account_id=@account AND id=@cert;",
          );
        const draftActivity = (await read()).activity.find((m: any) => m.label === currentMonth);
        assert.equal(draftActivity.decisions, beforeActivity.decisions);
        assert.equal(draftActivity.submissions, beforeActivity.submissions);
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('cert', sql.UniqueIdentifier, ids.certA).query(`
          DECLARE @r int=(SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account);
          INSERT dbo.AccessAudit(account_id,revision,actor_id,target_id,action,after_json)
          SELECT @account,@r+1,person_id,id,'certification.submitted',(SELECT c.person_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM dbo.CertificationRecord c WHERE account_id=@account AND id=@cert;
          UPDATE dbo.AccessWorkspace SET revision=@r+1 WHERE account_id=@account;
        `);
        const nextActivity = (await read()).activity.find((m: any) => m.label === currentMonth);
        assert.equal(nextActivity.submissions, beforeActivity.submissions + 1);
        assert.equal(nextActivity.decisions, beforeActivity.decisions);
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('actor', sql.UniqueIdentifier, ids.lead)
          .query(
            'UPDATE dbo.BusinessResponsibility SET active=0 WHERE account_id=@account AND person_id=@actor;',
          );
        await assert.rejects(
          recover(ids.lead, 'SAVE_DEMAND', payload),
          (e: any) => e.number === 51003,
        );
      } else if (scenario === 'scoped-deny') {
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('lead', sql.UniqueIdentifier, ids.lead)
          .input('b', sql.UniqueIdentifier, ids.b)
          .query(
            "INSERT dbo.BusinessResponsibility VALUES(@account,NEWID(),@lead,'BUSINESS_OPERATIONS','PROJECT',@b,'DENY',1,DATEADD(hour,1,SYSUTCDATETIME()),N'Rollback deny');",
          );
        assert.equal((await read()).summary.employees, 1);
        assert.equal((await read()).total, 0);
      } else if (scenario === 'stale-master') {
        const provider = randomUUID(),
          request = randomUUID();
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('provider', sql.UniqueIdentifier, provider)
          .query(
            "INSERT dbo.CredentialProvider VALUES(@account,@provider,N'BQA Old Provider',1,1)",
          );
        const rev = (
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account')
        ).recordset[0].revision;
        await execute(
          'BusinessWorkflow',
          ids.lead,
          {
            id: request,
            revision: rev,
            accessRevision: rev,
            type: 'PROVIDER',
            targetId: provider,
            isNew: false,
            reason: 'Fixture',
            definition: { name: 'BQA Proposed Provider', active: true },
          },
          'PROPOSE',
        );
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('provider', sql.UniqueIdentifier, provider)
          .query(
            "UPDATE dbo.CredentialProvider SET name=N'BQA Updated Provider',revision=revision+1 WHERE account_id=@account AND id=@provider",
          );
        await assert.rejects(
          execute(
            'BusinessWorkflow',
            ids.admin,
            { id: request, revision: 1, accessRevision: rev + 1, note: 'Fixture' },
            'APPROVE_AMENDMENT',
          ),
          e => (e as { number: number }).number === 51009,
        );
      } else if (scenario === 'scope-lifecycle') {
        const unit = randomUUID(),
          department = randomUUID(),
          grant = randomUUID(),
          demand = randomUUID();
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('lead', sql.UniqueIdentifier, ids.lead)
          .input('unit', sql.UniqueIdentifier, unit)
          .input('department', sql.UniqueIdentifier, department)
          .input('grant', sql.UniqueIdentifier, grant)
          .input('demand', sql.UniqueIdentifier, demand)
          .input('a', sql.UniqueIdentifier, ids.a).query(`
            UPDATE dbo.BusinessProject SET active=0 WHERE account_id=@account AND id=@a;
            INSERT dbo.AccessOrgNode(account_id,node_id,kind,display_name,parent_id,active)
            VALUES(@account,@unit,'DELIVERY_UNIT',N'BQA unit '+CONVERT(nvarchar(36),@unit),NULL,1),(@account,@department,'DEPARTMENT',N'BQA department',@unit,1);
            INSERT dbo.BusinessResponsibility VALUES(@account,@grant,@lead,'BUSINESS_OPERATIONS','DEPARTMENT',@department,'ALLOW',1,NULL,N'Fixture');
            INSERT dbo.BusinessDemand VALUES(@account,@demand,@lead,N'Fixture',N'Fixture','DEPARTMENT',@department,N'{"skills":[],"certifications":[]}',1,SYSUTCDATETIME());
          `);
        const context = async () =>
          JSON.parse((await execute('BusinessContext', ids.lead)).recordset[0].json);
        const coversDemand = async (): Promise<boolean> =>
          (
            await new sql.Request(tx)
              .input('account', sql.UniqueIdentifier, account)
              .input('lead', sql.UniqueIdentifier, ids.lead)
              .input('demand', sql.UniqueIdentifier, demand)
              .query('SELECT dbo.BusinessDemandCan(@account,@lead,@demand) AS allowed')
          ).recordset[0].allowed;
        assert.equal(
          (await context()).scopes.some((s: { id: string }) => s.id.toLowerCase() === ids.ga),
          false,
        );
        assert.equal(await coversDemand(), true);
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('unit', sql.UniqueIdentifier, unit)
          .query(
            'UPDATE dbo.AccessOrgNode SET active=0 WHERE account_id=@account AND node_id=@unit',
          );
        assert.equal(
          (await context()).canView,
          true,
          'The separate live project responsibility remains.',
        );
        assert.equal(
          (await context()).scopes.some((s: { id: string }) => s.id.toLowerCase() === grant),
          false,
        );
        assert.equal(
          await coversDemand(),
          false,
          'Inactive parent units cannot authorize department demand metadata.',
        );
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('lead', sql.UniqueIdentifier, ids.lead)
          .query(
            "INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,valid_until,reason) VALUES(@account,@lead,'skill.catalogue.propose','ORGANIZATION','DENY',DATEADD(hour,1,SYSUTCDATETIME()),N'Fixture');",
          );
        assert.equal((await context()).canAmend, false);
        assert.equal(
          (await read()).context.canAmend,
          false,
          'Dashboard must preserve an independent amendment DENY.',
        );
        await assert.rejects(read(grant), e => (e as { number: number }).number === 51003);
      } else if (scenario === 'administration-profile-denied') {
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('admin', sql.UniqueIdentifier, ids.admin)
          .query(
            "INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,valid_until,reason) VALUES(@account,@admin,'profile.view','OWN','DENY',DATEADD(hour,1,SYSUTCDATETIME()),N'Fixture');",
          );
        await assert.rejects(
          execute('BusinessAdministration', ids.admin),
          e => (e as { number: number }).number === 51003,
        );
      } else if (scenario === 'administration-lockout') {
        const administration = JSON.parse(
          (await execute('BusinessAdministration', ids.admin)).recordset[0].json,
        );
        const binding = administration.responsibilities.find(
          (r: { personId: string; bundle: string }) =>
            r.personId.toLowerCase() === ids.admin && r.bundle === 'SYSTEM_ADMIN',
        );
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('admin', sql.UniqueIdentifier, ids.admin)
          .query(
            "INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,valid_until,reason) SELECT @account,p.person_id,'audit.view','ORGANIZATION','DENY',DATEADD(hour,1,SYSUTCDATETIME()),N'Rollback fixture' FROM dbo.AccessPerson p WHERE p.account_id=@account AND p.person_id<>@admin AND NOT EXISTS(SELECT 1 FROM dbo.AccessPersonOverride o WHERE o.account_id=p.account_id AND o.person_id=p.person_id AND o.permission_code='audit.view' AND o.scope_kind='ORGANIZATION');",
          );
        await assert.rejects(
          new sql.Request(tx)
            .input('account_id', sql.UniqueIdentifier, account)
            .input('actor_id', sql.UniqueIdentifier, ids.admin)
            .input('expected_revision', sql.Int, administration.revision)
            .input('kind', sql.VarChar(30), 'RESPONSIBILITY')
            .input('id', sql.UniqueIdentifier, binding.id)
            .input(
              'payload',
              sql.NVarChar(sql.MAX),
              JSON.stringify({
                personId: ids.admin,
                bundle: 'SYSTEM_ADMIN',
                kind: 'ORGANIZATION',
                scopeId: null,
                effect: 'ALLOW',
                active: false,
                validUntil: null,
                reason: 'Fixture',
              }),
            )
            .execute('dbo.SaveBusinessChange'),
          e => (e as { number: number }).number === 51000,
        );
      } else if (scenario === 'responsibility-policy') {
        const unit = randomUUID();
        const department = randomUUID();
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('lead', sql.UniqueIdentifier, ids.lead)
          .input('unit', sql.UniqueIdentifier, unit)
          .input('department', sql.UniqueIdentifier, department).query(`
            UPDATE dbo.BusinessResponsibility SET active=0 WHERE account_id=@account AND person_id=@lead;
            INSERT dbo.AccessOrgNode(account_id,node_id,kind,display_name,parent_id,active)
            VALUES(@account,@unit,'DELIVERY_UNIT',N'BQA unit '+CONVERT(nvarchar(36),@unit),NULL,1),
              (@account,@department,'DEPARTMENT',N'BQA department',@unit,1);
            INSERT dbo.BusinessResponsibility VALUES(@account,NEWID(),@lead,'BUSINESS_OPERATIONS','DEPARTMENT',@department,'ALLOW',1,NULL,N'Fixture');
          `);
        const context = async () =>
          JSON.parse((await execute('BusinessContext', ids.lead)).recordset[0].json);
        assert.equal((await context()).canView, true);
        assert.equal((await context()).canAmend, true);
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('lead', sql.UniqueIdentifier, ids.lead)
          .query(
            "INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,valid_until,reason) VALUES(@account,@lead,'reports.view','ORGANIZATION','DENY',DATEADD(hour,1,SYSUTCDATETIME()),N'Fixture');",
          );
        assert.equal((await context()).canView, false);
        assert.equal(
          (await context()).canAmend,
          true,
          'Analytics DENY cannot deny an independent amendment action.',
        );
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('lead', sql.UniqueIdentifier, ids.lead)
          .input('unit', sql.UniqueIdentifier, unit)
          .query(
            "INSERT dbo.BusinessResponsibility VALUES(@account,NEWID(),@lead,'BUSINESS_OPERATIONS','DELIVERY_UNIT',@unit,'DENY',1,DATEADD(hour,1,SYSUTCDATETIME()),N'Fixture');",
          );
        assert.equal(
          (await context()).canAmend,
          false,
          'A parent unit DENY covers the department responsibility.',
        );
      } else if (scenario === 'individual-deny') {
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('lead', sql.UniqueIdentifier, ids.lead)
          .query(
            "INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,valid_until,reason) VALUES(@account,@lead,'demand.view','ORGANIZATION','DENY',DATEADD(hour,1,SYSUTCDATETIME()),N'Fixture');",
          );
        const context = JSON.parse((await execute('BusinessContext', ids.lead)).recordset[0].json);
        assert.equal(context.canView, true);
        assert.equal(context.canDemandCreate, false);
        assert.equal(context.canMatch, false);
        await assert.rejects(
          execute('BusinessWorkflow', ids.lead, { page: 1 }, 'DEMANDS'),
          e => (e as { number: number }).number === 51003,
        );
      } else if (scenario === 'inactive-member') {
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('alice', sql.UniqueIdentifier, ids.alice)
          .query(
            'UPDATE dbo.AccessPerson SET active=0 WHERE account_id=@account AND person_id=@alice',
          );
        assert.equal((await read()).summary.employees, 2);
        assert.equal((await read()).summary.certified, 0);
      } else if (scenario === 'foreign-scope')
        await assert.rejects(read(randomUUID()), e => (e as { number: number }).number === 51003);
      else if (scenario === 'inactive-actor') {
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('lead', sql.UniqueIdentifier, ids.lead)
          .query(
            'UPDATE dbo.AccessPerson SET active=0 WHERE account_id=@account AND person_id=@lead',
          );
        await assert.rejects(read(), e => (e as { number: number }).number === 51003);
      } else {
        await assert.rejects(
          new sql.Request(tx)
            .input('account_id', sql.UniqueIdentifier, account)
            .input('actor_id', sql.UniqueIdentifier, ids.admin)
            .input('expected_revision', sql.Int, -1)
            .input('kind', sql.VarChar(30), 'PERSONAL_BASELINE')
            .input('id', sql.UniqueIdentifier, randomUUID())
            .input('payload', sql.NVarChar(sql.MAX), '{"enabled":true,"reason":"Fixture"}')
            .execute('dbo.SaveBusinessChange'),
          e => (e as { number: number }).number === 51009,
        );
      }
      console.log('PASS rollback Business Operations:', scenario);
    } finally {
      if (!rolledBack) await tx.rollback();
    }
  }
  const retained = (
    await pool
      .request()
      .query(
        "SELECT (SELECT MAX(version) FROM dbo.SchemaMigration) AS version,(SELECT COUNT(*) FROM dbo.AccessPerson WHERE employee_code LIKE 'BQA-%') AS fixtures,OBJECT_ID('dbo.BusinessProject') AS installed",
      )
  ).recordset[0];
  assert.equal(retained.fixtures, 0);
  assert.equal(retained.version, info.version);
  if (info.version < 60) assert.equal(retained.installed, null);
  console.log('PASS rollback cleanup: no fixtures or pending schema retained');
});
