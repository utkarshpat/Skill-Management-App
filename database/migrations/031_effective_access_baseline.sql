-- Preserve all existing grants. New/changed unsupported combinations fail closed.
ALTER TABLE dbo.AccessPersonOverride ADD reason nvarchar(500) NULL;
CREATE TABLE dbo.AccessImplementedScope(permission_code varchar(100) NOT NULL,scope_kind varchar(30) NOT NULL,PRIMARY KEY(permission_code,scope_kind));
INSERT dbo.AccessImplementedScope VALUES
('profile.view','OWN'),
('skill.view','OWN'),
('skill.view','ORGANIZATION'),
('skill.claim','OWN'),
('skill.verify','ORGANIZATION'),
('skill.catalogue.manage','ORGANIZATION'),
('learning.view','OWN'),
('learning.manage','OWN'),
('users.manage','ORGANIZATION'),
('permissions.manage','ORGANIZATION'),
('audit.view','ORGANIZATION'),
('request.view','OWN'),
('request.create','OWN'),
('request.assign','OWN'),
('request.resolve','OWN'),
('incident.view','OWN'),
('incident.create','OWN'),
('incident.assign','OWN'),
('incident.resolve','OWN');
GO
CREATE OR ALTER FUNCTION dbo.AccessCan(@account uniqueidentifier,@person uniqueidentifier,@permission varchar(100),@own bit)
RETURNS bit AS
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson p JOIN dbo.Account a ON a.account_id=p.account_id
 WHERE p.account_id=@account AND p.person_id=@person AND p.active=1 AND a.status='ACTIVE') RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessImplementedScope WHERE permission_code=@permission) RETURN 0;
 IF @permission='skill.verify' AND @own=0 AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=@account AND o.manager_id=@person AND o.person_id<>@person) RETURN 0;
 DECLARE @permissions TABLE(effect varchar(5));
 INSERT @permissions SELECT p.effect FROM dbo.AccountRolePermission p
 JOIN dbo.AccessPersonRole r ON r.account_id=p.account_id AND r.role_id=p.role_id
 WHERE r.account_id=@account AND r.person_id=@person AND p.permission_code=@permission
 AND (p.scope_kind='ORGANIZATION' OR (@own=1 AND p.scope_kind='OWN'))
 AND (p.valid_until IS NULL OR SYSUTCDATETIME()<p.valid_until)
 UNION ALL SELECT effect FROM dbo.AccessPersonOverride WHERE account_id=@account AND person_id=@person
 AND permission_code=@permission AND (scope_kind='ORGANIZATION' OR (@own=1 AND scope_kind='OWN'))
 AND (valid_until IS NULL OR SYSUTCDATETIME()<valid_until);
 IF EXISTS(SELECT 1 FROM @permissions WHERE effect='DENY') RETURN 0;
 IF EXISTS(SELECT 1 FROM @permissions WHERE effect='ALLOW') RETURN 1;
 IF @permission='skill.verify' AND @own=0 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=@account AND o.manager_id=@person AND o.person_id<>@person) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ReadAccessWorkspace @account_id uniqueidentifier AS
BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessWorkspace w JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE') THROW 51004,'Workspace unavailable.',1;
 -- One consistent snapshot across the related result sets.
 SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
 BEGIN TRANSACTION;
 SELECT revision FROM dbo.AccessWorkspace WITH (UPDLOCK,HOLDLOCK) WHERE account_id=@account_id;
 SELECT role_id AS id,display_name AS name FROM dbo.AccountRole WHERE account_id=@account_id ORDER BY display_name;
 SELECT role_id AS roleId,permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil FROM dbo.AccountRolePermission WHERE account_id=@account_id;
 SELECT p.person_id AS id,p.display_name AS displayName,p.employee_code AS employeeCode,p.active,p.entra_object_id AS entraObjectId,CONVERT(bit,CASE WHEN p.active=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=p.account_id AND o.manager_id=p.person_id AND o.person_id<>p.person_id) THEN 1 ELSE 0 END) AS hasDirectReports FROM dbo.AccessPerson p WHERE p.account_id=@account_id ORDER BY p.employee_code;
 SELECT person_id AS personId,role_id AS roleId FROM dbo.AccessPersonRole WHERE account_id=@account_id;
 SELECT person_id AS personId,permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil,reason FROM dbo.AccessPersonOverride WHERE account_id=@account_id;
 SELECT actor_id AS actorId,action,target_id AS targetId,occurred_at AS at,revision,before_json AS [before],after_json AS [after] FROM dbo.AccessAudit WHERE account_id=@account_id ORDER BY revision;
 COMMIT TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 THROW;
 END CATCH;
