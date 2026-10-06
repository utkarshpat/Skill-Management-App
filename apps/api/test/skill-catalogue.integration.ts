import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withRuntimeDatabase, closeRuntimeDatabase } from '../src/shared/database.js';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
import { SqlCatalogueStore } from '../src/modules/skills/sql-store.js';
import { can } from '../src/modules/access/local-access-store.js';
import { proficiencyNames } from '../src/modules/skills/proficiency.js';

const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
try {
  const accessStore = new SqlAccessStore(account),
    access = await accessStore.snapshot();
  const admin = access.people.find(person => can(access, person, 'skill.catalogue.manage'));
  const viewer = access.people.find(
    person =>
      person.id !== admin?.id &&
      can(access, person, 'skill.view') &&
      !can(access, person, 'skill.catalogue.manage'),
  );
  assert.ok(admin, 'Assign an explicit catalogue-management permission first.');
  assert.ok(viewer);
  const catalogue = new SqlCatalogueStore(account),
    query = { search: '', status: '' as const, page: 1 };
  const before = await catalogue.read(admin.id, query),
    accessBefore = await accessStore.snapshot();
  const prefix = 'Catalogue SQL ' + randomUUID();
  const skillIds: string[] = Array.from({ length: 28 }, () => randomUUID());
  const definition = (name: string, status = 'PUBLISHED') => ({
    name,
    category: 'Integration test',
    description: 'Test definition',
    status,
    levels: proficiencyNames.map((label, index) => ({
      rank: index + 1,
      name: label,
      description: 'Criteria for ' + label,
    })),
  });
  await withRuntimeDatabase(async pool => {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (let index = 0; index < 28; index++)
        await new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, admin.id)
          .input('expected_revision', sql.Int, before.revision + index)
          .input('target_id', sql.UniqueIdentifier, skillIds[index])
          .input('is_new', sql.Bit, true)
          .input(
            'payload',
            sql.NVarChar(sql.MAX),
            JSON.stringify(
              definition(prefix + index, ['PUBLISHED', 'DRAFT', 'ARCHIVED'][index] ?? 'DRAFT'),
            ),
          )
          .execute('dbo.SaveSkillCatalogue');
      const read = async (actor = admin.id, page = 1) =>
        new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('query', sql.NVarChar(100), prefix)
          .input('page', sql.Int, page)
          .execute('dbo.ReadSkillCatalogue');
      const ownerRead = await read();
      const ownerSets = ownerRead.recordsets as sql.IRecordSet<Record<string, unknown>>[];
      assert.equal(ownerSets[0][0].total, 28);
      assert.equal(ownerSets[1].length, 25);
      assert.equal(ownerSets[2].length, 125);
      const pageTwo = (await read(admin.id, 2)).recordsets as sql.IRecordSet<
        Record<string, unknown>
      >[];
      assert.equal(pageTwo[1].length, 3);
      assert.equal(pageTwo[2].length, 15);
      assert.ok(pageTwo[1].every(item => !ownerSets[1].some(first => first.id === item.id)));
      const viewerSets = (await read(viewer.id)).recordsets as sql.IRecordSet<
        Record<string, unknown>
      >[];
      assert.equal(viewerSets[0][0].total, 1);
      assert.equal(viewerSets[1][0].status, 'PUBLISHED');
      assert.equal(viewerSets[2].length, 5);
      const audit = await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .execute('dbo.ReadAccessWorkspace');
      assert.equal(
        (audit.recordsets as sql.IRecordSet<{ action: string; targetId: string }>[])[6].filter(
          item => item.action === 'skill.created' && skillIds.includes(item.targetId.toLowerCase()),
        ).length,
        28,
      );
      await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, admin.id)
        .input('expected_revision', sql.Int, before.revision + 28)
        .input('target_id', sql.UniqueIdentifier, skillIds[0])
        .input('is_new', sql.Bit, false)
        .input(
          'payload',
          sql.NVarChar(sql.MAX),
          JSON.stringify(definition(prefix + '0', 'ARCHIVED')),
        )
        .execute('dbo.SaveSkillCatalogue');
      assert.equal(
        ((await read(viewer.id)).recordsets as sql.IRecordSet<{ total: number }>[])[0][0].total,
        0,
      );
    } finally {
      await tx.rollback().catch(() => undefined);
    }
    // Error paths each own their transaction: THROW deliberately rolls back all writes.
    const reject = async (
      payload: object,
      number: number,
      actor = admin.id,
      revision = before.revision,
      id = randomUUID(),
      isNew = true,
    ) =>
      assert.rejects(
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('expected_revision', sql.Int, revision)
          .input('target_id', sql.UniqueIdentifier, id)
          .input('is_new', sql.Bit, isNew)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .execute('dbo.SaveSkillCatalogue'),
        error => (error as { number: number }).number === number,
      );
    await reject(definition(prefix), 51003, viewer.id);
    await reject(definition(prefix), 51009, admin.id, before.revision - 1);
    await reject(definition(prefix), 51004, admin.id, before.revision, randomUUID(), false);
    await reject(
      { ...definition(prefix), levels: [{ rank: 1, name: 'Foundation', description: '' }] },
      51000,
    );
    await reject(
      { ...definition(prefix), levels: [{ rank: 3, name: 'Foundation', description: 'Criteria' }] },
      51000,
    );
    for (const levels of [
      definition(prefix).levels.slice(0, 4),
      definition(prefix).levels.map(level =>
        level.rank === 2 ? { ...level, name: 'Beginner' } : level,
      ),
      definition(prefix).levels.map(level => ({ ...level, name: level.name.toLowerCase() })),
      definition(prefix).levels.map(level =>
        level.rank === 5 ? { ...level, description: '' } : level,
      ),
    ])
      await reject({ ...definition(prefix), levels }, 51000);
    await assert.rejects(
      pool
        .request()
        .input('account_id', sql.UniqueIdentifier, randomUUID())
        .input('actor_id', sql.UniqueIdentifier, admin.id)
        .execute('dbo.ReadSkillCatalogue'),
      error => (error as { number: number }).number === 51003,
    );
    await assert.rejects(
      pool.request().query('SELECT TOP 1 * FROM dbo.SkillCatalogue'),
      error => (error as { number: number }).number === 229,
    );
    const duplicates = new sql.Transaction(pool);
    await duplicates.begin();
    try {
      const insert = async (name: string, revision: number) =>
        new sql.Request(duplicates)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, admin.id)
          .input('expected_revision', sql.Int, revision)
          .input('target_id', sql.UniqueIdentifier, randomUUID())
          .input('is_new', sql.Bit, true)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(definition(name)))
          .execute('dbo.SaveSkillCatalogue');
      await insert(prefix, before.revision);
      await assert.rejects(insert(prefix.toUpperCase(), before.revision + 1), error =>
        [2601, 2627].includes((error as { number: number }).number),
      );
    } finally {
      await duplicates.rollback().catch(() => undefined);
    }
  });
  assert.deepEqual(await catalogue.read(admin.id, query), before);
  assert.deepEqual(await accessStore.snapshot(), accessBefore);
  console.log(
    'Catalogue SQL verified: published-only reads, pagination, case-insensitive uniqueness, create/archive, criteria, current permissions, workspace isolation, stale writes, audit, restricted principal and fixture rollback.',
  );
} finally {
  await closeRuntimeDatabase();
}
