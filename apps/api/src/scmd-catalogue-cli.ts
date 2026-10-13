import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withDatabase } from './shared/database.js';

// Operator-only FDD catalogue provisioning; never called by startup or HTTP.
const operatorArg = process.argv.find(a => a.startsWith('--operator='));
if (
  !operatorArg ||
  process.argv
    .slice(2)
    .some(a => a !== '--apply' && a !== '--verify' && !a.startsWith('--operator='))
)
  throw Error(
    'Specify the existing authorized operator with --operator=<person UUID>; preview first, then --apply.',
  );
const operator = operatorArg.slice('--operator='.length);
const account = process.env.ACCESS_ACCOUNT_ID!;
const source = JSON.parse(
  await readFile(
    new URL('../../../database/seeds/scmd-catalogue-v1.json', import.meta.url),
    'utf8',
  ),
);
await withDatabase(async pool => {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  let committed = false;
  try {
    const req = () =>
      new sql.Request(tx)
        .input('a', sql.UniqueIdentifier, account)
        .input('actor', sql.UniqueIdentifier, operator);
    const snapshot = await req()
      .query(`SELECT DB_NAME() AS databaseName,w.revision,dbo.AccessCan(@a,@actor,'skill.catalogue.manage',0) AS allowed FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.AccessPerson p ON p.account_id=w.account_id AND p.person_id=@actor AND p.active=1 AND p.entra_object_id IS NOT NULL WHERE w.account_id=@a;
      SELECT skill_id AS id,business_code AS code,display_name AS name,status FROM dbo.SkillCatalogue WHERE account_id=@a;
      SELECT id,name,active FROM dbo.CredentialProvider WHERE account_id=@a;
      SELECT id,name,provider_id AS providerId,category,description,active,revision FROM dbo.CredentialDefinition WHERE account_id=@a;
      SELECT credential_id AS credentialId,skill_id AS skillId FROM dbo.CredentialSkillMapping WHERE account_id=@a;`);
    const records = snapshot.recordsets as sql.IRecordSet<any>[];
    const header = records[0][0];
    if (!header?.allowed || !/(?:^|-)dev$/i.test(header.databaseName))
      throw Error('Development database and active linked catalogue operator required.');
    const context = JSON.parse(
      (
        await new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, operator)
          .execute('dbo.BusinessContext')
      ).recordset[0].json,
    );
    if (!context.canApprove) throw Error('Current governed catalogue approval authority required.');
    const skills = records[1],
      providers = records[2],
      credentials = records[3];
    const newSkills = source.skills.filter(
      (s: any) =>
        !skills.some(
          (old: any) => old.code === s.code || old.name.toLowerCase() === s.name.toLowerCase(),
        ),
    );
    for (const skill of source.skills) {
      if (!/^SKL-\d{3}$/.test(skill.code)) throw Error('Invalid catalogue business code.');
      if (
        skills.some(
          (old: any) =>
            old.code === skill.code && old.name.toLowerCase() !== skill.name.toLowerCase(),
        )
      )
        throw Error('Business code already belongs to another skill: ' + skill.code);
    }
    const oracle = providers.find((p: any) => p.name.toLowerCase() === 'oracle');
    if (oracle && !oracle.active)
      throw Error('Existing Oracle provider is retired; review it through amendments first.');
    const existingCredentials = credentials.filter(
      (c: any) =>
        oracle &&
        c.providerId.toLowerCase() === oracle.id.toLowerCase() &&
        source.credentials.some((s: any) => s.name === c.name),
    );
    if (existingCredentials.some((c: any) => !c.active))
      throw Error('A matching credential is retired; review it through amendments first.');
    const mapped = (id: string) =>
      records[4].some((row: any) => row.credentialId.toLowerCase() === id.toLowerCase());
    const plan = {
      newSkills: newSkills.map((s: any) => s.name),
      createProvider: !oracle,
      newCredentials: source.credentials
        .filter((s: any) => !existingCredentials.some((c: any) => c.name === s.name))
        .map((s: any) => s.name),
      addMappings: existingCredentials.filter((c: any) => !mapped(c.id)).map((c: any) => c.name),
    };
    const receipt = createHash('sha256')
      .update(
        JSON.stringify({
          account,
          operator,
          revision: header.revision,
          source,
          records: records.slice(1),
        }),
      )
      .digest('hex');
    console.log(JSON.stringify({ plan, receipt, employeeClaimsChanged: 0 }));
    if (!process.argv.includes('--apply') && !process.argv.includes('--verify')) {
      await writeFile(
        new URL('../../../.local/scmd-catalogue-preview.json', import.meta.url),
        JSON.stringify({ receipt }),
      );
      return;
    }
    const preview = JSON.parse(
      await readFile(
        new URL('../../../.local/scmd-catalogue-preview.json', import.meta.url),
        'utf8',
      ),
    );
    if (preview.receipt !== receipt)
      throw Error('Preview changed. Run a fresh preview before applying.');
    const revision = async () =>
      (await req().query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@a'))
        .recordset[0].revision;
    for (const skill of newSkills) {
      const id = randomUUID();
      await new sql.Request(tx)
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, operator)
        .input('expected_revision', sql.Int, await revision())
        .input('target_id', sql.UniqueIdentifier, id)
        .input('is_new', sql.Bit, true)
        .input(
          'payload',
          sql.NVarChar(sql.MAX),
          JSON.stringify({
            name: skill.name,
            businessCode: skill.code,
            category: skill.category,
            description: skill.description,
            status: 'PUBLISHED',
            levels: skill.levels,
          }),
        )
        .execute('dbo.SaveSkillCatalogue');
      skills.push({ id, code: skill.code, name: skill.name, status: 'PUBLISHED' });
    }
    const amend = async (type: string, definition: object, targetId: string | null = null) => {
      const id = randomUUID();
      const run = async (operation: string, payload: object) =>
        new sql.Request(tx)
          .input('account_id', sql.UniqueIdentifier, account)
          .input('actor_id', sql.UniqueIdentifier, operator)
          .input('operation', sql.VarChar(30), operation)
          .input(
            'payload',
            sql.NVarChar(sql.MAX),
            JSON.stringify({ ...payload, accessRevision: await revision() }),
          )
          .execute('dbo.BusinessWorkflow');
      await run('PROPOSE', {
        id,
        revision: await revision(),
        type,
        targetId,
        isNew: !targetId,
        reason:
          'User-authorized FDD catalogue setup with verified Oracle credential titles; no employee claims.',
        definition,
      });
      const row = (
        await req()
          .input('id', sql.UniqueIdentifier, id)
          .query(
            'SELECT revision,target_id AS target FROM dbo.MasterAmendment WHERE account_id=@a AND id=@id',
          )
      ).recordset[0];
      await run('APPROVE_AMENDMENT', {
        id,
        revision: row.revision,
        note: 'FDD catalogue content approved by the operator. Credential titles checked against Oracle; mappings remain human-confirmed application defaults.',
      });
      return row.target;
    };
    const providerId = oracle?.id ?? (await amend('PROVIDER', { name: 'Oracle', active: true }));
    for (const credential of source.credentials) {
      const existing = existingCredentials.find((c: any) => c.name === credential.name);
      if (existing && mapped(existing.id)) continue;
      const ids = credential.skillCodes.map((code: string) => {
        const canonical = source.skills.find((s: any) => s.code === code);
        const skill = skills.find(
          (s: any) => s.code === code || s.name.toLowerCase() === canonical.name.toLowerCase(),
        );
        if (!skill || skill.status !== 'PUBLISHED')
          throw Error('Mapped skill requires a published catalogue definition: ' + code);
        return skill.id;
      });
      await amend(
        'CERTIFICATION',
        {
          name: credential.name,
          providerId,
          category: existing?.category ?? credential.category,
          description: existing?.description ?? credential.description,
          active: true,
          relatedSkillIds: ids,
        },
        existing?.id ?? null,
      );
    }
    if (process.argv.includes('--verify')) {
      console.log(
        'PASS complete catalogue provisioning; rolling back every skill, credential, mapping and audit change.',
      );
      return;
    }
    await tx.commit();
    committed = true;
    console.log(
      'SCMD catalogue masters applied atomically through governed audited operations. Existing definitions and employee records preserved.',
    );
  } finally {
    if (!committed) await tx.rollback().catch(() => {});
  }
});
