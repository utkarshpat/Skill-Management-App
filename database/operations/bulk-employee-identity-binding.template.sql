-- Generated reviewed company-directory mapping; DBA operation, not a runtime grant.
-- Preview first. Copy reviewedRevision into @expectedRevision, then set @apply=1.
-- Existing exact ACTIVE bindings are preserved. Conflicts/deactivated bindings abort.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 15000;
DECLARE @apply bit=0;
DECLARE @expectedRevision int=NULL;
DECLARE @account uniqueidentifier='0abd9bd3-7a7e-47b2-bea2-efbb86110cfa';
DECLARE @tenant uniqueidentifier='8b87af7d-8647-4dc7-8df4-5f69a2011bb5';
DECLARE @mapping nvarchar(max)={{MAPPING}};
IF DB_NAME()<>N'SS-SkillMgmtApp-SQL-Dev' OR LOWER(CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))) NOT IN(N'ssskillmgmtappsqlsrvdev',N'ssskillmgmtappsqlsrvdev.database.windows.net')
 THROW 51000,'Wrong company server/database.',1;
IF CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),@mapping)),2)<>'{{HASH}}'
 THROW 51000,'Reviewed mapping changed; regenerate and review.',1;
IF @apply=1 AND @expectedRevision IS NULL
 THROW 51000,'Run preview and supply its reviewedRevision before apply.',1;
IF OBJECT_ID(N'dbo.OperationsRealUserCutover',N'U') IS NULL
 THROW 51000,'Reviewed employee cutover archive missing.',1;
DROP TABLE IF EXISTS #mapping;
DROP TABLE IF EXISTS #before;
CREATE TABLE #mapping(person_id uniqueidentifier PRIMARY KEY,employee_code nvarchar(40) UNIQUE,work_email nvarchar(254) UNIQUE,object_id uniqueidentifier UNIQUE);
INSERT #mapping SELECT personId,employeeCode,workEmail,objectId FROM OPENJSON(@mapping)
 WITH(personId uniqueidentifier,employeeCode nvarchar(40),workEmail nvarchar(254),objectId uniqueidentifier);
