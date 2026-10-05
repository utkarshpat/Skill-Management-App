-- Own profile projection only: no directory, manager IDs or inherited access.
CREATE OR ALTER PROCEDURE dbo.ReadOwnOrganization
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace nvarchar(200),@revision int;
 SELECT @workspace=a.display_name,@revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Own profile access denied.',1;
 DECLARE @team uniqueidentifier,@department uniqueidentifier,@manager uniqueidentifier,
 @team_name nvarchar(100),@department_name nvarchar(100),@unit_name nvarchar(100),@manager_name nvarchar(100),
 @placement varchar(20)='NOT_ASSIGNED',@reporting varchar(20)='NOT_ASSIGNED';
 SELECT @team=team_id,@department=department_id,@manager=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@actor_id;
 IF @team IS NOT NULL OR @department IS NOT NULL
 BEGIN
  SET @placement='NEEDS_ATTENTION';
  IF @team IS NOT NULL AND @department IS NULL
   SELECT @team_name=t.display_name,@department_name=d.display_name,@unit_name=u.display_name
   FROM dbo.AccessOrgNode t JOIN dbo.AccessOrgNode d ON d.account_id=t.account_id AND d.node_id=t.parent_id AND d.kind='DEPARTMENT' AND d.active=1
   JOIN dbo.AccessOrgNode u ON u.account_id=d.account_id AND u.node_id=d.parent_id AND u.kind='DELIVERY_UNIT' AND u.active=1 AND u.parent_id IS NULL
   WHERE t.account_id=@account_id AND t.node_id=@team AND t.kind='TEAM' AND t.active=1;
  ELSE IF @team IS NULL AND @department IS NOT NULL
   SELECT @department_name=d.display_name,@unit_name=u.display_name
   FROM dbo.AccessOrgNode d JOIN dbo.AccessOrgNode u ON u.account_id=d.account_id AND u.node_id=d.parent_id AND u.kind='DELIVERY_UNIT' AND u.active=1 AND u.parent_id IS NULL
   WHERE d.account_id=@account_id AND d.node_id=@department AND d.kind='DEPARTMENT' AND d.active=1;
  IF @department_name IS NOT NULL SET @placement='ASSIGNED';
 END;
 IF @manager IS NOT NULL
 BEGIN
  SET @reporting='NEEDS_ATTENTION';
  IF dbo.AccessReportingValid(@account_id,@actor_id)=1
   SELECT @manager_name=display_name FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@manager AND active=1 AND person_id<>@actor_id;
  IF @manager_name IS NOT NULL SET @reporting='ASSIGNED';
 END;
 SELECT @workspace AS workspace,@placement AS placementStatus,@unit_name AS deliveryUnit,@department_name AS department,@team_name AS team,
 @reporting AS managerStatus,@manager_name AS managerName;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadOwnOrganization TO [skill_management_runtime];
