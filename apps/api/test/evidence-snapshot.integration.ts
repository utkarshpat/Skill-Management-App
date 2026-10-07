import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
import { proficiencyNames } from '../src/modules/skills/proficiency.js';

const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account, 'Set ACCESS_ACCOUNT_ID for an active workspace with migrations through 050.');
interface EvidenceState {
  revision: number;
  canUpload: boolean;
  ids: string[];
}
interface Fixture {
  tx: sql.Transaction;
  employee: string;
  manager: string;
  other: string;
  claim: string;
  read: (actor?: string) => Promise<EvidenceState>;
  add: () => Promise<string>;
  transition: (action: string, actor?: string) => Promise<void>;
}
await withDatabase(async pool => {
  const version = (
    await pool.request().query('SELECT MAX(version) AS version FROM dbo.SchemaMigration')
  ).recordset[0].version;
  assert.ok(version >= 50, 'Apply migrations through 050 before this rollback-only fixture.');
  const migration = await readFile(
    new URL('../../../database/migrations/051_submitted_skill_evidence.sql', import.meta.url),
    'utf8',
  );
  async function fixture(run: (f: Fixture) => Promise<void>) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let aborted = false;
    tx.on('rollback', () => {
      aborted = true;
    });
    try {
      // Exercise the new procedure against existing schema without persisting DDL or fixture data.
      for (const batch of migration.split(/^GO\s*$/m))
        if (batch.trim()) await new sql.Request(tx).batch(batch);
      const employee = randomUUID(),
        manager = randomUUID(),
        other = randomUUID(),
        skill = randomUUID(),
        claim = randomUUID();
      await new sql.Request(tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('employee', sql.UniqueIdentifier, employee)
        .input('manager', sql.UniqueIdentifier, manager)
        .input('other', sql.UniqueIdentifier, other).query(`
     INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active)
     SELECT @account,id,name,'QA-'+CONVERT(varchar(36),id),1 FROM
     (VALUES(@employee,N'Rollback evidence employee'),(@manager,N'Rollback evidence manager'),(@other,N'Rollback evidence other')) p(id,name);
     INSERT dbo.AccessOrgAssignment(account_id,person_id,manager_id) VALUES(@account,@employee,@manager);
     INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until)
     SELECT @account,id,code,scope,'ALLOW',N'Rollback-only evidence fixture',DATEADD(hour,1,SYSUTCDATETIME()) FROM
     (VALUES(@employee,'profile.view','OWN'),(@employee,'skill.view','OWN'),(@employee,'skill.view','ORGANIZATION'),(@employee,'skill.claim','OWN'),
      (@manager,'profile.view','OWN'),(@manager,'skill.catalogue.manage','ORGANIZATION'),(@other,'profile.view','OWN')) p(id,code,scope);`);
      const revision = (
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account')
      ).recordset[0].revision;
      await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, manager)
        .input('expected_revision', sql.Int, revision)
        .input('target_id', sql.UniqueIdentifier, skill)
        .input('is_new', sql.Bit, true)
        .input(
          'payload',
          sql.NVarChar(sql.MAX),
          JSON.stringify({
            name: 'Rollback evidence ' + skill,
            category: 'QA',
            description: 'Synthetic rollback-only fixture',
            status: 'PUBLISHED',
            levels: proficiencyNames.map((name, index) => ({
              rank: index + 1,
              name,
              description: 'Demonstrate ' + name,
            })),
          }),
        )
        .execute('dbo.SaveSkillCatalogue');
      await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, employee)
        .input('claim_id', sql.UniqueIdentifier, claim)
        .input('expected_revision', sql.Int, 0)
        .input(
          'payload',
          sql.NVarChar(sql.MAX),
          JSON.stringify({
            skillId: skill,
            definitionRevision: revision + 1,
            rank: 1,
            experienceMonths: 1,
            description: 'Synthetic experience',
          }),
        )
        .execute('dbo.SaveOwnSkillClaim');
      const request = (actor: string) =>
        new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('claim_id', sql.UniqueIdentifier, claim);
      const read = async (actor: string = employee): Promise<EvidenceState> => {
        const result = await request(actor).execute('dbo.SkillEvidence');
        const sets = result.recordsets as unknown as [
          sql.IRecordSet<{ revision: number; canUpload: boolean }>,
          sql.IRecordSet<{ id: string }>,
        ];
        return { ...sets[0][0], ids: sets[1].map(row => row.id.toLowerCase()).sort() };
      };
      const add = async () => {
        const id = randomUUID(),
          state = await read();
        await request(employee)
          .input('operation', sql.VarChar(8), 'ADD')
          .input('expected_revision', sql.Int, state.revision)
          .input('evidence_id', sql.UniqueIdentifier, id)
          .input('blob_name', sql.VarChar(160), `${account!.toLowerCase()}/${claim}/${id}.webp`)
          .input('bytes', sql.Int, 10)
          .input('width', sql.Int, 1)
          .input('height', sql.Int, 1)
          .execute('dbo.SkillEvidence');
        return id;
      };
      const transition = async (action: string, actor: string = employee) => {
        await request(actor)
          .input('expected_revision', sql.Int, (await read()).revision)
          .input('action', sql.VarChar(20), action)
          .input('feedback', sql.NVarChar(2000), 'Synthetic fixture feedback')
          .execute('dbo.TransitionSkillClaim');
      };
      await run({ tx, employee, manager, other, claim, read, add, transition });
    } finally {
      if (!aborted) await tx.rollback();
    }
  }
  await fixture(async f => {
    const submitted = await f.add();
    await f.transition('SUBMIT');
    assert.deepEqual((await f.read(f.manager)).ids, [submitted]);
    assert.equal((await f.read(f.manager)).canUpload, false);
    await f.transition('REQUEST_CHANGES', f.manager);
    const privateImage = await f.add();
    // Identical timestamps must not make a post-submission upload visible.
    await new sql.Request(f.tx)
      .input('account', sql.UniqueIdentifier, account)
      .input('claim', sql.UniqueIdentifier, f.claim).query(`
   UPDATE dbo.SkillClaimEvidence SET created_at='2026-01-01' WHERE account_id=@account AND claim_id=@claim;
   UPDATE dbo.AccessAudit SET occurred_at='2026-01-01' WHERE account_id=@account AND target_id=@claim;`);
    assert.deepEqual((await f.read()).ids, [submitted, privateImage].sort());
    assert.deepEqual((await f.read(f.manager)).ids, [submitted]);
    await f.transition('SUBMIT');
    assert.deepEqual((await f.read(f.manager)).ids, [submitted, privateImage].sort());
    await f.transition('REJECT', f.manager);
    const rejectedDraft = await f.add();
    assert.deepEqual((await f.read(f.manager)).ids, [submitted, privateImage].sort());
    await f.transition('SUBMIT');
    await f.transition('APPROVE', f.manager);
    assert.deepEqual(
      (await f.read(f.manager)).ids,
      [submitted, privateImage, rejectedDraft].sort(),
    );
    assert.equal((await f.read()).canUpload, false);
  });
  await fixture(async f => {
    await f.transition('SUBMIT');
    await f.transition('REQUEST_CHANGES', f.manager);
    await f.add();
    assert.deepEqual(
      (await f.read(f.manager)).ids,
      [],
      'A submission with no images must stay empty until resubmission.',
    );
    await f.transition('SUBMIT');
    assert.equal((await f.read(f.manager)).ids.length, 1);
  });
  await fixture(async f => {
    const image = await f.add();
    await f.transition('SUBMIT');
    await new sql.Request(f.tx)
      .input('account', sql.UniqueIdentifier, account)
      .input('claim', sql.UniqueIdentifier, f.claim)
      .query(
        "UPDATE dbo.AccessAudit SET after_json=N'{}' WHERE account_id=@account AND target_id=@claim AND action='claim.evidence.added';",
      );
    assert.deepEqual(
      (await f.read()).ids,
      [image],
      'Historical images are retained for their owner.',
    );
    assert.deepEqual(
      (await f.read(f.manager)).ids,
      [],
      'Missing upload provenance must never fall back to timestamps.',
    );
  });
  for (const scenario of [
    'foreign',
    'manager-changed',
    'reviewer-mismatch',
    'inactive-owner',
    'inactive-manager',
    'deny',
    'missing-submission',
    'draft',
    'submitted-upload',
    'stale-upload',
  ] as const) {
    await fixture(async f => {
      await f.add();
      if (scenario !== 'draft') await f.transition('SUBMIT');
      if (scenario === 'stale-upload') await f.transition('REQUEST_CHANGES', f.manager);
      const q = new sql.Request(f.tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('claim', sql.UniqueIdentifier, f.claim)
        .input('employee', sql.UniqueIdentifier, f.employee)
        .input('manager', sql.UniqueIdentifier, f.manager)
        .input('other', sql.UniqueIdentifier, f.other);
      if (scenario === 'manager-changed')
        await q.query(
          'UPDATE dbo.AccessOrgAssignment SET manager_id=@other WHERE account_id=@account AND person_id=@employee;',
        );
      if (scenario === 'reviewer-mismatch')
        await q.query(
          'UPDATE dbo.SkillClaimDraft SET reviewer_id=@other WHERE account_id=@account AND claim_id=@claim;',
        );
      if (scenario === 'inactive-owner' || scenario === 'inactive-manager')
        await q.query(
          `UPDATE dbo.AccessPerson SET active=0 WHERE account_id=@account AND person_id=${scenario === 'inactive-owner' ? '@employee' : '@manager'};`,
        );
      if (scenario === 'deny')
        await q.query(
          "INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until) VALUES(@account,@manager,'skill.verify','ORGANIZATION','DENY',N'Rollback fixture deny',DATEADD(hour,1,SYSUTCDATETIME()));",
        );
      if (scenario === 'missing-submission')
        await q.query(
          "DELETE dbo.AccessAudit WHERE account_id=@account AND target_id=@claim AND action='claim.submitted';",
        );
      if (scenario === 'stale-upload') {
        const state = await f.read();
        await assert.rejects(
          new sql.Request(f.tx)
            .input('account_id', sql.UniqueIdentifier, account)
            .input('actor_id', sql.UniqueIdentifier, f.employee)
            .input('claim_id', sql.UniqueIdentifier, f.claim)
            .input('operation', sql.VarChar(8), 'CHECK')
            .input('expected_revision', sql.Int, state.revision - 1)
            .execute('dbo.SkillEvidence'),
          e => (e as { number: number }).number === 51009,
        );
      } else if (scenario === 'submitted-upload')
        await assert.rejects(f.add(), e => (e as { number: number }).number === 51003);
      else
        await assert.rejects(
          f.read(scenario === 'foreign' ? f.other : f.manager),
          e =>
            (e as { number: number }).number ===
            (scenario === 'missing-submission' ? 51004 : 51003),
        );
    });
  }
  console.log(
    'Evidence submission/resubmission snapshots, equal timestamps, historical provenance, current reviewer constraints and stale/locked uploads verified. All fixture data and DDL rolled back; no Blob writes.',
  );
});
