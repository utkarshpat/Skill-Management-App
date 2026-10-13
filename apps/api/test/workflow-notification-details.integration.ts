// Read-only development verification: no records, grants or decisions are changed.
import assert from 'node:assert/strict';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
await withDatabase(async pool => {
  assert.match(
    (await pool.request().query('SELECT DB_NAME() AS name')).recordset[0].name,
    /-dev$/i,
  );
  const actors = (
    await pool.request().input('a', sql.UniqueIdentifier, account).query(`
    SELECT DISTINCT TOP(5) p.person_id AS id FROM dbo.AccessPerson p
    JOIN dbo.WorkflowRecord r ON r.account_id=p.account_id AND r.requester_id=p.person_id
    JOIN dbo.WorkflowEvent e ON e.account_id=r.account_id AND e.record_id=r.record_id AND e.actor_id<>p.person_id
    WHERE p.account_id=@a AND p.active=1 AND dbo.WorkflowCanView(@a,p.person_id,r.record_id)=1;`)
  ).recordset;
  assert.ok(actors.length);
  let checked = 0;
  for (const actor of actors) {
    const rows: Array<{
      id: string;
      actorName: string;
      subject: string;
      body: string;
      actionLabel: string;
    }> = (
      await pool
        .request()
        .input('a', sql.UniqueIdentifier, account)
        .input('actor', sql.UniqueIdentifier, actor.id).query(`
      EXECUTE AS USER=N'skill_management_runtime';
      BEGIN TRY EXEC dbo.WorkflowWorkspace @account_id=@a,@actor_id=@actor,@mode='NOTIFICATIONS'; REVERT; END TRY
      BEGIN CATCH REVERT; THROW; END CATCH;`)
    ).recordset;
    for (const row of rows.slice(0, 5)) {
      const expected: {
        actorName: string;
        subject: string;
        body: string;
        kind: string;
        actorId: string;
        owner: string;
        recipient: string;
      } = (
        await pool
          .request()
          .input('a', sql.UniqueIdentifier, account)
          .input('id', sql.UniqueIdentifier, row.id).query(`
        SELECT actor.display_name AS actorName,r.title AS subject,LEFT(e.body,500) AS body,r.kind,
        e.actor_id AS actorId,r.requester_id AS owner,r.recipient_id AS recipient
        FROM dbo.WorkflowEvent e JOIN dbo.WorkflowRecord r ON r.account_id=e.account_id AND r.record_id=e.record_id
        JOIN dbo.AccessPerson actor ON actor.account_id=e.account_id AND actor.person_id=e.actor_id
        WHERE e.account_id=@a AND e.event_id=@id;`)
      ).recordset[0];
      assert.ok(expected);
      assert.equal(row.actorName, expected.actorName);
      assert.equal(row.subject, expected.subject);
      assert.equal(row.body, expected.body);
      assert.equal(row.actionLabel, 'View ' + expected.kind.toLowerCase());
      assert.notEqual(expected.actorId.toLowerCase(), actor.id.toLowerCase());
      assert.ok(
        [expected.owner.toLowerCase(), expected.recipient.toLowerCase()].includes(
          actor.id.toLowerCase(),
        ),
      );
      checked++;
    }
  }
  assert.ok(checked > 0);
  console.log(`Read-only workflow notification details verified for ${checked} authorized events.`);
});