IF (SELECT COUNT(*) FROM #mapping)<>20 OR EXISTS(SELECT 1 FROM #mapping WHERE person_id IS NULL OR employee_code IS NULL OR work_email IS NULL OR object_id IS NULL OR object_id='00000000-0000-0000-0000-000000000000')
 THROW 51000,'Expected 20 distinct reviewed employee mappings.',1;
CREATE TABLE #before(person_id uniqueidentifier PRIMARY KEY,before_json nvarchar(max));
BEGIN TRY
 SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRANSACTION;
 DECLARE @revision int,@source nvarchar(max),@changeCount int,@batch uniqueidentifier=NEWID();
 IF NOT EXISTS(SELECT 1 FROM dbo.Account WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account AND entra_tenant_id=@tenant AND status='ACTIVE')
  THROW 51000,'Company tenant/account mismatch.',1;
 SELECT @revision=revision FROM dbo.AccessWorkspace WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account;
 IF @revision IS NULL OR (@apply=1 AND @revision<>@expectedRevision)
  THROW 51000,'Revision conflict. Run and review preview again.',1;
 IF (SELECT COUNT(*) FROM dbo.OperationsRealUserCutover WITH(HOLDLOCK) WHERE account_id=@account)<>1
  THROW 51000,'Ambiguous source roster.',1;
 SELECT @source=roster_json FROM dbo.OperationsRealUserCutover WHERE account_id=@account;
 -- Email was an offline reconciliation key. Execution binds pinned employee/person/oid
 -- tuples against the original source roster; no runtime email-based authentication.
 IF (SELECT COUNT(*) FROM OPENJSON(@source,'$.users'))<>20
  OR EXISTS(SELECT 1 FROM #mapping m WHERE NOT EXISTS(
   SELECT 1 FROM OPENJSON(@source,'$.users') WITH(personId uniqueidentifier,employeeCode nvarchar(40),workEmail nvarchar(254)) r
   WHERE r.personId=m.person_id AND r.employeeCode=m.employee_code AND LOWER(LTRIM(RTRIM(r.workEmail)))=LOWER(m.work_email)))
  THROW 51000,'Mapping differs from the reviewed original employee roster.',1;
 IF (SELECT COUNT(*) FROM dbo.AccessPerson WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account)<>20
  OR EXISTS(SELECT 1 FROM #mapping m WHERE NOT EXISTS(SELECT 1 FROM dbo.AccessPerson p WHERE p.account_id=@account AND p.person_id=m.person_id AND p.employee_code=m.employee_code))
  THROW 51000,'Current employee roster changed; no identities overwritten.',1;
 IF EXISTS(SELECT 1 FROM #mapping m JOIN dbo.AccessPerson p ON p.account_id=@account AND p.person_id=m.person_id
  WHERE CASE WHEN (p.active=0 AND p.entra_object_id IS NULL) OR (p.active=1 AND p.entra_object_id=m.object_id) THEN 0 ELSE 1 END=1)
  THROW 51000,'Conflicting, manually activated or deactivated identity found. Review individually.',1;
 IF EXISTS(SELECT 1 FROM #mapping m JOIN dbo.AccessPerson p ON p.account_id=@account AND p.entra_object_id=m.object_id WHERE p.person_id<>m.person_id)
  THROW 51000,'Directory identity is already bound to another employee.',1;
 IF NOT EXISTS(SELECT 1 FROM #mapping m JOIN dbo.BusinessResponsibility b ON b.account_id=@account AND b.person_id=m.person_id
  WHERE m.employee_code=JSON_VALUE(@source,'$.accessIntent.initialAdminEmployeeCode') AND b.bundle='SYSTEM_ADMIN' AND b.scope_kind='ORGANIZATION'
   AND b.scope_id IS NULL AND b.active=1 AND b.effect='ALLOW' AND (b.valid_until IS NULL OR b.valid_until>SYSUTCDATETIME()))
  THROW 51000,'Expected designated initial Admin responsibility missing.',1;
 SELECT @changeCount=COUNT(*) FROM #mapping m JOIN dbo.AccessPerson p ON p.account_id=@account AND p.person_id=m.person_id WHERE p.active=0 AND p.entra_object_id IS NULL;
 SELECT CASE WHEN @apply=0 THEN 'PREVIEW_ONLY_NO_DB_CHANGES' ELSE 'APPLYING' END AS mode,@revision AS reviewedRevision,
  @changeCount AS employeesToBind,20-@changeCount AS exactActiveBindingsPreserved,
  N'Existing roles, scopes, reporting and audit history preserved. Capability-lead limited grant remains pending.' AS accessImpact;
 SELECT m.employee_code AS employeeCode,p.display_name AS employeeName,m.work_email AS sourceEmail,m.object_id AS directoryObjectId,
  CASE WHEN p.active=1 THEN 'PRESERVE_EXISTING_BINDING' ELSE 'BIND_AND_ACTIVATE' END AS proposedAction
  FROM #mapping m JOIN dbo.AccessPerson p ON p.account_id=@account AND p.person_id=m.person_id ORDER BY m.employee_code;
 IF @apply=0 BEGIN COMMIT; SET TRANSACTION ISOLATION LEVEL READ COMMITTED; RETURN; END;
 IF @changeCount=0 BEGIN
  COMMIT; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  SELECT 'ALREADY_BOUND_NO_CHANGES' AS outcome,@revision AS revision,20 AS activeEmployees;
  RETURN;
 END;
 INSERT #before SELECT p.person_id,(SELECT p.person_id,p.employee_code,p.active,p.entra_object_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)
  FROM dbo.AccessPerson p JOIN #mapping m ON m.person_id=p.person_id WHERE p.account_id=@account AND p.active=0 AND p.entra_object_id IS NULL;
 IF OBJECT_ID(N'dbo.OperationsIdentityBindingAudit',N'U') IS NULL
  CREATE TABLE dbo.OperationsIdentityBindingAudit(
   id uniqueidentifier NOT NULL PRIMARY KEY,account_id uniqueidentifier NOT NULL,
   person_id uniqueidentifier NOT NULL,tenant_id uniqueidentifier NOT NULL,
   object_id uniqueidentifier NOT NULL,occurred_at datetime2 NOT NULL,
   sql_operator nvarchar(128) NOT NULL,revision int NOT NULL,
   before_json nvarchar(max) NOT NULL CHECK(ISJSON(before_json)=1),
   after_json nvarchar(max) NOT NULL CHECK(ISJSON(after_json)=1)
  );
 UPDATE p SET entra_object_id=m.object_id,active=1
  FROM dbo.AccessPerson p JOIN #mapping m ON m.person_id=p.person_id
  WHERE p.account_id=@account AND p.active=0 AND p.entra_object_id IS NULL;
 IF @@ROWCOUNT<>@changeCount THROW 51000,'Binding row count conflict; rollback.',1;
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account AND revision=@revision;
 IF @@ROWCOUNT<>1 THROW 51000,'Revision conflict; rollback.',1;
 -- Audit the real SQL operator; never impersonate an application actor.
 INSERT dbo.OperationsIdentityBindingAudit(id,account_id,person_id,tenant_id,object_id,occurred_at,sql_operator,revision,before_json,after_json)
  SELECT NEWID(),@account,p.person_id,@tenant,p.entra_object_id,SYSUTCDATETIME(),ORIGINAL_LOGIN(),@revision+1,old.before_json,
   (SELECT p.person_id,p.employee_code,p.active,p.entra_object_id,@batch AS batchId,'REVIEWED_COMPANY_DIRECTORY_EXPORT' AS source FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)
  FROM #before old JOIN dbo.AccessPerson p ON p.account_id=@account AND p.person_id=old.person_id;
 IF @@ROWCOUNT<>@changeCount THROW 51000,'Audit row count mismatch; rollback.',1;
 IF EXISTS(SELECT 1 FROM #mapping m WHERE NOT EXISTS(SELECT 1 FROM dbo.AccessPerson p WHERE p.account_id=@account AND p.person_id=m.person_id AND p.entra_object_id=m.object_id AND p.active=1))
  THROW 51000,'Final identity verification failed; rollback.',1;
 COMMIT;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 SELECT 'COMMITTED_BULK_IDENTITY_BINDING' AS outcome,@revision+1 AS revision,@changeCount AS newlyBoundEmployees,20 AS activeEmployees,@batch AS batchId;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 THROW;
END CATCH;
