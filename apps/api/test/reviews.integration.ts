import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
import { proficiencyNames } from '../src/modules/skills/proficiency.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
await withDatabase(async pool => {
  const people = (
    await pool
      .request()
      .input('account', sql.UniqueIdentifier, account)
      .query(
        "SELECT TOP(1) o.person_id AS employee,o.manager_id AS manager FROM dbo.AccessOrgAssignment o WHERE o.account_id=@account AND o.manager_id IS NOT NULL AND dbo.AccessCan(@account,o.person_id,'skill.claim',1)=1 ORDER BY o.person_id",
      )
  ).recordset[0];
  assert.ok(people);
  const other = (
    await pool
      .request()
      .input('account', sql.UniqueIdentifier, account)
      .input('employee', sql.UniqueIdentifier, people.employee)
      .input('manager', sql.UniqueIdentifier, people.manager)
      .query(
        'SELECT TOP(1) person_id AS id FROM dbo.AccessPerson WHERE account_id=@account AND active=1 AND person_id NOT IN (@employee,@manager)',
      )
  ).recordset[0].id;
  async function fixture(action: (tx: sql.Transaction, claim: string) => Promise<void>) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let aborted = false;
    tx.on('rollback', () => {
      aborted = true;
    });
    try {
      const skill = randomUUID(),
        claim = randomUUID();
      const setup = (
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .query(
            "SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account; SELECT TOP(1) person_id AS actor FROM dbo.AccessPerson WHERE account_id=@account AND dbo.AccessCan(@account,person_id,'skill.catalogue.manage',0)=1;",
          )
      ).recordsets as sql.IRecordSet<{ revision: number; actor: string }>[];
      const definitionRevision = setup[0][0].revision + 1;
      await new sql.Request(tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('manager', sql.UniqueIdentifier, people.manager)
        .query(
          "DELETE dbo.AccessPersonOverride WHERE account_id=@account AND person_id=@manager AND permission_code IN ('skill.verify','profile.view'); INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect) VALUES(@account,@manager,'skill.verify','ORGANIZATION','ALLOW'),(@account,@manager,'profile.view','OWN','ALLOW');",
        );
      await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, setup[1][0].actor)
        .input('expected_revision', sql.Int, definitionRevision - 1)
        .input('target_id', sql.UniqueIdentifier, skill)
        .input('is_new', sql.Bit, true)
        .input(
          'payload',
          sql.NVarChar(sql.MAX),
          JSON.stringify({
            name: 'Rollback Review ' + skill,
            category: 'QA',
            description: 'Rollback-only fixture',
            status: 'PUBLISHED',
            levels: proficiencyNames.map((name, index) => ({
              rank: index + 1,
              name,
              description: 'Deliver a working feature at ' + name,
            })),
          }),
        )
        .execute('dbo.SaveSkillCatalogue');
      await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, people.employee)
        .input('claim_id', sql.UniqueIdentifier, claim)
        .input('expected_revision', sql.Int, 0)
        .input(
          'payload',
          sql.NVarChar(sql.MAX),
          JSON.stringify({
            skillId: skill,
            definitionRevision,
            rank: 1,
            experienceMonths: 12,
            lastUsedOn: '2024-02-29',
            description: 'Built a reviewed feature.',
            projects: 'Project contribution',
            evidence: 'Certificate reference',
          }),
        )
        .execute('dbo.SaveOwnSkillClaim');
      const choices = await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, people.employee)
        .input('query', sql.NVarChar(100), '')
        .execute('dbo.ReadClaimSkills');
      assert.ok(
        (choices.recordsets as sql.IRecordSet<{ total: number }>[])[0][0].total > 0,
        'Blank search must include published choices.',
      );
      await action(tx, claim);
    } finally {
      if (!aborted) await tx.rollback();
    }
  }
  const transition = (
    tx: sql.Transaction,
    claim: string,
    revision: number,
    action: string,
    actor = people.employee,
  ) =>
    new sql.Request(tx)
      .input('account_id', sql.UniqueIdentifier, account)
      .input('actor_id', sql.UniqueIdentifier, actor)
      .input('claim_id', sql.UniqueIdentifier, claim)
      .input('expected_revision', sql.Int, revision)
      .input('action', sql.VarChar(20), action)
      .input('feedback', sql.NVarChar(2000), 'Reviewed project evidence.')
      .execute('dbo.TransitionSkillClaim');
  await fixture(async (tx, claim) => {
    await transition(tx, claim, 1, 'SUBMIT');
    const queue = await new sql.Request(tx)
      .input('account_id', sql.UniqueIdentifier, account)
      .input('actor_id', sql.UniqueIdentifier, people.manager)
      .execute('dbo.ReadAssignedSkillReviews');
    assert.ok(
      (queue.recordsets as sql.IRecordSet<{ id: string }>[])[1].some(
        row => row.id.toLowerCase() === claim,
      ),
    );
    await transition(tx, claim, 2, 'REQUEST_CHANGES', people.manager);
    const workbench = (status = 'ALL', id: string | null = claim) =>
      new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, people.manager)
        .input('status', sql.VarChar(20), status)
        .input('claim_id', sql.UniqueIdentifier, id)
        .execute('dbo.ReadSkillReviewWorkbench');
    await new sql.Request(tx)
      .input('account', sql.UniqueIdentifier, account)
      .input('claim', sql.UniqueIdentifier, claim)
      .query(
        "UPDATE dbo.SkillClaimDraft SET description=N'PRIVATE EDIT AFTER CHANGES',projects=N'PRIVATE NEW PROJECT',evidence=N'PRIVATE NEW EVIDENCE',last_used_on='2024-03-01' WHERE account_id=@account AND claim_id=@claim;",
      );
    const changed = (await workbench()).recordsets as unknown as sql.IRecordSet<
      Record<string, unknown>
    >[];
    assert.equal(changed[1][0].lastUsedOn, '2024-02-29');
    assert.equal(changed[1][0].description, 'Built a reviewed feature.');
    assert.equal(changed[1][0].projects, 'Project contribution');
    assert.equal(changed[1][0].evidence, 'Certificate reference');
    assert.equal(changed[4].length, 2);
    assert.equal(changed[4][0].action, 'claim.changes_requested');
    assert.equal(changed[4][0].feedback, 'Reviewed project evidence.');
    assert.equal((await workbench('SUBMITTED')).recordset[0].total, 0);
    await transition(tx, claim, 3, 'SUBMIT');
    await transition(tx, claim, 4, 'APPROVE', people.manager);
    const approved = (await workbench('APPROVED')).recordsets as unknown as sql.IRecordSet<
      Record<string, unknown>
    >[];
    assert.equal(approved[0][0].total, 1);
    assert.equal(approved[4].length, 4);
    assert.equal(approved[4][0].action, 'claim.approved');
    assert.equal(approved[1][0].lastUsedOn, '2024-03-01');
    const rows = (
      await new sql.Request(tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('claim', sql.UniqueIdentifier, claim)
        .query(
          'SELECT status,revision,projects,evidence FROM dbo.SkillClaimDraft WHERE account_id=@account AND claim_id=@claim;SELECT COUNT(*) AS n FROM dbo.AccessAudit WHERE account_id=@account AND target_id=@claim;SELECT COUNT(*) AS n FROM dbo.SkillClaimNotification WHERE account_id=@account AND claim_id=@claim;',
        )
    ).recordsets as sql.IRecordSet<{
      status: string;
      revision: number;
      projects: string;
      evidence: string;
      n: number;
    }>[];
    assert.equal(rows[0][0].status, 'APPROVED');
    assert.equal(rows[0][0].revision, 5);
    assert.equal(rows[0][0].projects, 'PRIVATE NEW PROJECT');
    assert.equal(approved[1][0].projects, 'PRIVATE NEW PROJECT');
    assert.equal(rows[1][0].n, 5);
    assert.equal(rows[2][0].n, 4);
  });
  await fixture(async (tx, claim) => {
    await transition(tx, claim, 1, 'SUBMIT');
    await transition(tx, claim, 2, 'REJECT', people.manager);
    const row = (
      await new sql.Request(tx)
        .input('claim', sql.UniqueIdentifier, claim)
        .query('SELECT status,feedback FROM dbo.SkillClaimDraft WHERE claim_id=@claim;')
    ).recordset[0];
    assert.equal(row.status, 'REJECTED');
    assert.equal(row.feedback, 'Reviewed project evidence.');
  });
  for (const scenario of [
    'foreign',
    'stale',
    'self',
    'revoked',
    'manager-changed',
    'double-decision',
  ] as const)
    await fixture(async (tx, claim) => {
      await transition(tx, claim, 1, 'SUBMIT');
      if (scenario === 'revoked')
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('manager', sql.UniqueIdentifier, people.manager)
          .query(
            "UPDATE dbo.AccessPersonOverride SET effect='DENY' WHERE account_id=@account AND person_id=@manager AND permission_code='skill.verify';",
          );
      if (scenario === 'manager-changed')
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('employee', sql.UniqueIdentifier, people.employee)
          .input('other', sql.UniqueIdentifier, other)
          .query(
            'UPDATE dbo.AccessOrgAssignment SET manager_id=@other WHERE account_id=@account AND person_id=@employee;',
          );
      if (scenario === 'double-decision') await transition(tx, claim, 2, 'APPROVE', people.manager);
      const expected =
        scenario === 'stale' ? 51009 : scenario === 'double-decision' ? 51010 : 51003;
      await assert.rejects(
        transition(
          tx,
          claim,
          scenario === 'stale' ? 1 : 2,
          'APPROVE',
          scenario === 'foreign' ? other : scenario === 'self' ? people.employee : people.manager,
        ),
        error => (error as { number: number }).number === expected,
      );
    });
  for (const scenario of ['history-foreign', 'history-manager-changed', 'history-revoked'] as const)
    await fixture(async (tx, claim) => {
      await transition(tx, claim, 1, 'SUBMIT');
      if (scenario === 'history-manager-changed')
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('employee', sql.UniqueIdentifier, people.employee)
          .input('other', sql.UniqueIdentifier, other)
          .query(
            'UPDATE dbo.AccessOrgAssignment SET manager_id=@other WHERE account_id=@account AND person_id=@employee;',
          );
      if (scenario === 'history-revoked')
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('manager', sql.UniqueIdentifier, people.manager)
          .query(
            "UPDATE dbo.AccessPersonOverride SET effect='DENY' WHERE account_id=@account AND person_id=@manager AND permission_code='skill.verify';",
          );
      const denied = new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, people.manager)
        .input(
          'claim_id',
          sql.UniqueIdentifier,
          scenario === 'history-foreign' ? randomUUID() : claim,
        )
        .input('status', sql.VarChar(20), 'ALL');
      await assert.rejects(
        denied.execute('dbo.ReadSkillReviewWorkbench'),
        error =>
          (error as { number: number }).number === (scenario === 'history-revoked' ? 51003 : 51004),
      );
    });
  console.log(
    'SQL reviews verified: filtered queue, immutable submission privacy, decision history, submission/resubmission, approval/rejection, audit/notifications, foreign/self review, history isolation, revocation, manager change and stale/double decisions. All fixtures rolled back.',
  );
});
