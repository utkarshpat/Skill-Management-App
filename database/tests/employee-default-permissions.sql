-- Run against an isolated local Skill Management fixture database. All data rolls back.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() NOT LIKE 'SkillMgmt[_]%' THROW 52000,'Use a local Skill Management fixture database.',1;
DECLARE @account uniqueidentifier=NEWID(),@admin uniqueidentifier=NEWID(),
 @employee uniqueidentifier=NEWID(),@change uniqueidentifier=NEWID();
BEGIN TRANSACTION;
INSERT dbo.Account(account_id,account_code,display_name,entra_tenant_id)
 VALUES(@account,CONVERT(nvarchar(36),@account),'Employee permissions fixture',NEWID());
INSERT dbo.AccessWorkspace(account_id,revision,personal_baseline_enabled) VALUES(@account,1,1);
INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) VALUES
 (@account,@admin,'Administrator','A001',1),(@account,@employee,'Employee','E001',1);
INSERT dbo.BusinessResponsibility VALUES
 (@account,NEWID(),@admin,'SYSTEM_ADMIN','ORGANIZATION',NULL,'ALLOW',1,NULL,'Fixture Administrator');

IF dbo.AccessCan(@account,@employee,'skill.claim',1)<>1
 THROW 52001,'The shipped baseline should remain available until edited.',1;
EXEC dbo.SaveBusinessChange @account,@admin,1,'PERSONAL_BASELINE',@change,
 N'{"enabled":true,"employeePermissions":["profile.view","skill.view"],"reason":"Remove the default claims grant"}';
IF dbo.AccessCan(@account,@employee,'profile.view',1)<>1 OR dbo.AccessCan(@account,@employee,'skill.claim',1)<>0
 THROW 52002,'The required profile or optional claims permission is incorrect.',1;
IF ISNULL(JSON_QUERY(dbo.BusinessProjection(@account,@employee),'$.employeePermissions'),N'')<>N'["profile.view","skill.view"]'
 THROW 52003,'The stored permissions are missing from the actor projection.',1;
INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,valid_until,reason)
 VALUES(@account,@employee,'skill.claim','OWN','ALLOW',DATEADD(hour,1,SYSUTCDATETIME()),'Fixture explicit allow');
IF dbo.AccessCan(@account,@employee,'skill.claim',1)<>1
 THROW 52004,'Removing the default must preserve grants from other sources.',1;
INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,valid_until,reason)
 VALUES(@account,@employee,'skill.view','OWN','DENY',DATEADD(hour,1,SYSUTCDATETIME()),'Fixture explicit deny');
IF dbo.AccessCan(@account,@employee,'skill.view',1)<>0
 THROW 52005,'Stored baseline grants must respect explicit deny.',1;
IF NOT EXISTS (
 SELECT 1 FROM dbo.AccessAudit WHERE account_id=@account AND action='business.personal_baseline'
  AND JSON_QUERY(after_json,'$.employeePermissions')=N'["profile.view","skill.view"]'
) THROW 52006,'The change must record its permission list in the audit.',1;
BEGIN TRY
 EXEC dbo.SaveBusinessChange @account,@admin,2,'PERSONAL_BASELINE',@change,
  N'{"enabled":true,"employeePermissions":["skill.view"],"reason":"Test required profile guard"}';
 THROW 52007,'The database accepted a template without View own profile.',1;
END TRY
BEGIN CATCH
 IF ERROR_NUMBER()<>51000 OR ERROR_MESSAGE()<>'Choose supported employee permissions and keep View own profile.' THROW;
END CATCH;
IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
SELECT 'Employee default permissions checks passed.' AS result;
