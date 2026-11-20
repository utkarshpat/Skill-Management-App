-- Rollback-only test for the workbook's authorized preview, import and profile read.
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @account uniqueidentifier=NEWID(),@tenant uniqueidentifier=NEWID(),@admin uniqueidentifier=NEWID(),
 @role uniqueidentifier=NEWID(),@unit uniqueidentifier=NEWID(),@portfolio uniqueidentifier=NEWID(),
 @client uniqueidentifier=NEWID(),@project uniqueidentifier=NEWID(),@person uniqueidentifier;
INSERT dbo.Account(account_id,account_code,display_name,entra_tenant_id)
 VALUES(@account,CONVERT(nvarchar(36),@account),N'Employee import test',@tenant);
INSERT dbo.AccessWorkspace(account_id,revision) VALUES(@account,1);
INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active)
 VALUES(@account,@admin,N'Fixture admin',N'admin',1);
INSERT dbo.AccountRole(account_id,role_id,display_name) VALUES(@account,@role,N'Fixture admin');
INSERT dbo.AccessPersonRole VALUES(@account,@admin,@role);
INSERT dbo.AccountRolePermission(account_id,role_id,permission_code,scope_kind,effect)
 SELECT @account,@role,permission,'ORGANIZATION','ALLOW'
 FROM (VALUES('profile.view'),('permissions.manage'),('users.manage'),('audit.view')) rights(permission);
INSERT dbo.AccessOrgNode(account_id,node_id,kind,display_name,parent_id,active)
 VALUES(@account,@unit,'DELIVERY_UNIT',N'Test DU',NULL,1),
       (@account,@portfolio,'PORTFOLIO',N'Test Portfolio',@unit,1),
       (@account,@client,'DEPARTMENT',N'Test Account',@portfolio,1),
       (@account,@project,'TEAM',N'Test Project',@client,1);

DECLARE @payload nvarchar(max)=N'{"rows":[
 {"row":2,"employee":"002","name":"New employee","workEmail":"new@example.test","workLocation":"Test office","jobTitle":"Engineer","grade":"G2","deliveryUnit":"Test DU","portfolio":"Test Portfolio","client":"Test Account","project":"Test Project","manager":"001"},
 {"row":3,"employee":"001","name":"New manager","manager":"admin"}]}';
DECLARE @response TABLE(json nvarchar(max));
INSERT @response EXEC dbo.ExcelEmployeeBulkData @account,@admin,'employees','PREVIEW',@payload;
IF NOT EXISTS(SELECT 1 FROM @response WHERE JSON_VALUE(json,'$.changed')='2' AND JSON_VALUE(json,'$.examples[0].label') LIKE N'%New manager (001)%')
 THROW 50000,'Preview did not resolve the proposed manager.',1;
IF EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account AND employee_code='002')
 THROW 50000,'Preview wrote an employee.',1;
DELETE FROM @response;
INSERT @response EXEC dbo.ExcelEmployeeBulkData @account,@admin,'employees','IMPORT',@payload,1;
IF NOT EXISTS(SELECT 1 FROM @response WHERE JSON_VALUE(json,'$.changed')='2' AND JSON_VALUE(json,'$.revision')='3')
 THROW 50000,'Import counts or revision were incorrect.',1;
SELECT @person=person_id FROM dbo.AccessPerson WHERE account_id=@account AND employee_code=N'002'
 AND active=1 AND entra_object_id IS NULL AND work_email=N'new@example.test' AND work_location=N'Test office'
 AND job_title=N'Engineer' AND grade=N'G2';
IF @person IS NULL THROW 50000,'Employee profile or identity policy was incorrect.',1;
IF NOT EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment a JOIN dbo.AccessPerson m ON m.account_id=a.account_id AND m.person_id=a.manager_id
 WHERE a.account_id=@account AND a.person_id=@person AND a.department_id IS NULL AND a.team_id=@project AND m.employee_code=N'001')
 THROW 50000,'Placement or reporting line was incorrect.',1;
IF (SELECT COUNT(*) FROM dbo.AccessAudit WHERE account_id=@account AND action='person.created')<>2
 THROW 50000,'Import did not audit each employee.',1;
IF EXISTS(SELECT 1 FROM dbo.AccessPersonRole WHERE account_id=@account AND person_id<>@admin)
 THROW 50000,'Unexpected access granted by import.',1;
DELETE FROM @response;
INSERT @response EXEC dbo.ReadPeopleAdministration @account_id=@account,@actor_id=@admin,@mode='PERSON',@person_id=@person;
IF NOT EXISTS(SELECT 1 FROM @response WHERE JSON_VALUE(json,'$.person.workEmail')=N'new@example.test'
 AND JSON_VALUE(json,'$.person.workLocation')=N'Test office')
 THROW 50000,'Employee details did not appear in People & Access.',1;

ROLLBACK TRANSACTION;
PRINT 'Employee workbook preview, insert, placement and audit verified.';
