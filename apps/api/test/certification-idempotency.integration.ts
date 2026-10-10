// Opt-in setup-identity verification. Each scenario rolls back fixture data and DDL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account, 'Set ACCESS_ACCOUNT_ID; schema through 058 is required.');
const migration = await readFile(
  new URL('../../../database/migrations/059_certification_send_idempotency.sql', import.meta.url),
  'utf8',
);
await withDatabase(async pool => {
  const version = (
    await pool.request().query('SELECT MAX(version) AS version FROM dbo.SchemaMigration')
  ).recordset[0].version;
  assert.ok(version >= 58);
  for (const scenario of [
    'replay',
    'payload-conflict',
    'revoked',
    'sender-conflict',
    'notification-accept',
    'notification-decline',
    'notification-discuss',
  ] as const) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let rolledBack = false;
    tx.on('rollback', () => {
      rolledBack = true;
    });
    try {
      for (const batch of migration.split(/^GO\s*$/m))
        if (batch.trim()) await new sql.Request(tx).batch(batch);
      const manager = randomUUID(),
        person = randomUUID(),
        other = randomUUID(),
        id = randomUUID();
      await new sql.Request(tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('manager', sql.UniqueIdentifier, manager)
        .input('person', sql.UniqueIdentifier, person)
        .input('other', sql.UniqueIdentifier, other).query(`
        INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active)
        SELECT @account,id,N'Rollback idempotency fixture','QA-'+CONVERT(varchar(36),id),1 FROM (VALUES(@manager),(@person),(@other)) p(id);
        INSERT dbo.AccessOrgAssignment(account_id,person_id,manager_id) VALUES(@account,@manager,NULL),(@account,@person,@manager),(@account,@other,NULL);
        INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until)
        SELECT @account,p.id,g.code,g.scope,'ALLOW',N'Rollback idempotency fixture',DATEADD(hour,1,SYSUTCDATETIME())
        FROM (VALUES(@manager),(@person),(@other)) p(id) CROSS JOIN (VALUES('profile.view','OWN'),('skill.view','ORGANIZATION'),('learning.view','OWN'),('learning.manage','OWN')) g(code,scope);
      `);
      const payload = {
        id,
        personId: person,
        certificationName: 'QA Cloud',
        provider: 'Issuer',
        category: 'Cloud',
        reason: 'Development',
        credentialUrl: '',
      };
      const send = (actor: string, body = payload) =>
        new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('actor', sql.UniqueIdentifier, actor)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(body)).query(`
        EXECUTE AS USER=N'skill_management_runtime';
        BEGIN TRY EXEC dbo.CertificationRecommendations @account_id=@account,@actor_id=@actor,@action='SEND',@payload=@payload; REVERT; END TRY BEGIN CATCH REVERT;THROW;END CATCH;
      `);
      await send(manager);
      if (scenario === 'replay') {
        await send(manager);
        await send(manager);
        const counts: { records: number; events: number } = (
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('id', sql.UniqueIdentifier, id).query(`
          SELECT (SELECT COUNT(*) FROM dbo.CertificationRecommendation WHERE account_id=@account AND id=@id) AS records,
          (SELECT COUNT(*) FROM dbo.CertificationRecommendationEvent WHERE account_id=@account AND id=@id AND action='SEND') AS events;
        `)
        ).recordset[0];
        assert.equal(counts.records, 1);
        assert.equal(counts.events, 1);
      } else if (scenario.startsWith('notification-')) {
        const action =
          scenario === 'notification-accept'
            ? 'ACCEPT'
            : scenario === 'notification-decline'
              ? 'DECLINE'
              : 'DISCUSS';
        const message = action === 'DISCUSS' ? 'Talk through prerequisites' : '';
        await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('person', sql.UniqueIdentifier, person)
          .input('action', sql.VarChar(20), action)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify({ id, revision: 1, message }))
          .query(`
          EXECUTE AS USER=N'skill_management_runtime';
          BEGIN TRY EXEC dbo.CertificationRecommendations @account_id=@account,@actor_id=@person,@action=@action,@payload=@payload; REVERT; END TRY BEGIN CATCH REVERT;THROW;END CATCH;
        `);
        const notifications: sql.IResult<Record<string, unknown>> = await new sql.Request(tx)
          .input('account', sql.UniqueIdentifier, account)
          .input('manager', sql.UniqueIdentifier, manager).query(`
          EXECUTE AS USER=N'skill_management_runtime';
          BEGIN TRY EXEC dbo.CertificationRecommendations @account_id=@account,@actor_id=@manager,@action='NOTIFICATIONS',@payload=N'{}'; REVERT; END TRY BEGIN CATCH REVERT;THROW;END CATCH;
        `);
        const notification: Record<string, unknown> | undefined = notifications.recordset.find(
          row => row.id === 'cert-recommendation-' + id + '-2',
        );
        assert.ok(notification);
        assert.equal(
          notification.title,
          'Rollback idempotency fixture ' +
            (action === 'ACCEPT'
              ? 'accepted a certification recommendation'
              : action === 'DECLINE'
                ? 'declined a certification recommendation'
                : 'requested a discussion about a certification recommendation'),
        );
        assert.equal(notification.body, 'QA Cloud' + (message ? ' · ' + message : ''));
        assert.equal(
          notification.href,
          '/skill-reviews?type=certifications&tab=recommendations&direction=sent&recommendation=' +
            id,
        );
      } else {
        if (scenario === 'revoked')
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('person', sql.UniqueIdentifier, person)
            .query(
              'UPDATE dbo.AccessOrgAssignment SET manager_id=NULL WHERE account_id=@account AND person_id=@person',
            );
        if (scenario === 'sender-conflict')
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('person', sql.UniqueIdentifier, person)
            .input('other', sql.UniqueIdentifier, other)
            .query(
              'UPDATE dbo.AccessOrgAssignment SET manager_id=@other WHERE account_id=@account AND person_id=@person',
            );
        await assert.rejects(
          send(
            scenario === 'sender-conflict' ? other : manager,
            scenario === 'payload-conflict' ? { ...payload, reason: 'Changed intent' } : payload,
          ),
          e => (e as { number: number }).number === (scenario === 'revoked' ? 51003 : 51009),
        );
      }
      console.log('PASS rollback fixture:', scenario);
    } finally {
      if (!rolledBack) await tx.rollback();
    }
  }
});
