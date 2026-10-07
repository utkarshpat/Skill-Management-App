import assert from 'node:assert/strict';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';

// Opt-in setup-identity fixture; all edits are rolled back.
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
await withDatabase(async pool => {
  const installed = await pool
    .request()
    .query('SELECT version FROM dbo.SchemaMigration WHERE version=45;');
  assert.equal(installed.recordset.length, 1, 'Apply migration 045 first.');
  const setup = (
    await pool
      .request()
      .input('account', sql.UniqueIdentifier, account)
      .query(
        "SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account; SELECT TOP(1) person_id AS id FROM dbo.AccessPerson WHERE account_id=@account AND dbo.AccessCan(@account,person_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account,person_id,'users.manage',0)=1;",
      )
  ).recordsets as sql.IRecordSet<{ revision: number; id: string }>[];
  const actor = setup[1][0]?.id;
  assert.ok(actor);
  const revision = setup[0][0].revision;
  const read = async (tx: sql.Transaction) =>
    (
      await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .execute('dbo.ReadAccessWorkspace')
    ).recordsets as sql.IRecordSet<Record<string, unknown>>[];
  const run = async (
    action: (tx: sql.Transaction, body: Record<string, unknown>) => Promise<void>,
  ) => {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let aborted = false;
    tx.on('rollback', () => {
      aborted = true;
    });
    try {
      const sets = await read(tx),
        person = sets[3].find(row => row.id === actor)!;
      const body = {
        ...person,
        roleIds: sets[4].filter(row => row.personId === actor).map(row => row.roleId),
        overrides: sets[5]
          .filter(row => row.personId === actor)
          .map(({ permission, scope, effect, validUntil, reason }) => ({
            permission,
            scope,
            effect,
            validUntil,
            reason,
          })),
      };
      await action(tx, body);
    } finally {
      if (!aborted) await tx.rollback();
    }
  };
  const save = (
    tx: sql.Transaction,
    body: Record<string, unknown>,
    expected = revision,
    who = actor,
  ) =>
    new sql.Request(tx)
      .input('account_id', sql.UniqueIdentifier, account)
      .input('actor_id', sql.UniqueIdentifier, who)
      .input('expected_revision', sql.Int, expected)
      .input('kind', sql.VarChar(10), 'person')
      .input('target_id', sql.UniqueIdentifier, actor)
      .input('is_new', sql.Bit, false)
      .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(body))
      .execute('dbo.SaveAccessChange');
  await run(async (tx, body) => {
    await save(tx, { ...body, jobTitle: 'Engineer', grade: 'G4' });
    let sets = await read(tx),
      person = sets[3].find(row => row.id === actor)!;
    assert.equal(person.jobTitle, 'Engineer');
    assert.equal(person.grade, 'G4');
    const audit = sets[6].find(row => row.revision === revision + 1)!;
    assert.equal(JSON.parse(String(audit.after)).jobTitle, 'Engineer');
    const { jobTitle: _title, grade: _grade, ...legacy } = body;
    await save(tx, legacy, revision + 1);
    sets = await read(tx);
    assert.equal(sets[3].find(row => row.id === actor)!.grade, 'G4');
    await save(tx, { ...body, jobTitle: null, grade: ' ' }, revision + 2);
    sets = await read(tx);
    person = sets[3].find(row => row.id === actor)!;
    assert.equal(person.jobTitle, null);
    assert.equal(person.grade, null);
  });
  for (const bad of [
    { jobTitle: 42 },
    { grade: [] },
    { jobTitle: 'x'.repeat(101) },
    { grade: 'x'.repeat(41) },
    { jobTitle: 'x'.repeat(5000) },
  ])
    await run(async (tx, body) => {
      await assert.rejects(
        save(tx, { ...body, ...bad }),
        error => (error as { number: number }).number === 51000,
      );
    });
  await run(async (tx, body) => {
    await assert.rejects(
      save(tx, body, revision - 1),
      error => (error as { number: number }).number === 51009,
    );
  });
  await run(async (tx, body) => {
    await assert.rejects(
      save(tx, body, revision, '55555555-5555-4555-8555-555555555555'),
      error => (error as { number: number }).number === 51003,
    );
  });
  const fresh = await pool
    .request()
    .input('account', sql.UniqueIdentifier, account)
    .query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account;');
  assert.equal(fresh.recordset[0].revision, revision);
  console.log('Employment SQL fixture passed; writes and audits were rolled back.');
});
