// Operator-only rollback fixture. Does not persist grants, people or audit events.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withDatabase, closeRuntimeDatabase } from '../src/shared/database.js';

const account = process.env.ACCESS_ACCOUNT_ID!;
assert.ok(account);
try {
  const people = await withDatabase(
    async pool =>
      (
        await pool.request().input('account', sql.UniqueIdentifier, account)
          .query(`SELECT person_id AS id,display_name AS displayName,
      CASE WHEN dbo.AccessCan(@account,person_id,'permissions.manage',0)=1
        AND dbo.AccessCan(@account,person_id,'audit.view',0)=1 THEN 1 ELSE 0 END AS admin
      FROM dbo.AccessPerson WHERE account_id=@account AND active=1;`)
      ).recordset,
  );
  const admin = people.find(p => p.admin);
  assert.ok(admin, 'An effective administrator is required for the rollback fixture.');
  const subject = people.find(p => p.id !== admin.id);
  assert.ok(subject);
  await withDatabase(async pool => {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const target = randomUUID();
      await new sql.Request(transaction)
        .input('account', sql.UniqueIdentifier, account)
        .input('actor', sql.UniqueIdentifier, admin.id)
        .input('target', sql.UniqueIdentifier, target)
        .input('before', sql.NVarChar(sql.MAX), JSON.stringify({ person_id: subject.id }))
        .input('after', sql.NVarChar(sql.MAX), JSON.stringify({ personId: admin.id })).query(`
          UPDATE dbo.AccessWorkspace WITH(UPDLOCK) SET revision=revision+1 WHERE account_id=@account;
          INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json)
          SELECT @account,revision,@actor,'business.responsibility',@target,@before,@after
          FROM dbo.AccessWorkspace WHERE account_id=@account;`);
      for (const personId of [subject.id, admin.id]) {
        const result = await new sql.Request(transaction)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, admin.id)
          .input('person_id', sql.UniqueIdentifier, personId)
          .input('include_details', sql.Bit, false)
          .execute('dbo.ReadAccessAuditPage');
        const records = result.recordsets as sql.IRecordSet<Record<string, unknown>>[];
        const event = records[1].find(row => String(row.targetId).toLowerCase() === target);
        assert.ok(event, 'Both the former and new subject can find this assignment event.');
        assert.equal(event.targetName, admin.displayName);
        assert.equal(event.before, null);
        assert.equal(event.after, null);
      }
    } finally {
      await transaction.rollback();
    }
  });
  console.log('Business assignment audit subject rollback fixture passed.');
} finally {
  await closeRuntimeDatabase();
}