END;

GO

CREATE OR ALTER PROCEDURE dbo.SaveAccessChange
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@expected_revision int,
 @kind varchar(10),@target_id uniqueidentifier,@is_new bit,@payload nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @revision int;
 SELECT @revision=revision FROM dbo.AccessWorkspace WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id;
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF @revision<>@expected_revision THROW 51009,'Configuration changed. Reload and try again.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=0 THROW 51003,'Permission administration denied.',1;
 IF @kind='person' AND dbo.AccessCan(@account_id,@actor_id,'users.manage',0)=0 THROW 51003,'User administration denied.',1;
 IF @kind NOT IN ('role','person') OR ISJSON(@payload)<>1 THROW 51000,'Invalid access change.',1;

 DECLARE @incoming nvarchar(max)=CASE @kind WHEN 'role' THEN JSON_QUERY(@payload,'$.permissions') ELSE JSON_QUERY(@payload,'$.overrides') END;
 IF @incoming IS NULL OR LEFT(LTRIM(@incoming),1)<>'[' THROW 51000,'Invalid assignments.',1;
 DECLARE @old TABLE(permission varchar(100),scope varchar(30),effect varchar(5),validUntil datetime2(7),reason nvarchar(500));
 IF @kind='role' INSERT @old SELECT permission_code,scope_kind,effect,valid_until,NULL FROM dbo.AccountRolePermission WHERE account_id=@account_id AND role_id=@target_id;
 ELSE INSERT @old SELECT permission_code,scope_kind,effect,valid_until,reason FROM dbo.AccessPersonOverride WHERE account_id=@account_id AND person_id=@target_id;
 IF EXISTS(SELECT 1 FROM OPENJSON(@incoming) WITH(permission varchar(100),scope varchar(30),effect varchar(5),validUntil datetime2(7),reason nvarchar(500)) n
 WHERE NOT EXISTS(SELECT 1 FROM @old o WHERE o.permission=n.permission AND o.scope=n.scope AND o.effect=n.effect AND (o.validUntil=n.validUntil OR (o.validUntil IS NULL AND n.validUntil IS NULL)) AND (o.reason=n.reason OR (o.reason IS NULL AND n.reason IS NULL)))
 AND (NOT EXISTS(SELECT 1 FROM dbo.AccessImplementedScope i WHERE i.permission_code=n.permission AND i.scope_kind=n.scope) OR (@kind='person' AND (NULLIF(LTRIM(RTRIM(n.reason)),'') IS NULL OR n.validUntil IS NULL OR n.validUntil<=SYSUTCDATETIME())))) THROW 51000,'Unsupported assignment or missing exception reason/expiry.',1;
 IF @kind='person' AND EXISTS(SELECT 1 FROM OPENJSON(@payload,'$.roleIds') r JOIN dbo.AccountRolePermission p ON p.account_id=@account_id AND p.role_id=TRY_CONVERT(uniqueidentifier,r.value)
 WHERE NOT EXISTS(SELECT 1 FROM dbo.AccessPersonRole old WHERE old.account_id=@account_id AND old.person_id=@target_id AND old.role_id=p.role_id)
 AND NOT EXISTS(SELECT 1 FROM dbo.AccessImplementedScope i WHERE i.permission_code=p.permission_code AND i.scope_kind=p.scope_kind)) THROW 51000,'Review unsupported template assignments before provisioning.',1;
 DECLARE @before nvarchar(max),@after nvarchar(max),@name nvarchar(100),@permissions nvarchar(max);
 IF @kind='role'
 BEGIN
  IF @is_new=0 AND NOT EXISTS(SELECT 1 FROM dbo.AccountRole WHERE account_id=@account_id AND role_id=@target_id) THROW 51004,'Role not found.',1;
  SELECT @before=(SELECT role_id AS id,display_name AS name,JSON_QUERY((SELECT permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil FROM dbo.AccountRolePermission WHERE account_id=@account_id AND role_id=@target_id FOR JSON PATH)) AS permissions FROM dbo.AccountRole WHERE account_id=@account_id AND role_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SET @name=JSON_VALUE(@payload,'$.name'); SET @permissions=JSON_QUERY(@payload,'$.permissions');
  IF LEN(LTRIM(RTRIM(@name)))=0 OR @name IS NULL OR @permissions IS NULL THROW 51000,'Invalid role.',1;
  IF @is_new=1 INSERT dbo.AccountRole VALUES(@account_id,@target_id,@name);
  ELSE UPDATE dbo.AccountRole SET display_name=@name WHERE account_id=@account_id AND role_id=@target_id;
  DELETE dbo.AccountRolePermission WHERE account_id=@account_id AND role_id=@target_id;
  INSERT dbo.AccountRolePermission SELECT @account_id,@target_id,permission,scope,effect,validUntil FROM OPENJSON(@permissions) WITH(permission varchar(100),scope varchar(30),effect varchar(5),validUntil datetime2(7));
  SELECT @after=(SELECT role_id AS id,display_name AS name,JSON_QUERY((SELECT permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil FROM dbo.AccountRolePermission WHERE account_id=@account_id AND role_id=@target_id FOR JSON PATH)) AS permissions FROM dbo.AccountRole WHERE account_id=@account_id AND role_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END
 ELSE
 BEGIN
  IF @is_new=0 AND NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@target_id) THROW 51004,'Person not found.',1;
  SELECT @before=(SELECT person_id AS id,display_name AS displayName,employee_code AS employeeCode,active,JSON_QUERY((SELECT role_id AS id FROM dbo.AccessPersonRole WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH)) AS roles,JSON_QUERY((SELECT permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil,reason FROM dbo.AccessPersonOverride WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH)) AS overrides FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  DECLARE @code nvarchar(40)=JSON_VALUE(@payload,'$.employeeCode'),@active bit=CASE JSON_VALUE(@payload,'$.active') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END;
  SET @name=JSON_VALUE(@payload,'$.displayName');SET @permissions=JSON_QUERY(@payload,'$.overrides');
  IF LEN(LTRIM(RTRIM(@name)))=0 OR @name IS NULL OR LEN(LTRIM(RTRIM(@code)))=0 OR @code IS NULL OR @active IS NULL OR @permissions IS NULL OR JSON_QUERY(@payload,'$.roleIds') IS NULL THROW 51000,'Invalid person.',1;
  IF @is_new=1 INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) VALUES(@account_id,@target_id,@name,@code,@active);
  ELSE UPDATE dbo.AccessPerson SET display_name=@name,employee_code=@code,active=@active WHERE account_id=@account_id AND person_id=@target_id;
  DELETE dbo.AccessPersonRole WHERE account_id=@account_id AND person_id=@target_id;
  INSERT dbo.AccessPersonRole SELECT @account_id,@target_id,CONVERT(uniqueidentifier,value) FROM OPENJSON(@payload,'$.roleIds');
  DELETE dbo.AccessPersonOverride WHERE account_id=@account_id AND person_id=@target_id;
  INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,valid_until,reason) SELECT @account_id,@target_id,permission,scope,effect,validUntil,reason FROM OPENJSON(@permissions) WITH(permission varchar(100),scope varchar(30),effect varchar(5),validUntil datetime2(7),reason nvarchar(500));
  SELECT @after=(SELECT person_id AS id,display_name AS displayName,employee_code AS employeeCode,active,JSON_QUERY((SELECT role_id AS id FROM dbo.AccessPersonRole WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH)) AS roles,JSON_QUERY((SELECT permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil,reason FROM dbo.AccessPersonOverride WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH)) AS overrides FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND dbo.AccessCan(@account_id,person_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,person_id,'users.manage',0)=1) THROW 51000,'Keep at least one active access administrator.',1;
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@revision+1,@actor_id,CONCAT(@kind,CASE @is_new WHEN 1 THEN '.created' ELSE '.updated' END),@target_id,NULLIF(@before,''),@after);
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
 END CATCH;
END;

GO
