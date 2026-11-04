-- Company DBA-only provisioning. No application endpoint executes this script.
-- First sign in through the deployed app. Read the verified tid/oid displayed there.
-- Reconcile the employee code against the company roster/directory independently.
-- Never derive oid from a typed email, display name or decoded/unverified token.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 15000;
DECLARE @apply bit=0;
DECLARE @verifiedIdentityReviewed bit=0;
DECLARE @employeeCode nvarchar(40)=NULL; -- Exact reviewed source-roster employee code; never infer it from a name.
DECLARE @objectId uniqueidentifier=NULL; -- Exact Object ID displayed after verified Microsoft login.
DECLARE @expectedRevision int=76; -- Refresh after each successful binding; never bypass a conflict.
DECLARE @account uniqueidentifier='0abd9bd3-7a7e-47b2-bea2-efbb86110cfa';
DECLARE @tenant uniqueidentifier='8b87af7d-8647-4dc7-8df4-5f69a2011bb5';
IF DB_NAME()<>N'SS-SkillMgmtApp-SQL-Dev' OR LOWER(CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))) NOT IN(N'ssskillmgmtappsqlsrvdev',N'ssskillmgmtappsqlsrvdev.database.windows.net')
 THROW 51000,'Wrong company server/database.',1;
IF @employeeCode IS NULL OR @objectId IS NULL OR @objectId='00000000-0000-0000-0000-000000000000'
 THROW 51000,'Supply the Object ID from verified company sign-in and independently review the employee mapping.',1;
IF @apply=1 AND @verifiedIdentityReviewed<>1
 THROW 51000,'Review the verified tenant/object ID and employee record before applying.',1;
IF OBJECT_ID(N'dbo.OperationsRealUserCutover',N'U') IS NULL
 THROW 51000,'Expected reviewed employee cutover is missing.',1;
BEGIN TRY
 SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM dbo.Account WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account AND entra_tenant_id=@tenant AND status='ACTIVE')
  THROW 51000,'Company tenant/account is unavailable.',1;
 DECLARE @revision int,@person uniqueidentifier,@source nvarchar(max),@before nvarchar(max),@after nvarchar(max);
 SELECT @revision=revision FROM dbo.AccessWorkspace WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account;
 IF @revision IS NULL OR @revision<>@expectedRevision THROW 51000,'Workspace revision changed; refresh and review again.',1;
 IF (SELECT COUNT(*) FROM dbo.OperationsRealUserCutover WHERE account_id=@account)<>1
  THROW 51000,'Ambiguous source roster; inspect cutover batches.',1;
 SELECT @source=roster_json FROM dbo.OperationsRealUserCutover WHERE account_id=@account;
 SELECT @person=personId FROM OPENJSON(@source,'$.users') WITH(personId uniqueidentifier,employeeCode nvarchar(40)) WHERE employeeCode=@employeeCode;
 IF @person IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account AND person_id=@person AND employee_code=@employeeCode AND active=0 AND entra_object_id IS NULL)
  THROW 51000,'Expected inactive, unbound roster employee missing. Existing bindings cannot be replaced by this script.',1;
 IF EXISTS(SELECT 1 FROM dbo.AccessPerson WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account AND entra_object_id=@objectId)
  THROW 51000,'This Microsoft identity is already bound; inspect existing access.',1;
 IF EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account AND active=1)
  AND NOT EXISTS(SELECT 1 FROM dbo.BusinessResponsibility b JOIN dbo.AccessPerson p ON p.account_id=b.account_id AND p.person_id=b.person_id
   WHERE b.account_id=@account AND p.active=1 AND p.entra_object_id IS NOT NULL AND b.bundle='SYSTEM_ADMIN' AND b.scope_kind='ORGANIZATION' AND b.effect='ALLOW' AND b.active=1 AND (b.valid_until IS NULL OR b.valid_until>SYSUTCDATETIME()))
  THROW 51000,'No active bound administrator; inspect provisioning state.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account AND active=1)
  AND @employeeCode<>JSON_VALUE(@source,'$.accessIntent.initialAdminEmployeeCode')
  THROW 51000,'The first activated person must be the explicitly designated initial Admin.',1;
 SELECT 'PREVIEW_IDENTITY_BINDING' AS mode,@revision AS revision,@employeeCode AS employeeCode,@tenant AS verifiedTenantId,@objectId AS reviewedObjectId,
  p.display_name AS employeeName,JSON_VALUE(r.value,'$.workEmail') AS sourceWorkEmail,
  N'Activate this exact employee and preserve existing access/reporting. No automatic role grants.' AS effect
  FROM dbo.AccessPerson p CROSS APPLY OPENJSON(@source,'$.users') r
  WHERE p.account_id=@account AND p.person_id=@person AND JSON_VALUE(r.value,'$.employeeCode')=@employeeCode;
 SELECT * FROM dbo.BusinessResponsibility WHERE account_id=@account AND person_id=@person;
 IF @apply=0 BEGIN COMMIT; SET TRANSACTION ISOLATION LEVEL READ COMMITTED; RETURN; END;
 SET @before=(SELECT person_id,employee_code,active,entra_object_id FROM dbo.AccessPerson WHERE account_id=@account AND person_id=@person FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
 UPDATE dbo.AccessPerson SET entra_object_id=@objectId,active=1 WHERE account_id=@account AND person_id=@person AND active=0 AND entra_object_id IS NULL;
 IF @@ROWCOUNT<>1 THROW 51000,'Binding conflict; rollback.',1;
 SET @after=(SELECT person_id,employee_code,active,entra_object_id FROM dbo.AccessPerson WHERE account_id=@account AND person_id=@person FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
 -- A SQL operator is not an application actor. Preserve its actual identity without
 -- attributing setup activity to a newly activated employee in AccessAudit.
 IF OBJECT_ID(N'dbo.OperationsIdentityBindingAudit',N'U') IS NULL
  CREATE TABLE dbo.OperationsIdentityBindingAudit(
   id uniqueidentifier NOT NULL PRIMARY KEY,account_id uniqueidentifier NOT NULL,
   person_id uniqueidentifier NOT NULL,tenant_id uniqueidentifier NOT NULL,
   object_id uniqueidentifier NOT NULL,occurred_at datetime2 NOT NULL,
   sql_operator nvarchar(128) NOT NULL,revision int NOT NULL,
   before_json nvarchar(max) NOT NULL CHECK(ISJSON(before_json)=1),
   after_json nvarchar(max) NOT NULL CHECK(ISJSON(after_json)=1)
  );
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account AND revision=@revision;
 IF @@ROWCOUNT<>1 THROW 51000,'Revision conflict; rollback.',1;
 INSERT dbo.OperationsIdentityBindingAudit VALUES(NEWID(),@account,@person,@tenant,@objectId,SYSUTCDATETIME(),ORIGINAL_LOGIN(),@revision+1,@before,@after);
 COMMIT;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 SELECT 'COMMITTED_IDENTITY_BINDING' AS outcome,@employeeCode AS employeeCode,@revision+1 AS revision;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 THROW;
END CATCH;
