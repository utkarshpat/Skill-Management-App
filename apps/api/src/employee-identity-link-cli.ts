import { readFile } from 'node:fs/promises';
import { ClientSecretCredential } from '@azure/identity';
import sql from 'mssql';
import { withDatabase } from './shared/database.js';
import {
  directoryId,
  identityRoster,
  resolveEmployeeIdentities,
} from './employee-identity-roster.js';

const bind = `
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
BEGIN TRANSACTION;
BEGIN TRY
 IF NOT EXISTS (SELECT 1 FROM dbo.Account WITH (HOLDLOCK)
  WHERE account_id=@account AND entra_tenant_id=@tenant AND status='ACTIVE')
  THROW 51000,'Active workspace tenant mismatch.',1;
 DECLARE @revision int;
 SELECT @revision=revision FROM dbo.AccessWorkspace WITH (UPDLOCK,HOLDLOCK) WHERE account_id=@account;
 IF @revision IS NULL THROW 51000,'Workspace revision unavailable.',1;
 SELECT m.employeeCode,m.objectId,p.person_id,p.entra_object_id,p.active
 INTO #identity
 FROM OPENJSON(@mapping) WITH (employeeCode nvarchar(40),objectId uniqueidentifier) m
 LEFT JOIN dbo.AccessPerson p WITH (UPDLOCK,HOLDLOCK)
  ON p.account_id=@account AND p.employee_code=m.employeeCode;
 IF EXISTS (SELECT 1 FROM #identity WHERE person_id IS NULL OR
  (entra_object_id IS NOT NULL AND entra_object_id<>objectId))
  THROW 51000,'Roster contains a missing employee or a conflicting existing binding.',1;
 IF EXISTS (SELECT 1 FROM #identity i JOIN dbo.AccessPerson p WITH (UPDLOCK,HOLDLOCK)
  ON p.account_id=@account AND p.entra_object_id=i.objectId AND p.person_id<>i.person_id)
  THROW 51000,'Directory identity is already linked to another employee.',1;
 IF EXISTS (SELECT 1 FROM #identity GROUP BY person_id HAVING COUNT(*)>1)
  THROW 51000,'Multiple roster entries matched the same employee.',1;
 DECLARE @changes int=(SELECT COUNT(*) FROM #identity WHERE entra_object_id IS NULL);
 DECLARE @snapshot nvarchar(max)=(SELECT employeeCode,objectId,person_id,entra_object_id,active
  FROM #identity ORDER BY employeeCode FOR JSON PATH,INCLUDE_NULL_VALUES);
 DECLARE @receipt varchar(64)=CONVERT(varchar(64),HASHBYTES('SHA2_256',
  CONCAT(@account,'|',@tenant,'|',@revision,'|',@snapshot)),2);
 IF @expected IS NOT NULL AND @expected<>@receipt
  THROW 51000,'Binding preview changed. Review the current batch before applying.',1;
 IF @expected IS NOT NULL AND @changes>0
 BEGIN
  IF OBJECT_ID(N'dbo.OperationsIdentityBindingAudit',N'U') IS NULL
   THROW 51000,'Identity binding audit table is required.',1;
  UPDATE p SET entra_object_id=i.objectId
  FROM dbo.AccessPerson p JOIN #identity i ON i.person_id=p.person_id
  WHERE p.account_id=@account AND p.entra_object_id IS NULL;
  IF @@ROWCOUNT<>@changes THROW 51000,'Binding count changed.',1;
  UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account AND revision=@revision;
  IF @@ROWCOUNT<>1 THROW 51000,'Workspace revision changed.',1;
  INSERT dbo.OperationsIdentityBindingAudit
   (id,account_id,person_id,tenant_id,object_id,occurred_at,sql_operator,revision,before_json,after_json)
  SELECT NEWID(),@account,i.person_id,@tenant,i.objectId,SYSUTCDATETIME(),ORIGINAL_LOGIN(),@revision+1,
   (SELECT i.employeeCode,i.active,i.entra_object_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES),
   (SELECT i.employeeCode,i.active,i.objectId AS entra_object_id,'ORG_ROSTER_GRAPH_LOOKUP' AS source
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)
  FROM #identity i WHERE i.entra_object_id IS NULL;
  IF @@ROWCOUNT<>@changes THROW 51000,'Binding audit count changed.',1;
 END;
 COMMIT;
 SELECT @receipt AS receipt,@changes AS pendingLinks,
  CASE WHEN @expected IS NULL THEN 'PREVIEW' ELSE 'APPLIED' END AS outcome;
 IF @expected IS NULL
  SELECT employeeCode,objectId,active,
   CASE WHEN entra_object_id IS NULL THEN 'LINK' ELSE 'KEEP' END AS proposedAction
  FROM #identity ORDER BY employeeCode;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;`;

async function main() {
  const [file, flag, receipt, ...extra] = process.argv.slice(2);
  if (
    !file ||
    extra.length ||
    (flag && (flag !== '--apply' || !/^[a-f0-9]{64}$/i.test(receipt ?? '')))
  )
    throw Error(
      'Usage: npm run access:link-roster -w apps/api -- <roster.json> [--apply <receipt>]',
    );
  const {
    ACCESS_ACCOUNT_ID: account,
    ENTRA_TENANT_ID: tenant,
    ORG_GRAPH_CLIENT_ID: client,
    ORG_GRAPH_CLIENT_SECRET: secret,
  } = process.env;
  if (
    !account ||
    !tenant ||
    !client ||
    !secret ||
    ![account, tenant, client].every(id => directoryId.test(id))
  )
    throw Error(
      'Configure ACCESS_ACCOUNT_ID, ENTRA_TENANT_ID and dedicated ORG_GRAPH credentials.',
    );
  const employees = identityRoster(JSON.parse(await readFile(file, 'utf8')));
  const graph = new ClientSecretCredential(tenant, client, secret);
  const mappings = await resolveEmployeeIdentities(employees, async () => {
    const token = await graph.getToken('https://graph.microsoft.com/.default');
    if (!token) throw Error('Microsoft Graph token unavailable.');
    return token.token;
  });
  const result = await withDatabase(pool =>
    pool
      .request()
      .input('account', sql.UniqueIdentifier, account)
      .input('tenant', sql.UniqueIdentifier, tenant)
      .input('mapping', sql.NVarChar(sql.MAX), JSON.stringify(mappings))
      .input('expected', sql.VarChar(64), receipt?.toUpperCase() ?? null)
      .query(bind),
  );
  console.log(JSON.stringify(result.recordsets, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Employee identity linking failed.');
  process.exitCode = 1;
});
