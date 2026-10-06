import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withRuntimeDatabase, closeRuntimeDatabase } from '../src/shared/database.js';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
import { SqlOrganizationStore } from '../src/modules/organization/sql-store.js';
import { can } from '../src/modules/access/local-access-store.js';

const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
try {
  const access = await new SqlAccessStore(account).snapshot();
  const admin = access.people.find(
    person => can(access, person, 'permissions.manage') && can(access, person, 'users.manage'),
  )!;
  assert.ok(admin);
  const qa = access.people.find(person => person.id !== admin.id && person.active)!;
  assert.ok(qa);
  const before = await new SqlOrganizationStore(account).snapshot();
  await withRuntimeDatabase(async pool => {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const revision = async () =>
        Number(
          (
            (
              await new sql.Request(tx)
                .input('account', sql.UniqueIdentifier, account)
                .query('EXEC dbo.ReadOrganization @account_id=@account')
            ).recordsets as sql.IRecordSet<{ revision: number }>[]
          )[0][0].revision,
        );
      const save = async (
        kind: string,
        id: string,
        isNew: boolean,
        payload: object,
        actor = admin.id,
        expected?: number,
      ) =>
        new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('expected_revision', sql.Int, expected ?? (await revision()))
          .input('kind', sql.VarChar(20), kind)
          .input('target_id', sql.UniqueIdentifier, id)
          .input('is_new', sql.Bit, isNew)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .execute('dbo.SaveOrganizationChange');
      const unit = randomUUID(),
        department = randomUUID(),
        team = randomUUID();
      await save('node', unit, true, {
        type: 'DELIVERY_UNIT',
        name: `Integration ${unit}`,
        parentId: null,
        active: true,
      });
      await save('node', department, true, {
        type: 'DEPARTMENT',
        name: 'Integration department',
        parentId: unit,
        active: true,
      });
      await save('node', team, true, {
        type: 'TEAM',
        name: 'Integration team',
        parentId: department,
        active: true,
      });
      await save('assignment', qa.id, false, {
        departmentId: department,
        teamId: null,
        managerId: admin.id,
      });
      const departmentRead = await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .execute('dbo.ReadOrganization');
      assert.ok(
        (
          departmentRead.recordsets as sql.IRecordSet<{
            personId: string;
            departmentId: string;
            teamId: string | null;
          }>[]
        )[2].some(
          item =>
            item.personId.toLowerCase() === qa.id &&
            item.departmentId?.toLowerCase() === department &&
            item.teamId === null,
        ),
      );
      await save('assignment', qa.id, false, { teamId: team, managerId: admin.id });
      const read = await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .execute('dbo.ReadOrganization');
      assert.equal(
        (read.recordsets as sql.IRecordSet<unknown>[])[1].length,
        before.nodes.length + 3,
      );
      assert.ok(
        (read.recordsets as sql.IRecordSet<{ personId: string; teamId: string }>[])[2].some(
          (item: { personId: string; teamId: string }) =>
            item.personId.toLowerCase() === qa.id && item.teamId?.toLowerCase() === team,
        ),
      );
      await assert.rejects(
        save('assignment', admin.id, false, { teamId: null, managerId: qa.id }),
        error =>
          (error as { number: number }).number === 51000 && /cycle/.test((error as Error).message),
      );
    } finally {
      await tx.rollback().catch(() => undefined);
    }
    const archiveTx = new sql.Transaction(pool);
    await archiveTx.begin();
    try {
      const temporaryUnit = randomUUID(),
        temporaryDepartment = randomUUID();
      const change = async (kind: string, id: string, isNew: boolean, payload: object) => {
        const snapshot = await new sql.Request(archiveTx)
          .input('account_id', sql.UniqueIdentifier, account)
          .execute('dbo.ReadOrganization');
        const revision = (snapshot.recordsets as sql.IRecordSet<{ revision: number }>[])[0][0]
          .revision;
        return new sql.Request(archiveTx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, admin.id)
          .input('expected_revision', sql.Int, revision)
          .input('kind', sql.VarChar(20), kind)
          .input('target_id', sql.UniqueIdentifier, id)
          .input('is_new', sql.Bit, isNew)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .execute('dbo.SaveOrganizationChange');
      };
      await change('node', temporaryUnit, true, {
        type: 'DELIVERY_UNIT',
        name: `Archive ${temporaryUnit}`,
        parentId: null,
        active: true,
      });
      await change('node', temporaryDepartment, true, {
        type: 'DEPARTMENT',
        name: 'Direct membership archive fixture',
        parentId: temporaryUnit,
        active: true,
      });
      await change('assignment', qa.id, false, {
        departmentId: temporaryDepartment,
        managerId: null,
        teamId: null,
      });
      await assert.rejects(
        change('node', temporaryDepartment, false, {
          type: 'DEPARTMENT',
          name: 'Direct membership archive fixture',
          parentId: temporaryUnit,
          active: false,
        }),
        error =>
          (error as { number: number }).number === 51000 &&
          /assigned people/.test((error as Error).message),
      );
    } finally {
      await archiveTx.rollback().catch(() => undefined);
    }
    // Error paths each own a transaction because XACT_ABORT rolls back on THROW.
    const reject = async (
      payload: object,
      number: number,
      actor = admin.id,
      expected = before.revision,
    ) =>
      assert.rejects(
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('expected_revision', sql.Int, expected)
          .input('kind', sql.VarChar(20), 'assignment')
          .input('target_id', sql.UniqueIdentifier, qa.id)
          .input('is_new', sql.Bit, false)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .execute('dbo.SaveOrganizationChange'),
        error => (error as { number: number }).number === number,
      );
    await reject({ managerId: qa.id, teamId: null }, 51000);
    await reject({ managerId: randomUUID(), teamId: null }, 51000);
    await reject({ managerId: null, teamId: randomUUID() }, 51000);
    await reject({ managerId: null, departmentId: randomUUID() }, 51000);
    const currentTeam = before.nodes.find(node => node.kind === 'TEAM')!;
    await reject({ managerId: null, departmentId: currentTeam.id }, 51000);
    await reject(
      { managerId: null, teamId: currentTeam.id, departmentId: currentTeam.parentId },
      51000,
    );
    await assert.rejects(
      pool
        .request()
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, admin.id)
        .input('expected_revision', sql.Int, before.revision)
        .input('kind', sql.VarChar(20), 'node')
        .input('target_id', sql.UniqueIdentifier, currentTeam.id)
        .input('is_new', sql.Bit, false)
        .input(
          'payload',
          sql.NVarChar(sql.MAX),
          JSON.stringify({
            type: 'TEAM',
            name: currentTeam.name,
            parentId: currentTeam.parentId,
            active: false,
          }),
        )
        .execute('dbo.SaveOrganizationChange'),
      error => (error as { number: number }).number === 51000,
    );
    await reject({ managerId: null, teamId: null }, 51003, qa.id);
    await reject({ managerId: null, teamId: null }, 51009, admin.id, before.revision - 1);
    await assert.rejects(
      pool
        .request()
        .input('account_id', sql.UniqueIdentifier, randomUUID())
        .execute('dbo.ReadOrganization'),
      error => (error as { number: number }).number === 51003,
    );
    await assert.rejects(
      pool
        .request()
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, admin.id)
        .input('expected_revision', sql.Int, before.revision)
        .input('kind', sql.VarChar(20), 'node')
        .input('target_id', sql.UniqueIdentifier, randomUUID())
        .input('is_new', sql.Bit, true)
        .input(
          'payload',
          sql.NVarChar(sql.MAX),
          JSON.stringify({
            type: 'TEAM',
            name: 'Invalid parent',
            parentId: randomUUID(),
            active: true,
          }),
        )
        .execute('dbo.SaveOrganizationChange'),
      error => (error as { number: number }).number === 51000,
    );
    await assert.rejects(
      pool.request().query('SELECT TOP 1 * FROM dbo.AccessOrgNode'),
      error => (error as { number: number }).number === 229,
    );
  });
  await closeRuntimeDatabase();
  assert.deepEqual(
    await new SqlOrganizationStore(account).snapshot(),
    before,
    'Integration fixtures must leave no records or audit changes.',
  );
  console.log(
    'Organization SQL verified: hierarchy, assignment, restricted identity, invalid IDs, self-reporting, unauthorized/stale writes and full rollback.',
  );
} finally {
  await closeRuntimeDatabase();
}
