-- Run against an isolated local Skill Management fixture database. All data rolls back.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() NOT LIKE 'SkillMgmt[_]%' THROW 52000,'Use a local Skill Management fixture database.',1;
DECLARE @account uniqueidentifier=NEWID(), @admin uniqueidentifier=NEWID(),
 @analytics uniqueidentifier=NEWID(), @employee uniqueidentifier=NEWID(),
 @inactive uniqueidentifier=NEWID(), @event uniqueidentifier=NEWID(),
 @issuerAnalyst uniqueidentifier=NEWID(), @issuer uniqueidentifier=NEWID(),
 @issuerGrant uniqueidentifier=NEWID();
BEGIN TRANSACTION;

INSERT dbo.Account(account_id,account_code,display_name,entra_tenant_id)
 VALUES(@account,CONVERT(nvarchar(36),@account),'Template feature fixture',NEWID());
INSERT dbo.AccessWorkspace(account_id,revision,personal_baseline_enabled) VALUES(@account,1,1);
INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) VALUES
 (@account,@admin,'Explicit administrator','T001',1),
 (@account,@analytics,'Scoped analyst','T002',1),
 (@account,@employee,'Employee','T003',1),
 (@account,@inactive,'Inactive employee','T004',0),
 (@account,@issuerAnalyst,'Issuer analyst','T005',1);
INSERT dbo.BusinessResponsibility VALUES
 (@account,NEWID(),@admin,'SYSTEM_ADMIN','ORGANIZATION',NULL,'ALLOW',1,NULL,'Fixture Admin'),
 (@account,NEWID(),@analytics,'BUSINESS_OPERATIONS','ORGANIZATION',NULL,'ALLOW',1,NULL,'Fixture Analyst'),
 (@account,@issuerGrant,@issuerAnalyst,'BUSINESS_OPERATIONS','ORGANIZATION',NULL,'ALLOW',1,NULL,'Fixture Issuer Analyst');
INSERT dbo.CredentialProvider(account_id,id,name,active,revision) VALUES(@account,@issuer,'Fixture issuer',1,1);
INSERT dbo.BusinessResponsibilityIssuerScope(account_id,responsibility_id,issuer_ids)
 VALUES(@account,@issuerGrant,CONCAT('["',@issuer,'"]'));

IF dbo.TemplateFeatureAllowed(@account,@employee,'learning') IS NOT NULL
 THROW 52001,'An unconfigured workspace must retain the release default.',1;
EXEC dbo.SaveBusinessChange @account,@admin,1,'TEMPLATE_FEATURES',@event,
 N'{"template":"BUSINESS_OPERATIONS","learning":true,"requests":false,"reason":"Enable learning for Analytics"}';
IF dbo.TemplateFeatureAllowed(@account,@analytics,'learning')<>1
 OR dbo.TemplateFeatureAllowed(@account,@issuerAnalyst,'learning')<>1
 OR dbo.TemplateFeatureAllowed(@account,@employee,'learning')<>0
 OR dbo.TemplateFeatureAllowed(@account,@admin,'learning')<>0
 OR dbo.AccessCan(@account,@analytics,'request.view',1)<>0
 THROW 52002,'Analytics and Admin audiences or module settings leaked.',1;
UPDATE dbo.CredentialProvider SET active=0 WHERE account_id=@account AND id=@issuer;
IF dbo.TemplateFeatureAllowed(@account,@issuerAnalyst,'learning')<>0
 THROW 52008,'Inactive issuer coverage retained template access.',1;
IF JSON_VALUE(dbo.BusinessProjection(@account,@analytics),'$.learningEnabled')<>'true'
 THROW 52003,'Actor projection is missing the effective module setting.',1;
INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,valid_until,reason)
 VALUES(@account,@analytics,'profile.view','OWN','DENY',DATEADD(hour,1,SYSUTCDATETIME()),'Fixture profile deny');
IF dbo.TemplateFeatureAllowed(@account,@analytics,'learning')<>0
 THROW 52009,'A user without effective profile access retained the Analytics audience.',1;
DELETE dbo.AccessPersonOverride WHERE account_id=@account AND person_id=@analytics AND permission_code='profile.view';

EXEC dbo.SaveBusinessChange @account,@admin,2,'TEMPLATE_FEATURES',@event,
 N'{"template":"SYSTEM_ADMIN","learning":false,"requests":true,"reason":"Enable requests for Admin"}';
IF dbo.AccessCan(@account,@admin,'request.view',1)<>1
 OR dbo.AccessCan(@account,@analytics,'request.view',1)<>0
 OR dbo.TemplateFeatureAllowed(@account,@employee,'requests')<>0
 THROW 52004,'Admin settings widened another template audience.',1;

EXEC dbo.SaveBusinessChange @account,@admin,3,'TEMPLATE_FEATURES',@event,
 N'{"template":"EMPLOYEE","learning":true,"requests":true,"reason":"Enable both modules for active employees"}';
IF dbo.TemplateFeatureAllowed(@account,@employee,'learning')<>1
 OR dbo.TemplateFeatureAllowed(@account,@inactive,'learning')<>0
 OR dbo.AccessCan(@account,@employee,'request.view',1)<>1
 OR dbo.AccessCan(@account,@employee,'skill.claim',1)<>1
 THROW 52005,'Employee audience did not preserve active status or core access.',1;
INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,valid_until,reason)
 VALUES(@account,@employee,'request.view','OWN','DENY',DATEADD(hour,1,SYSUTCDATETIME()),'Fixture explicit deny');
IF dbo.AccessCan(@account,@employee,'request.view',1)<>0
 THROW 52006,'A module switch overrode an explicit deny.',1;
IF (SELECT COUNT(*) FROM dbo.AccessAudit WHERE account_id=@account AND action='business.template_features')<>3
 THROW 52007,'Template settings changes were not audited.',1;

EXEC dbo.ReadOwnGrowthClaims @account,@employee;
EXEC dbo.SaveBusinessChange @account,@admin,4,'TEMPLATE_FEATURES',@event,
 N'{"template":"EMPLOYEE","learning":false,"requests":true,"reason":"Disable learning only"}';
IF dbo.AccessCan(@account,@employee,'incident.view',1)<>1 OR dbo.AccessCan(@account,@employee,'skill.claim',1)<>1
 THROW 52010,'Disabling learning removed unrelated access.',1;
BEGIN TRY
 EXEC dbo.ReadOwnGrowthClaims @account,@employee;
 THROW 52011,'The growth journey ignored the workspace module setting.',1;
END TRY
BEGIN CATCH
 IF ERROR_NUMBER()<>51003 OR ERROR_MESSAGE()<>'Learning module unavailable.' THROW;
END CATCH;
IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
SELECT 'Template audience, module independence, explicit deny and audit checks passed.' AS result;
