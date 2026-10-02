CREATE TABLE dbo.AccessWorkspace (
 account_id uniqueidentifier NOT NULL PRIMARY KEY REFERENCES dbo.Account(account_id),
 revision int NOT NULL CHECK(revision>0)
);
CREATE TABLE dbo.AccessRuntimeAccount (
 principal_id int NOT NULL PRIMARY KEY,
 account_id uniqueidentifier NOT NULL REFERENCES dbo.AccessWorkspace(account_id)
);
CREATE TABLE dbo.AccountRole (
 account_id uniqueidentifier NOT NULL REFERENCES dbo.AccessWorkspace(account_id),
 role_id uniqueidentifier NOT NULL, display_name nvarchar(100) NOT NULL,
 PRIMARY KEY(account_id,role_id), UNIQUE(account_id,display_name)
);
CREATE TABLE dbo.AccessPerson (
 account_id uniqueidentifier NOT NULL REFERENCES dbo.AccessWorkspace(account_id),
 person_id uniqueidentifier NOT NULL, display_name nvarchar(100) NOT NULL,
 employee_code nvarchar(40) NOT NULL, active bit NOT NULL,
 entra_object_id uniqueidentifier NULL,
 PRIMARY KEY(account_id,person_id), UNIQUE(account_id,employee_code)
);
CREATE UNIQUE INDEX UX_AccessPerson_Entra ON dbo.AccessPerson(account_id,entra_object_id) WHERE entra_object_id IS NOT NULL;
CREATE TABLE dbo.AccountRolePermission (
 account_id uniqueidentifier NOT NULL,role_id uniqueidentifier NOT NULL,
 permission_code varchar(100) NOT NULL REFERENCES dbo.Permission(permission_code),
 scope_kind varchar(30) NOT NULL CHECK(scope_kind IN ('OWN','ORGANIZATION')),
 effect varchar(5) NOT NULL CHECK(effect IN ('ALLOW','DENY')),valid_until datetime2(7) NULL,
 PRIMARY KEY(account_id,role_id,permission_code,scope_kind),
 FOREIGN KEY(account_id,role_id) REFERENCES dbo.AccountRole(account_id,role_id)
);
CREATE TABLE dbo.AccessPersonRole (
 account_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,role_id uniqueidentifier NOT NULL,
 PRIMARY KEY(account_id,person_id,role_id),
 FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 FOREIGN KEY(account_id,role_id) REFERENCES dbo.AccountRole(account_id,role_id)
);
CREATE TABLE dbo.AccessPersonOverride (
 account_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,
 permission_code varchar(100) NOT NULL REFERENCES dbo.Permission(permission_code),
 scope_kind varchar(30) NOT NULL CHECK(scope_kind IN ('OWN','ORGANIZATION')),
 effect varchar(5) NOT NULL CHECK(effect IN ('ALLOW','DENY')),valid_until datetime2(7) NULL,
 PRIMARY KEY(account_id,person_id,permission_code,scope_kind),
 FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id)
);
CREATE TABLE dbo.AccessAudit (
 account_id uniqueidentifier NOT NULL,revision int NOT NULL,actor_id uniqueidentifier NOT NULL,
 action varchar(50) NOT NULL,target_id uniqueidentifier NOT NULL,occurred_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 before_json nvarchar(max) NULL CHECK(before_json IS NULL OR ISJSON(before_json)=1),
 after_json nvarchar(max) NOT NULL CHECK(ISJSON(after_json)=1),
 PRIMARY KEY(account_id,revision),
 FOREIGN KEY(account_id,actor_id) REFERENCES dbo.AccessPerson(account_id,person_id)
);
GO
CREATE OR ALTER FUNCTION dbo.AccessCan(@account uniqueidentifier,@person uniqueidentifier,@permission varchar(100),@own bit)
RETURNS bit AS
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson p JOIN dbo.Account a ON a.account_id=p.account_id
 WHERE p.account_id=@account AND p.person_id=@person AND p.active=1 AND a.status='ACTIVE') RETURN 0;
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
 SELECT person_id AS id,display_name AS displayName,employee_code AS employeeCode,active FROM dbo.AccessPerson WHERE account_id=@account_id ORDER BY employee_code;
 SELECT person_id AS personId,role_id AS roleId FROM dbo.AccessPersonRole WHERE account_id=@account_id;
 SELECT person_id AS personId,permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil FROM dbo.AccessPersonOverride WHERE account_id=@account_id;
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
  SELECT @before=(SELECT person_id AS id,display_name AS displayName,employee_code AS employeeCode,active,JSON_QUERY((SELECT role_id AS id FROM dbo.AccessPersonRole WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH)) AS roles,JSON_QUERY((SELECT permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil FROM dbo.AccessPersonOverride WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH)) AS overrides FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  DECLARE @code nvarchar(40)=JSON_VALUE(@payload,'$.employeeCode'),@active bit=CASE JSON_VALUE(@payload,'$.active') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END;
  SET @name=JSON_VALUE(@payload,'$.displayName');SET @permissions=JSON_QUERY(@payload,'$.overrides');
  IF LEN(LTRIM(RTRIM(@name)))=0 OR @name IS NULL OR LEN(LTRIM(RTRIM(@code)))=0 OR @code IS NULL OR @active IS NULL OR @permissions IS NULL OR JSON_QUERY(@payload,'$.roleIds') IS NULL THROW 51000,'Invalid person.',1;
  IF @is_new=1 INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) VALUES(@account_id,@target_id,@name,@code,@active);
  ELSE UPDATE dbo.AccessPerson SET display_name=@name,employee_code=@code,active=@active WHERE account_id=@account_id AND person_id=@target_id;
  DELETE dbo.AccessPersonRole WHERE account_id=@account_id AND person_id=@target_id;
  INSERT dbo.AccessPersonRole SELECT @account_id,@target_id,CONVERT(uniqueidentifier,value) FROM OPENJSON(@payload,'$.roleIds');
  DELETE dbo.AccessPersonOverride WHERE account_id=@account_id AND person_id=@target_id;
  INSERT dbo.AccessPersonOverride SELECT @account_id,@target_id,permission,scope,effect,validUntil FROM OPENJSON(@permissions) WITH(permission varchar(100),scope varchar(30),effect varchar(5),validUntil datetime2(7));
  SELECT @after=(SELECT person_id AS id,display_name AS displayName,employee_code AS employeeCode,active,JSON_QUERY((SELECT role_id AS id FROM dbo.AccessPersonRole WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH)) AS roles,JSON_QUERY((SELECT permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil FROM dbo.AccessPersonOverride WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH)) AS overrides FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
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
