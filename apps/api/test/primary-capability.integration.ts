import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';

const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account, 'Set ACCESS_ACCOUNT_ID for a workspace with schema through 051.');
const migration = await readFile(
  new URL('../../../database/migrations/052_primary_capability.sql', import.meta.url),
  'utf8',
);
interface Fixture {
  tx: sql.Transaction;
  actor: string;
  employee: string;
  skill: string;
  draft: string;
  archived: string;
  revision: number;
  save: (
    body: Record<string, unknown>,
    expected?: number,
    actor?: string,
  ) => Promise<sql.IProcedureResult<unknown>>;
  read: () => Promise<Record<string, unknown>>;
  search: (actor?: string, page?: number) => Promise<sql.IProcedureResult<unknown>>;
  body: Record<string, unknown>;
}
await withDatabase(async pool => {
  const installed = (
    await pool.request().query('SELECT MAX(version) AS version FROM dbo.SchemaMigration')
  ).recordset[0].version;
  assert.ok(installed >= 51, 'Apply schema through 051 before the rollback-only fixture.');
  const baseline = (
    await pool
      .request()
      .input('account', sql.UniqueIdentifier, account)
      .query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account')
  ).recordset[0].revision;
  async function fixture(action: (f: Fixture) => Promise<void>) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let aborted = false;
    tx.on('rollback', () => {
      aborted = true;
    });
    try {
      // Test DDL and procedures without deploying migration 052.
      if (installed < 52)
        for (const batch of migration.split(/^GO\s*$/m))
          if (batch.trim()) await new sql.Request(tx).batch(batch);
      const actor = randomUUID(),
        employee = randomUUID(),
        skill = randomUUID(),
        draft = randomUUID(),
        archived = randomUUID();
      await new sql.Request(tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('actor', sql.UniqueIdentifier, actor)
        .input('employee', sql.UniqueIdentifier, employee)
        .input('skill', sql.UniqueIdentifier, skill)
        .input('draft', sql.UniqueIdentifier, draft)
        .input('archived', sql.UniqueIdentifier, archived).query(`
     INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active)
     SELECT @account,id,name,'QA-'+CONVERT(varchar(36),id),1 FROM (VALUES(@actor,N'Rollback capability administrator'),(@employee,N'Rollback capability employee')) p(id,name);
     INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until)
     SELECT @account,@actor,code,'ORGANIZATION','ALLOW',N'Rollback-only capability fixture',DATEADD(hour,1,SYSUTCDATETIME())
     FROM (VALUES('permissions.manage'),('users.manage')) p(code);
     INSERT dbo.SkillCatalogue(account_id,skill_id,display_name,category,description,status,definition_revision)
     SELECT @account,id,'Rollback capability '+CONVERT(varchar(36),@actor)+' '+CONVERT(varchar(36),id),N'QA',N'Rollback fixture',status,1
     FROM (VALUES(@skill,'PUBLISHED'),(@draft,'DRAFT'),(@archived,'ARCHIVED')) p(id,status);
    `);
      const save = (
        body: Record<string, unknown>,
        expected: number = baseline,
        who: string = actor,
      ) =>
        new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, who)
          .input('expected_revision', sql.Int, expected)
          .input('kind', sql.VarChar(10), 'person')
          .input('target_id', sql.UniqueIdentifier, employee)
          .input('is_new', sql.Bit, false)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(body))
          .execute('dbo.SaveAccessChange');
      const read = async () =>
        (
          await new sql.Request(tx)
            .input('account', sql.UniqueIdentifier, account)
            .input('employee', sql.UniqueIdentifier, employee)
            .query(
              'SELECT primary_capability_id AS id,job_title AS jobTitle,grade FROM dbo.AccessPerson WHERE account_id=@account AND person_id=@employee',
            )
        ).recordset[0];
      const search = (who: string = actor, page = 1) =>
        new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, who)
          .input('query', sql.NVarChar(100), 'Rollback capability ' + actor)
          .input('page', sql.Int, page)
          .execute('dbo.ReadPrimaryCapabilities');
      const body = {
        displayName: 'Rollback capability employee',
        employeeCode: 'QA-' + employee,
        active: true,
        roleIds: [],
        overrides: [],
      };
      await action({
        tx,
        actor,
        employee,
        skill,
        draft,
        archived,
        revision: baseline,
        save,
        read,
        search,
        body,
      });
    } finally {
      if (!aborted) await tx.rollback();
    }
  }
  await fixture(async f => {
    const result = await f.search(),
      sets = result.recordsets as sql.IRecordSet<Record<string, unknown>>[];
    assert.equal(sets[0][0].total, 1);
    assert.equal(sets[0][0].pageSize, 20);
    assert.deepEqual(
      sets[1].map(row => String(row.id).toLowerCase()),
      [f.skill],
    );
    const runtime = await new sql.Request(f.tx)
      .input('account', sql.UniqueIdentifier, account)
      .input('actor', sql.UniqueIdentifier, f.actor)
      .input('query', sql.NVarChar(100), 'Rollback capability ' + f.actor)
      .query(`EXECUTE AS USER=N'skill_management_runtime';
    BEGIN TRY
     EXEC dbo.ReadPrimaryCapabilities @account_id=@account,@actor_id=@actor,@query=@query;
     SELECT HAS_PERMS_BY_NAME(N'dbo.AccessPerson',N'OBJECT',N'SELECT') AS peopleRead,HAS_PERMS_BY_NAME(N'dbo.SkillCatalogue',N'OBJECT',N'SELECT') AS catalogueRead;
     REVERT;
    END TRY BEGIN CATCH REVERT;THROW;END CATCH;`);
    const runtimeSets = runtime.recordsets as sql.IRecordSet<Record<string, unknown>>[];
    assert.equal(runtimeSets[0][0].total, 1);
    assert.equal(runtimeSets[2][0].peopleRead, 0);
    assert.equal(runtimeSets[2][0].catalogueRead, 0);
    const empty = (await f.search(f.actor, 2)).recordsets as sql.IRecordSet<unknown>[];
    assert.equal(empty[1].length, 0);
    await f.save({ ...f.body, primaryCapabilityId: f.skill, jobTitle: 'Engineer', grade: 'G4' });
    assert.equal(String((await f.read()).id).toLowerCase(), f.skill);
    const audit = (
      await new sql.Request(f.tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('revision', sql.Int, f.revision + 1)
        .query(
          'SELECT after_json AS json FROM dbo.AccessAudit WHERE account_id=@account AND revision=@revision',
        )
    ).recordset[0];
    assert.equal(JSON.parse(audit.json).primaryCapabilityId.toLowerCase(), f.skill);
    const full = await new sql.Request(f.tx)
      .input('account_id', sql.UniqueIdentifier, account)
      .input('include_audit', sql.Bit, false)
      .execute('dbo.ReadAccessWorkspace');
    const people = (full.recordsets as sql.IRecordSet<Record<string, unknown>>[])[3],
      person = people.find(p => String(p.id).toLowerCase() === f.employee)!;
    assert.equal(person.primaryCapabilityStatus, 'PUBLISHED');
    assert.ok(person.primaryCapabilityName);
    const own = await new sql.Request(f.tx)
      .input('account_id', sql.UniqueIdentifier, account)
      .input('actor_id', sql.UniqueIdentifier, f.employee)
      .execute('dbo.ReadActorAccessContext');
    const ownPeople = (own.recordsets as sql.IRecordSet<Record<string, unknown>>[])[3];
    assert.equal(ownPeople.length, 1);
    assert.equal(String(ownPeople[0].primaryCapabilityId).toLowerCase(), f.skill);
    await new sql.Request(f.tx)
      .input('account', sql.UniqueIdentifier, account)
      .input('skill', sql.UniqueIdentifier, f.skill)
      .query(
        "UPDATE dbo.SkillCatalogue SET status='ARCHIVED' WHERE account_id=@account AND skill_id=@skill;",
      );
    await f.save({ ...f.body, jobTitle: 'Lead' }, f.revision + 1);
    assert.equal(String((await f.read()).id).toLowerCase(), f.skill);
    await f.save({ ...f.body, primaryCapabilityId: f.skill }, f.revision + 2);
    assert.equal(String((await f.read()).id).toLowerCase(), f.skill);
    await f.save({ ...f.body, primaryCapabilityId: null }, f.revision + 3);
    assert.equal((await f.read()).id, null);
  });
  await fixture(async f => {
    const person = randomUUID();
    await new sql.Request(f.tx)
      .input('account_id', sql.UniqueIdentifier, account)
      .input('actor_id', sql.UniqueIdentifier, f.actor)
      .input('expected_revision', sql.Int, f.revision)
      .input('kind', sql.VarChar(10), 'person')
      .input('target_id', sql.UniqueIdentifier, person)
      .input('is_new', sql.Bit, true)
      .input(
        'payload',
        sql.NVarChar(sql.MAX),
        JSON.stringify({ ...f.body, employeeCode: 'QA-' + person, primaryCapabilityId: f.skill }),
      )
      .execute('dbo.SaveAccessChange');
    const saved = (
      await new sql.Request(f.tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('person', sql.UniqueIdentifier, person)
        .query(
          'SELECT primary_capability_id AS id FROM dbo.AccessPerson WHERE account_id=@account AND person_id=@person',
        )
    ).recordset[0];
    assert.equal(String(saved.id).toLowerCase(), f.skill);
  });
  for (const kind of [
    'draft',
    'archived',
    'foreign',
    'suffix',
    'object',
    'array',
    'number',
  ] as const) {
    await fixture(async f => {
      const value = {
        draft: f.draft,
        archived: f.archived,
        foreign: randomUUID(),
        suffix: f.skill + 'suffix',
        object: { id: f.skill },
        array: [f.skill],
        number: 1,
      }[kind];
      await assert.rejects(f.save({ ...f.body, primaryCapabilityId: value }), error =>
        [51000, 51010].includes((error as { number: number }).number),
      );
    });
  }
  await fixture(async f => {
    await assert.rejects(
      f.save({ ...f.body, primaryCapabilityId: f.skill }, f.revision - 1),
      error => (error as { number: number }).number === 51009,
    );
  });
  await fixture(async f => {
    await assert.rejects(
      f.save({ ...f.body, primaryCapabilityId: f.skill }, f.revision, f.employee),
      error => (error as { number: number }).number === 51003,
    );
  });
  for (const permission of ['permissions.manage', 'users.manage']) {
    await fixture(async f => {
      await new sql.Request(f.tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('actor', sql.UniqueIdentifier, f.actor)
        .input('permission', sql.VarChar(100), permission)
        .query(
          "UPDATE dbo.AccessPersonOverride SET effect='DENY' WHERE account_id=@account AND person_id=@actor AND permission_code=@permission;",
        );
      await assert.rejects(f.search(), error => (error as { number: number }).number === 51003);
    });
    await fixture(async f => {
      await new sql.Request(f.tx)
        .input('account', sql.UniqueIdentifier, account)
        .input('actor', sql.UniqueIdentifier, f.actor)
        .input('permission', sql.VarChar(100), permission)
        .query(
          "UPDATE dbo.AccessPersonOverride SET effect='DENY' WHERE account_id=@account AND person_id=@actor AND permission_code=@permission;",
        );
      await assert.rejects(
        f.save({ ...f.body, primaryCapabilityId: f.skill }),
        error => (error as { number: number }).number === 51003,
      );
    });
  }
  await fixture(async f => {
    await new sql.Request(f.tx)
      .input('account', sql.UniqueIdentifier, account)
      .input('actor', sql.UniqueIdentifier, f.actor)
      .query(
        'UPDATE dbo.AccessPerson SET active=0 WHERE account_id=@account AND person_id=@actor;',
      );
    await assert.rejects(
      f.save({ ...f.body, primaryCapabilityId: f.skill }),
      error => (error as { number: number }).number === 51003,
    );
  });
  const fresh = (
    await pool
      .request()
      .input('account', sql.UniqueIdentifier, account)
      .query(
        'SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account; SELECT MAX(version) AS version FROM dbo.SchemaMigration;',
      )
  ).recordsets as sql.IRecordSet<{ revision: number; version: number }>[];
  assert.equal(fresh[0][0].revision, baseline);
  assert.equal(fresh[1][0].version, installed);
  console.log(
    'Primary capability SQL fixture passed; schema, selections, permissions and audits rolled back.',
  );
});
