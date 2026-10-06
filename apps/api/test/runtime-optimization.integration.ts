// Apply new definitions only inside rollback transactions. No persistent migration.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
await withDatabase(async pool => {
  const originalTables = (
    await pool.request().query("SELECT OBJECT_ID('dbo.AiActorBudget') AS actorBudget")
  ).recordset[0].actorBudget;
  const actor = (
    await pool
      .request()
      .input('account', sql.UniqueIdentifier, account)
      .query(
        "SELECT TOP(1) person_id AS id FROM dbo.AccessPerson WHERE account_id=@account AND dbo.AccessCan(@account,person_id,'profile.view',1)=1",
      )
  ).recordset[0]?.id;
  assert.ok(actor);
  const apply = async (tx: sql.Transaction, file: string) => {
    const source = await readFile(
      new URL('../../../database/migrations/' + file, import.meta.url),
      'utf8',
    );
    for (const [index, batch] of source.split(/^GO\s*$/m).entries())
      if (
        batch.trim() &&
        !(file === '040_shared_ai_budget.sql' && originalTables !== null && index === 0)
      )
        await new sql.Request(tx).batch(batch);
  };
  const fixture = async (run: (tx: sql.Transaction) => Promise<void>) => {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let rolledBack = false;
    tx.on('rollback', () => {
      rolledBack = true;
    });
    try {
      await run(tx);
    } finally {
      if (!rolledBack) await tx.rollback();
    }
  };
  await fixture(async tx => {
    const before = (
      await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .execute('dbo.ReadAccessWorkspace')
    ).recordsets;
    await apply(tx, '039_access_read_optimization.sql');
    const after = (
      await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('include_audit', sql.Bit, false)
        .execute('dbo.ReadAccessWorkspace')
    ).recordsets;
    const a = before as unknown as unknown[][],
      b = after as unknown as unknown[][];
    for (const index of [0, 1, 2, 3, 4, 5, 7]) assert.deepEqual(b[index], a[index]);
    assert.equal(b[6].length, 0);
    console.log('PASS: authorization records unchanged; audit payload omitted.');
  });
  for (const scenario of ['concurrency', 'quota', 'release'] as const)
    await fixture(async tx => {
      await apply(tx, '040_shared_ai_budget.sql');
      await new sql.Request(tx)
        .input('account', sql.UniqueIdentifier, account)
        .query(
          'DELETE FROM dbo.AiActorBudget WHERE account_id=@account; DELETE FROM dbo.AiAccountBudget WHERE account_id=@account;',
        );
      const first = randomUUID(),
        second = randomUUID();
      const run = (operation: string, lease = first) =>
        new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('lease_id', sql.UniqueIdentifier, lease)
          .input('operation', sql.VarChar(8), operation)
          .execute('dbo.AiRequestBudget');
      if (scenario === 'quota') {
        for (let n = 0; n < 10; n++) {
          await run('acquire');
          await run('release');
        }
        await assert.rejects(run('acquire'), e => (e as { number?: number }).number === 51029);
      } else {
        await run('acquire');
        if (scenario === 'release') {
          await run('release');
          await run('acquire', second);
          await run('release', first);
        }
        await assert.rejects(run('acquire'), e => (e as { number?: number }).number === 51029);
      }
      console.log('PASS: SQL budget ' + scenario + '.');
    });
  const tables = await pool.request().query("SELECT OBJECT_ID('dbo.AiActorBudget') AS actorBudget");
  assert.equal(tables.recordset[0].actorBudget, originalTables);
  console.log('PASS: test schema changes rolled back.');
});
