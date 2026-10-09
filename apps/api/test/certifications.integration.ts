import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';

// Synthetic accounts only, always rolled back. Opt in on a dedicated test database.
if (process.env.CERTIFICATION_TEST_DATABASE !== 'true')
  throw new Error(
    'Set CERTIFICATION_TEST_DATABASE=true only for a dedicated test database with migration 053 applied.',
  );

const fields = {
  certificationName: 'Synthetic credential',
  provider: 'Test issuer',
  category: 'Cloud',
  certificationDate: '2020-01-01',
  expiryDate: '2021-01-01',
  credentialId: 'SYNTHETIC',
  credentialUrl: 'https://issuer.example.test/credential',
};
const query = (view = 'mine') => ({
  view,
  page: 1,
  search: '',
  category: '',
  du: '',
  active: 'ALL',
});
function resultSets<T>(result: sql.IResult<T>): sql.IRecordSet<T>[] {
  if (!Array.isArray(result.recordsets)) throw new Error('Expected SQL result sets.');
  return result.recordsets;
}
await withDatabase(async pool => {
  assert.ok(
    (await pool.request().query("SELECT OBJECT_ID('dbo.Certifications','P') AS id")).recordset[0]
      .id,
    'Apply migration 053 to the dedicated test database first.',
  );
  let checks = 0;
  async function fixture(
    run: (f: {
      account: string;
      owner: string;
      manager: string;
      other: string;
      lead: string;
      id: string;
      request: () => sql.Request;
      action: (
        actor: string,
        action: string,
        payload: object,
      ) => Promise<sql.IProcedureResult<Record<string, unknown>>>;
    }) => Promise<void>,
  ) {
    const account = randomUUID(),
      owner = randomUUID(),
      manager = randomUUID(),
      other = randomUUID(),
      lead = randomUUID(),
      role = randomUUID(),
      id = randomUUID();
    const transaction = new sql.Transaction(pool);
    let rolledBack = false;
    transaction.on('rollback', () => {
      rolledBack = true;
    });
    await transaction.begin();
    const request = () => new sql.Request(transaction);
    try {
      await request()
        .input('account', sql.UniqueIdentifier, account)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('manager', sql.UniqueIdentifier, manager)
        .input('other', sql.UniqueIdentifier, other)
        .input('lead', sql.UniqueIdentifier, lead)
        .input('role', sql.UniqueIdentifier, role).query(`
          INSERT dbo.Account(account_id,account_code,display_name,entra_tenant_id) VALUES(@account,CONVERT(varchar(36),@account),'Synthetic certification test',NEWID());
          INSERT dbo.AccessWorkspace(account_id,revision) VALUES(@account,1);
          INSERT dbo.AccountRole(account_id,role_id,display_name) VALUES(@account,@role,'Arbitrary template name');
          INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active)
            VALUES(@account,@owner,'Same Name','OWNER',1),(@account,@manager,'Manager','MANAGER',1),
              (@account,@other,'Same Name','OTHER',1),(@account,@lead,'Directory viewer','LEAD',1);
          INSERT dbo.AccessPersonRole(account_id,person_id,role_id)
            VALUES(@account,@owner,@role),(@account,@manager,@role),(@account,@other,@role),(@account,@lead,@role);
          INSERT dbo.AccountRolePermission(account_id,role_id,permission_code,scope_kind,effect)
            VALUES(@account,@role,'profile.view','OWN','ALLOW'),
              (@account,@role,'certification.view','OWN','ALLOW'),
              (@account,@role,'certification.manage','OWN','ALLOW');
          INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until)
            VALUES(@account,@lead,'certification.directory','ORGANIZATION','ALLOW','Synthetic test',DATEADD(day,1,SYSUTCDATETIME())),
              (@account,@lead,'certification.export','ORGANIZATION','ALLOW','Synthetic test',DATEADD(day,1,SYSUTCDATETIME()));
          INSERT dbo.AccessOrgAssignment(account_id,person_id,manager_id) VALUES(@account,@owner,@manager);
        `);
      const action = (actor: string, operation: string, payload: object) =>
        request()
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('action', sql.VarChar(20), operation)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .execute<Record<string, unknown>>('dbo.Certifications');
      await run({ account, owner, manager, other, lead, id, request, action });
      checks++;
    } finally {
      if (!rolledBack) await transaction.rollback();
    }
    const persisted = await pool
      .request()
      .input('account', sql.UniqueIdentifier, account)
      .query('SELECT COUNT(*) AS total FROM dbo.Account WHERE account_id=@account');
    assert.equal(persisted.recordset[0].total, 0, 'Synthetic fixture must not persist');
  }
  const rejected = (operation: Promise<unknown>, number: number) =>
    assert.rejects(operation, error => (error as { number?: number }).number === number);
  await fixture(async f => {
    await f.action(f.owner, 'SAVE', { id: f.id, revision: 0, action: 'SAVE', fields });
    const mine = await f.action(f.owner, 'LIST', query());
    const rows = resultSets(mine);
    assert.equal(rows[1][0].status, 'DRAFT');
    assert.equal(rows[1][0].active, 'N');
    const collision = await f.action(f.other, 'LIST', query());
    assert.equal(collision.recordset[0].total, 0, 'Same display name is not ownership');
    const directory = await f.action(f.lead, 'LIST', query('directory'));
    assert.equal(directory.recordset[0].total, 0, 'Private drafts cannot enter the directory');
    await f.action(f.owner, 'SUBMIT', { id: f.id, revision: 1, action: 'SUBMIT', fields });
    const queue = await f.action(f.manager, 'LIST', query('queue'));
    const pending = resultSets(queue);
    assert.equal(pending[1][0].canReview, true);
    assert.equal(String(pending[1][0].reviewerId).toLowerCase(), f.manager);
    await f.action(f.manager, 'APPROVED', {
      id: f.id,
      revision: 2,
      action: 'APPROVED',
      feedback: 'Checked issuer evidence',
    });
    const approved = await f.action(f.owner, 'LIST', query());
    const decided = resultSets(approved);
    assert.equal(decided[1][0].verified, true);
    assert.equal(
      decided[1][0].active,
      'N',
      'Historical approval must not make expired evidence compliant',
    );
    assert.equal(decided[1][0].canEdit, false);
    const audit = await f
      .request()
      .input('account', sql.UniqueIdentifier, f.account)
      .query<{ total: number }>(
        'SELECT COUNT(*) AS total FROM dbo.CertificationEvent WHERE account_id=@account; SELECT COUNT(*) AS total FROM dbo.AccessAudit WHERE account_id=@account',
      );
    const events = resultSets(audit);
    assert.equal(events[0][0].total, 3);
    assert.equal(events[1][0].total, 3);
    await rejected(
      f.action(f.owner, 'SAVE', { id: f.id, revision: 3, action: 'SAVE', fields }),
      51009,
    );
  });
  await fixture(async f => {
    await f.action(f.owner, 'SUBMIT', { id: f.id, revision: 0, action: 'SUBMIT', fields });
    await rejected(
      f.action(f.owner, 'APPROVED', { id: f.id, revision: 1, action: 'APPROVED', feedback: '' }),
      51003,
    );
  });
  await fixture(async f => {
    await f.action(f.owner, 'SUBMIT', { id: f.id, revision: 0, action: 'SUBMIT', fields });
    await rejected(
      f.action(f.lead, 'APPROVED', { id: f.id, revision: 1, action: 'APPROVED', feedback: '' }),
      51003,
    );
  });
  await fixture(async f => {
    await f.action(f.owner, 'SUBMIT', { id: f.id, revision: 0, action: 'SUBMIT', fields });
    await rejected(
      f.action(f.owner, 'SAVE', { id: f.id, revision: 1, action: 'SAVE', fields }),
      51009,
    );
  });
  await fixture(async f => {
    await f.action(f.owner, 'SUBMIT', { id: f.id, revision: 0, action: 'SUBMIT', fields });
    await f.action(f.manager, 'CHANGES_REQUESTED', {
      id: f.id,
      revision: 1,
      action: 'CHANGES_REQUESTED',
      feedback: 'Correct recipient link',
    });
    await f.action(f.owner, 'SAVE', {
      id: f.id,
      revision: 2,
      action: 'SAVE',
      fields: { ...fields, certificationName: 'Corrected credential' },
    });
    const page = await f.action(f.owner, 'LIST', query());
    const sets = resultSets(page);
    assert.equal(sets[1][0].status, 'DRAFT');
    assert.equal(sets[1][0].feedbackNote, 'Correct recipient link');
    assert.equal(
      JSON.parse(String(sets[1][0].history)).length,
      2,
      'Submission and decision history survives draft edits',
    );
    await rejected(
      f.action(f.owner, 'SAVE', { id: f.id, revision: 2, action: 'SAVE', fields }),
      51009,
    );
  });
  await fixture(async f => {
    await f.action(f.owner, 'SUBMIT', { id: f.id, revision: 0, action: 'SUBMIT', fields });
    await f
      .request()
      .input('account', sql.UniqueIdentifier, f.account)
      .input('owner', sql.UniqueIdentifier, f.owner)
      .input('other', sql.UniqueIdentifier, f.other)
      .query(
        'UPDATE dbo.AccessOrgAssignment SET manager_id=@other WHERE account_id=@account AND person_id=@owner',
      );
    const obsolete = await f.action(f.manager, 'LIST', query('queue'));
    const notInherited = await f.action(f.other, 'LIST', query('queue'));
    assert.equal(obsolete.recordset[0].total, 0);
    assert.equal(notInherited.recordset[0].total, 0);
    await f.action(f.owner, 'REROUTE', { id: f.id, revision: 1, action: 'REROUTE' });
    const eligible = await f.action(f.other, 'LIST', query('queue'));
    assert.equal(eligible.recordset[0].total, 1);
  });
  await fixture(async f => {
    await f.action(f.owner, 'SUBMIT', { id: f.id, revision: 0, action: 'SUBMIT', fields });
    await f
      .request()
      .input('account', sql.UniqueIdentifier, f.account)
      .input('actor', sql.UniqueIdentifier, f.manager)
      .query(
        "INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until) VALUES(@account,@actor,'certification.verify','ORGANIZATION','DENY','Synthetic test',DATEADD(day,1,SYSUTCDATETIME()))",
      );
    await rejected(
      f.action(f.manager, 'APPROVED', { id: f.id, revision: 1, action: 'APPROVED', feedback: '' }),
      51003,
    );
  });
  await fixture(async f => {
    await f.action(f.owner, 'SUBMIT', { id: f.id, revision: 0, action: 'SUBMIT', fields });
    const exportRows = await f.action(f.lead, 'EXPORT', {
      ...query('directory'),
      category: 'Different category',
    });
    assert.equal(exportRows.recordset[0].total, 0);
    await rejected(f.action(f.other, 'EXPORT', query('directory')), 51003);
  });
  await fixture(async f => {
    await rejected(
      f.action(f.owner, 'SUBMIT', {
        id: f.id,
        revision: 0,
        action: 'SUBMIT',
        fields: { ...fields, certificationDate: '2020-02-30' },
      }),
      51000,
    );
  });
  for (const days of [0, 90, 91, null]) {
    await fixture(async f => {
      const dates = await f
        .request()
        .query<{ expiry: string }>(
          `SELECT CONVERT(varchar(10), DATEADD(day, ${days ?? 0}, CONVERT(date,SYSUTCDATETIME())),23) AS expiry`,
        );
      await f.action(f.owner, 'SUBMIT', {
        id: f.id,
        revision: 0,
        action: 'SUBMIT',
        fields: { ...fields, expiryDate: days === null ? null : dates.recordset[0].expiry },
      });
      await f.action(f.manager, 'APPROVED', {
        id: f.id,
        revision: 1,
        action: 'APPROVED',
        feedback: 'Synthetic evidence review',
      });
      const page = await f.action(f.owner, 'LIST', query());
      assert.equal(
        page.recordset[0].activeCount,
        1,
        'Approval is valid through the UTC expiry date',
      );
      assert.equal(page.recordset[0].expiringSoonCount, days !== null && days <= 90 ? 1 : 0);
      const row = resultSets(page)[1][0];
      assert.equal(row.doesNotExpire, days === null ? 'Yes' : 'No');
      if (days === null) assert.equal(row.expiryDate, null);
      await f
        .request()
        .input('account', sql.UniqueIdentifier, f.account)
        .input('owner', sql.UniqueIdentifier, f.owner)
        .query(
          'UPDATE dbo.AccessPerson SET active=0 WHERE account_id=@account AND person_id=@owner',
        );
      const directory = await f.action(f.lead, 'LIST', query('directory'));
      assert.equal(
        directory.recordset[0].activeCount,
        0,
        'Inactive employees are never currently compliant',
      );
    });
  }
  console.log(
    `${checks} certification SQL lifecycle/access fixtures passed; synthetic data rolled back.`,
  );
});
