
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
 SELECT person_id AS id,display_name AS displayName,employee_code AS employeeCode,active,entra_object_id AS entraObjectId FROM dbo.AccessPerson WHERE account_id=@account_id ORDER BY employee_code;
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
CREATE OR ALTER PROCEDURE dbo.ResolveAccessIdentity @account_id uniqueidentifier,@tenant_id uniqueidentifier,@object_id uniqueidentifier AS
BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 SELECT p.person_id AS id FROM dbo.AccessPerson p JOIN dbo.Account a ON a.account_id=p.account_id WHERE p.account_id=@account_id AND a.entra_tenant_id=@tenant_id AND p.entra_object_id=@object_id AND a.status='ACTIVE';
END;
GO
GRANT EXECUTE ON dbo.ResolveAccessIdentity TO [skill_management_runtime];