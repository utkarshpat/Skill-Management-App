// Opt-in real SQL fixture: all records, scheduler state and migration DDL roll back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
const migration = await readFile(
  new URL(
    '../../../database/migrations/065_scheduled_certification_reminders.sql',
    import.meta.url,
  ),
  'utf8',
);
await withDatabase(async pool => {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const exists = await new sql.Request(tx).query(
      "SELECT OBJECT_ID('dbo.CertificationExpiryReminder') AS id",
    );
    if (!exists.recordset[0].id)
      for (const batch of migration.split(/^GO\s*$/m))
        if (batch.trim()) await new sql.Request(tx).batch(batch);
    const owner = (
      await new sql.Request(tx).input('account', sql.UniqueIdentifier, account).query(`
      SELECT TOP(1) person_id FROM dbo.AccessPerson WHERE account_id=@account AND active=1
       AND dbo.AccessCan(@account,person_id,'profile.view',1)=1 AND dbo.AccessCan(@account,person_id,'skill.view',1)=1
    `)
    ).recordset[0]?.person_id;
    assert.ok(owner, 'Fixture needs an active personal reader');
    const ids = Array.from({ length: 8 }, () => randomUUID());
    const renewal = randomUUID();
    for (const [index, offset] of [14, 10, 7, 5, 3, 0, 11, 15].entries()) {
      await new sql.Request(tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('owner', sql.UniqueIdentifier, owner)
        .input('id', sql.UniqueIdentifier, ids[index])
        .input('offset', sql.Int, offset).query(`
         INSERT dbo.CertificationRecord(account_id,id,person_id,revision,certification_name,provider,category,issue_date,expiry_date,credential_id,credential_url,notes,status)
         VALUES(@account,@id,@owner,1,N'Rollback reminder',N'QA',N'QA',DATEADD(day,-100,CONVERT(date,SYSUTCDATETIME())),DATEADD(day,@offset,CONVERT(date,SYSUTCDATETIME())),N'',N'',N'Rollback synthetic fixture','APPROVED')
        `);
    }
    const run = () =>
      new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .execute('dbo.GenerateCertificationExpiryReminders');
    const feed = () =>
      new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, owner)
        .execute('dbo.CertificationExpiryNotifications');
    const fixtureItems = (rows: Record<string, unknown>[]) =>
      rows.filter(row => ids.some(id => String(row.id).toLowerCase().includes(id)));
    await run();
    assert.equal(
      fixtureItems((await feed()).recordset).length,
      6,
      'All six milestones, no off-day reminders',
    );
    assert.equal((await run()).recordset[0].created, 0, 'Retry creates no duplicate reminders');
    // Advance scheduler start backwards to simulate missed daily runs, not the server clock.
    await new sql.Request(tx)
      .input('account', sql.UniqueIdentifier, account)
      .query(
        `UPDATE dbo.CertificationReminderSchedule SET enabled_date=DATEADD(day,-3,CONVERT(date,SYSUTCDATETIME())) WHERE account_id=@account`,
      );
    await run();
    const caughtUp = fixtureItems((await feed()).recordset);
    assert.ok(
      caughtUp.some(row => String(row.id).toLowerCase().includes(ids[6])),
      'Missed 14-day milestone is caught up',
    );
    const revision = (
      await new sql.Request(tx)
        .input('account', sql.UniqueIdentifier, account)
        .query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account')
    ).recordset[0].revision;
    await run();
    assert.equal(
      (
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account')
      ).recordset[0].revision,
      revision,
    );
    // A draft must not suppress reminders. Submitted renewal hides them immediately.
    await new sql.Request(tx)
      .input('account', sql.UniqueIdentifier, account)
      .input('owner', sql.UniqueIdentifier, owner)
      .input('id', sql.UniqueIdentifier, renewal)
      .input('source', sql.UniqueIdentifier, ids[0]).query(`
      INSERT dbo.CertificationRecord(account_id,id,person_id,revision,certification_name,provider,category,issue_date,expiry_date,credential_id,credential_url,notes,status,renewed_from_id)
      VALUES(@account,@id,@owner,1,N'Rollback reminder',N'QA',N'QA',CONVERT(date,SYSUTCDATETIME()),DATEADD(year,1,CONVERT(date,SYSUTCDATETIME())),N'',N'',N'Rollback renewal','DRAFT',@source)`);
    assert.ok(fixtureItems((await feed()).recordset).some(row => String(row.id).toLowerCase().includes(ids[0])));
    await new sql.Request(tx)
      .input('id', sql.UniqueIdentifier, renewal)
      .input('account', sql.UniqueIdentifier, account)
      .query(
        "UPDATE dbo.CertificationRecord SET status='SUBMITTED' WHERE account_id=@account AND id=@id",
      );
    assert.ok(!fixtureItems((await feed()).recordset).some(row => String(row.id).toLowerCase().includes(ids[0])));
    await new sql.Request(tx)
      .input('id', sql.UniqueIdentifier, renewal)
      .input('account', sql.UniqueIdentifier, account)
      .query(
        "UPDATE dbo.CertificationRecord SET status='REJECTED' WHERE account_id=@account AND id=@id",
      );
    assert.ok(fixtureItems((await feed()).recordset).some(row => String(row.id).toLowerCase().includes(ids[0])));
    console.log(
      'SQL reminders: six milestones, off-days, duplicate retry, catch-up, unchanged revision and renewal lifecycle passed; rollback only.',
    );
  } finally {
    await tx.rollback();
  }
});

