-- Preserve existing placement during manager-only updates and reject no-op assignment writes.
CREATE OR ALTER PROCEDURE dbo.SaveOrganizationChange
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@expected_revision int,
 @kind varchar(20),@target_id uniqueidentifier,@is_new bit,@payload nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @revision int,@before nvarchar(max),@after nvarchar(max),@action varchar(50);
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF @expected_revision IS NULL OR @revision<>@expected_revision THROW 51009,'Configuration changed. Reload and try again.',1;
 IF @is_new IS NULL OR @target_id IS NULL THROW 51000,'Invalid organization target.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 THROW 51003,'Organization administration is not allowed.',1;
 IF ISJSON(@payload)<>1 THROW 51000,'Invalid organization change.',1;
 IF @kind='node'
 BEGIN
  DECLARE @type varchar(20)=JSON_VALUE(@payload,'$.type'),@name nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@payload,'$.name'))),
  @parent uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.parentId')),@active bit;
  SET @active=CASE JSON_VALUE(@payload,'$.active') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END;
  IF @type IS NULL OR @type NOT IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','TEAM') OR @name IS NULL OR LEN(@name)=0 OR LEN(@name)>100 OR @active IS NULL THROW 51000,'Invalid unit name, type or status.',1;
  IF JSON_VALUE(@payload,'$.parentId') IS NOT NULL AND @parent IS NULL THROW 51000,'Invalid parent.',1;
  IF @type='DELIVERY_UNIT' AND @parent IS NOT NULL THROW 51000,'A delivery unit must be a root.',1;
  IF @type='PORTFOLIO' AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@parent AND kind='DELIVERY_UNIT' AND active=1 AND parent_id IS NULL)
   THROW 51000,'Choose an active delivery unit for this Portfolio/Division.',1;
  IF @type='DEPARTMENT' AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode f
   JOIN dbo.AccessOrgNode u ON u.account_id=f.account_id AND u.node_id=f.parent_id AND u.kind='DELIVERY_UNIT' AND u.active=1 AND u.parent_id IS NULL
   WHERE f.account_id=@account_id AND f.node_id=@parent AND f.kind='PORTFOLIO' AND f.active=1)
   THROW 51000,'Choose an active Portfolio/Division under a delivery unit.',1;
  IF @type='TEAM' AND NOT EXISTS(SELECT 1 FROM dbo.OrganizationClientPath(@account_id) WHERE department_id=@parent)
   THROW 51000,'Choose an active account/client with a Portfolio/Division and delivery unit.',1;
  IF @is_new=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@target_id) THROW 51000,'Node already exists.',1;
  IF @is_new=0 AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@target_id AND kind=@type) THROW 51004,'Node unavailable or type changed.',1;
  IF @is_new=1 AND (SELECT COUNT(*) FROM dbo.AccessOrgNode WHERE account_id=@account_id)>=1000 THROW 51000,'Organization node limit reached.',1;
  IF @active=0 AND (EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND parent_id=@target_id AND active=1)
   OR EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND (team_id=@target_id OR department_id=@target_id)))
   THROW 51000,'Move assigned people and archive active children first.',1;
  SELECT @before=(SELECT node_id AS id,kind AS type,display_name AS name,parent_id AS parentId,active FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @is_new=1 INSERT dbo.AccessOrgNode(account_id,node_id,kind,display_name,parent_id,active) VALUES(@account_id,@target_id,@type,@name,@parent,@active);
  ELSE UPDATE dbo.AccessOrgNode SET display_name=@name,parent_id=@parent,active=@active WHERE account_id=@account_id AND node_id=@target_id;
  SELECT @after=(SELECT node_id AS id,kind AS type,display_name AS name,parent_id AS parentId,active FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SET @action=CASE @is_new WHEN 1 THEN 'organization.node.created' ELSE 'organization.node.updated' END;
 END
 ELSE IF @kind='assignment'
 BEGIN
  DECLARE @department uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.departmentId')),
  @team uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.teamId')),@manager uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.managerId')),
  @existing_team uniqueidentifier=NULL,@existing_department uniqueidentifier=NULL,@existing_manager uniqueidentifier=NULL,@has_assignment bit=0;
  IF (JSON_VALUE(@payload,'$.departmentId') IS NOT NULL AND @department IS NULL) OR (JSON_VALUE(@payload,'$.teamId') IS NOT NULL AND @team IS NULL)
   OR (JSON_VALUE(@payload,'$.managerId') IS NOT NULL AND @manager IS NULL) THROW 51000,'Invalid assignment identifier.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@target_id AND active=1) THROW 51004,'Active person unavailable.',1;
  IF @team IS NOT NULL AND @department IS NOT NULL THROW 51000,'Choose either an account/client or an organizational project.',1;
  SELECT @existing_team=team_id,@existing_department=department_id,@existing_manager=manager_id,@has_assignment=1
  FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@target_id;
  IF ISNULL(@team,'00000000-0000-0000-0000-000000000000')=ISNULL(@existing_team,'00000000-0000-0000-0000-000000000000')
   AND ISNULL(@department,'00000000-0000-0000-0000-000000000000')=ISNULL(@existing_department,'00000000-0000-0000-0000-000000000000')
   AND ISNULL(@manager,'00000000-0000-0000-0000-000000000000')=ISNULL(@existing_manager,'00000000-0000-0000-0000-000000000000')
   THROW 51000,'Change the organization placement or reporting manager before saving.',1;
  DECLARE @preserve_placement bit=CASE
   WHEN @has_assignment=1
    AND NOT (@existing_team IS NOT NULL AND @existing_department IS NOT NULL)
    AND ISNULL(@team,'00000000-0000-0000-0000-000000000000')=ISNULL(@existing_team,'00000000-0000-0000-0000-000000000000')
    AND ISNULL(@department,'00000000-0000-0000-0000-000000000000')=ISNULL(@existing_department,'00000000-0000-0000-0000-000000000000')
   THEN 1 ELSE 0 END;
  IF @preserve_placement=0 AND @team IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode t JOIN dbo.OrganizationClientPath(@account_id) path ON path.department_id=t.parent_id
   WHERE t.account_id=@account_id AND t.node_id=@team AND t.kind='TEAM' AND t.active=1)
   THROW 51000,'Choose an active project with a complete Portfolio/Division path.',1;
  IF @preserve_placement=0 AND @department IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.OrganizationClientPath(@account_id) WHERE department_id=@department)
   THROW 51000,'Choose an active account/client with a complete Portfolio/Division path.',1;
  IF @manager IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@manager AND active=1) THROW 51000,'Choose an active reporting manager in this workspace.',1;
  IF @manager=@target_id THROW 51000,'A person cannot report to themselves.',1;
  DECLARE @cursor uniqueidentifier=@manager,@steps int=0;
  DECLARE @seen TABLE(id uniqueidentifier PRIMARY KEY);
  WHILE @cursor IS NOT NULL
  BEGIN
   IF @cursor=@target_id OR EXISTS(SELECT 1 FROM @seen WHERE id=@cursor) THROW 51000,'Reporting line would contain a cycle.',1;
   SET @steps=@steps+1;
   IF @steps>200 THROW 51000,'Reporting chain is too deep.',1;
   INSERT @seen VALUES(@cursor);
   DECLARE @next uniqueidentifier=NULL;
   SELECT @next=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@cursor;
   SET @cursor=@next;
  END;
  SELECT @before=(SELECT person_id AS personId,team_id AS teamId,department_id AS departmentId,manager_id AS managerId FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@target_id)
   UPDATE dbo.AccessOrgAssignment SET team_id=@team,department_id=@department,manager_id=@manager WHERE account_id=@account_id AND person_id=@target_id;
  ELSE INSERT dbo.AccessOrgAssignment(account_id,person_id,team_id,department_id,manager_id) VALUES(@account_id,@target_id,@team,@department,@manager);
  SELECT @after=(SELECT person_id AS personId,team_id AS teamId,department_id AS departmentId,manager_id AS managerId FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SET @action='organization.person.assigned';
 END
 ELSE THROW 51000,'Unknown organization change.',1;
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json)
 VALUES(@account_id,@revision+1,@actor_id,@action,@target_id,@before,@after);
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.SaveOrganizationChange TO [skill_management_runtime];
GO
