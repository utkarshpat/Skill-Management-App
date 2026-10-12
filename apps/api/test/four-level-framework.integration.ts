import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from '../src/shared/database.js';
import { proficiencyNames } from '../src/modules/skills/proficiency.js';
assert.equal(process.env.RUN_FRAMEWORK_SQL_TESTS, '1');
const account = process.env.ACCESS_ACCOUNT_ID!;
const source = await readFile(
  new URL('../../../database/migrations/074_four_level_proficiency.sql', import.meta.url),
  'utf8',
);
const oldSource = await readFile(
  new URL('../../../database/migrations/044_standard_proficiency.sql', import.meta.url),
  'utf8',
);
await withDatabase(async pool => {
  const info = (
    await pool
      .request()
      .query('SELECT DB_NAME() AS name,(SELECT MAX(version) FROM dbo.SchemaMigration) AS version')
  ).recordset[0];
  assert.match(info.name, /-dev$/i);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  let aborted = false;
  tx.on('rollback', () => (aborted = true));
  const [admin, manager, oldOwner, newOwner, skill, oldClaim, newClaim] = Array.from(
    { length: 7 },
    () => randomUUID(),
  );
  const prefix = 'F4QA-' + randomUUID().slice(0, 8);
  const req = () => new sql.Request(tx).input('a', sql.UniqueIdentifier, account);
  try {
    let r = req();
    for (const [key, id] of Object.entries({ admin, manager, oldOwner, newOwner }))
      r = r.input(key, sql.UniqueIdentifier, id);
    await r.input('prefix', sql.NVarChar(30), prefix)
      .query(`UPDATE dbo.AccessWorkspace SET personal_baseline_enabled=1 WHERE account_id=@a;
  INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) SELECT @a,id,@prefix+' '+name,CONVERT(varchar(36),id),1 FROM(VALUES(@admin,'Admin'),(@manager,'Manager'),(@oldOwner,'Old'),(@newOwner,'New'))p(id,name);
  INSERT dbo.AccessOrgAssignment(account_id,person_id,manager_id) VALUES(@a,@admin,NULL),(@a,@manager,NULL),(@a,@oldOwner,@manager),(@a,@newOwner,@manager);
  INSERT dbo.BusinessResponsibility VALUES(@a,NEWID(),@admin,'SYSTEM_ADMIN','ORGANIZATION',NULL,'ALLOW',1,NULL,N'Rollback four-level test');`);
    // Prepare historical data using the historical procedure inside this rollback-only fixture.
    if (info.version >= 74) {
      await new sql.Request(tx).batch(
        'DISABLE TRIGGER dbo.SkillCurrentFramework ON dbo.SkillClaimDraft;',
      );
      for (const b of oldSource
        .slice(oldSource.indexOf('CREATE OR ALTER PROCEDURE'))
        .split(/^GO\s*$/m))
        if (b.trim()) await new sql.Request(tx).batch(b);
    }
    const revision = async () =>
      Number(
        (await req().query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@a'))
          .recordset[0].revision,
      );
    const saveDefinition = async (
      levels: { rank: number; name: string; description: string }[],
      isNew: boolean,
    ) => {
      const rev = await revision();
      await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, admin)
        .input('expected_revision', sql.Int, rev)
        .input('target_id', sql.UniqueIdentifier, skill)
        .input('is_new', sql.Bit, isNew)
        .input(
          'payload',
          sql.NVarChar(sql.MAX),
          JSON.stringify({
            name: prefix,
            category: 'Rollback',
            description: 'Rollback-only framework criteria',
            status: 'PUBLISHED',
            levels,
          }),
        )
        .execute('dbo.SaveSkillCatalogue');
      return rev + 1;
    };
    const saveClaim = (
      owner: string,
      id: string,
      definition: number,
      rank: number,
      description = 'Rollback-only claim',
    ) =>
      new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, owner)
        .input('claim_id', sql.UniqueIdentifier, id)
        .input('expected_revision', sql.Int, 0)
        .input(
          'payload',
          sql.NVarChar(sql.MAX),
          JSON.stringify({
            skillId: skill,
            definitionRevision: definition,
            rank,
            experienceMonths: 12,
            description,
            projects: '',
            evidence: '',
            lastUsedOn: null,
          }),
        )
        .execute('dbo.SaveOwnSkillClaim');
    const oldLevels = ['Awareness', 'Foundation', 'Practitioner', 'Advanced', 'Expert'].map(
      (name, i) => ({ rank: i + 1, name, description: 'Old criterion ' + name }),
    );
    const oldVersion = await saveDefinition(oldLevels, true);
    await saveClaim(oldOwner, oldClaim, oldVersion, 5);
    await req()
      .input('id', sql.UniqueIdentifier, oldClaim)
      .input('m', sql.UniqueIdentifier, manager)
      .query(
        "UPDATE dbo.SkillClaimDraft SET status='APPROVED',reviewer_id=@m WHERE account_id=@a AND claim_id=@id",
      );
    const snapshot = async () =>
      (
        await req()
          .input('id', sql.UniqueIdentifier, oldClaim)
          .query(
            'SELECT (SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@a AND claim_id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json',
          )
      ).recordset[0].json;
    const before = await snapshot();
    const batches = source.split(/^GO\s*$/m);
    for (const [i, b] of batches.entries())
      if (b.trim() && (info.version < 74 || i > 0)) await new sql.Request(tx).batch(b);
    if (info.version >= 74)
      await new sql.Request(tx).batch(
        'ENABLE TRIGGER dbo.SkillCurrentFramework ON dbo.SkillClaimDraft;',
      );
    assert.equal(await snapshot(), before, 'Migration must preserve old claim facts exactly');
    const version = await saveDefinition(
      proficiencyNames.map((name, i) => ({
        rank: i + 1,
        name,
        description: 'New criterion ' + name,
      })),
      false,
    );
    const optionalDescription = await readFile(
      'database/migrations/076_optional_skill_description.sql',
      'utf8',
    );
    for (const batch of optionalDescription.split(/^GO\s*$/m))
      if (batch.trim()) await new sql.Request(tx).batch(batch);
    await saveClaim(newOwner, newClaim, version, 4, '');
    assert.equal(
      (
        await req()
          .input('claim', sql.UniqueIdentifier, newClaim)
          .query(
            'SELECT description FROM dbo.SkillClaimDraft WHERE account_id=@a AND claim_id=@claim',
          )
      ).recordset[0].description,
      '',
    );
    assert.equal(
      await snapshot(),
      before,
      'Optional descriptions must preserve existing claim history',
    );
    await req()
      .input('id', sql.UniqueIdentifier, newClaim)
      .input('m', sql.UniqueIdentifier, manager)
      .query(
        "UPDATE dbo.SkillClaimDraft SET status='APPROVED',reviewer_id=@m WHERE account_id=@a AND claim_id=@id",
      );
    const team = await new sql.Request(tx)
      .input('account_id', sql.UniqueIdentifier, account)
      .input('actor_id', sql.UniqueIdentifier, manager)
      .input('query', sql.NVarChar(100), prefix)
      .execute('dbo.ReadDirectReportCapability');
    const teamSets = team.recordsets as sql.IRecordSet<any>[];
    assert.equal(teamSets[3][0].reviewed, 2, 'History totals must retain both claims');
    assert.equal(teamSets[4].length, 4);
    assert.ok(
      teamSets[4].every(
        (row: any) => row.people === 1 && String(row.memberIds).toLowerCase() === newOwner,
      ),
    );
    assert.equal(teamSets[5][0].rank, 4);
    assert.equal(teamSets[5][0].count, 1);
    const match = await req()
      .input('old', sql.UniqueIdentifier, oldOwner)
      .input('new', sql.UniqueIdentifier, newOwner)
      .input(
        'requirements',
        sql.NVarChar(sql.MAX),
        JSON.stringify({ skills: [{ id: skill, minRank: 4 }], certifications: [] }),
      )
      .query(
        'SELECT matched FROM dbo.BusinessMatchRequirements(@a,@old,@requirements);SELECT matched FROM dbo.BusinessMatchRequirements(@a,@new,@requirements);',
      );
    const matchSets = match.recordsets as sql.IRecordSet<any>[];
    assert.equal(matchSets[0][0].matched, false);
    assert.equal(matchSets[1][0].matched, true);
    const dashboard = await new sql.Request(tx)
      .input('account_id', sql.UniqueIdentifier, account)
      .input('actor_id', sql.UniqueIdentifier, admin)
      .input(
        'payload',
        sql.NVarChar(sql.MAX),
        JSON.stringify({
          dataset: 'skills',
          search: prefix,
          status: '',
          validity: '',
          category: '',
          issuer: '',
          minRank: 1,
          maxRank: 4,
          page: 1,
          from: '',
          to: '',
        }),
      )
      .execute('dbo.BusinessDashboard');
    const body = JSON.parse(dashboard.recordset[0].json);
    assert.equal(body.total, 2);
    assert.ok(body.coverage.every((c: any) => c.rank === 4 && c.holders === 1));
    assert.equal(await snapshot(), before);
    // Last negative case intentionally aborts the fixture's transaction.
    await assert.rejects(
      () => saveDefinition(oldLevels, false),
      (e: any) => e.number === 51000,
    );
    console.log(
      'Four-level SQL passed: history retained, current rubric/version saved, old Expert excluded from new matching/coverage, raw history remains visible, five-level writes rejected. Fixture rolled back.',
    );
  } finally {
    if (!aborted) await tx.rollback();
  }
  const remaining = await pool
    .request()
    .input('a', sql.UniqueIdentifier, account)
    .input('person', sql.UniqueIdentifier, admin)
    .query('SELECT COUNT(*) AS n FROM dbo.AccessPerson WHERE account_id=@a AND person_id=@person');
  assert.equal(remaining.recordset[0].n, 0);
});
