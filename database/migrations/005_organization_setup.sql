CREATE TABLE dbo.AccessOrgNode (
 account_id uniqueidentifier NOT NULL, node_id uniqueidentifier NOT NULL,
 kind varchar(20) NOT NULL CHECK(kind IN ('DELIVERY_UNIT','DEPARTMENT','TEAM')),
 display_name nvarchar(100) NOT NULL, parent_id uniqueidentifier NULL, active bit NOT NULL,
 PRIMARY KEY(account_id,node_id),
 FOREIGN KEY(account_id) REFERENCES dbo.AccessWorkspace(account_id),
 FOREIGN KEY(account_id,parent_id) REFERENCES dbo.AccessOrgNode(account_id,node_id),
 CHECK(parent_id IS NULL OR parent_id<>node_id)
);
CREATE UNIQUE INDEX UX_AccessOrg_Root ON dbo.AccessOrgNode(account_id,display_name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX UX_AccessOrg_Sibling ON dbo.AccessOrgNode(account_id,parent_id,display_name) WHERE parent_id IS NOT NULL;
CREATE TABLE dbo.AccessOrgAssignment (
 account_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,
 team_id uniqueidentifier NULL,manager_id uniqueidentifier NULL,
 PRIMARY KEY(account_id,person_id),
 FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 FOREIGN KEY(account_id,team_id) REFERENCES dbo.AccessOrgNode(account_id,node_id),
 FOREIGN KEY(account_id,manager_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 CHECK(manager_id IS NULL OR manager_id<>person_id)
);
GO
CREATE OR ALTER PROCEDURE dbo.ReadOrganization @account_id uniqueidentifier AS
BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
 BEGIN TRANSACTION;
 SELECT w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @@ROWCOUNT=0 THROW 51004,'Workspace unavailable.',1;
 SELECT node_id AS id,kind,display_name AS name,parent_id AS parentId,active FROM dbo.AccessOrgNode WHERE account_id=@account_id ORDER BY display_name;
 SELECT person_id AS personId,team_id AS teamId,manager_id AS managerId FROM dbo.AccessOrgAssignment WHERE account_id=@account_id;
 SELECT person_id AS id,display_name AS displayName,employee_code AS employeeCode,active FROM dbo.AccessPerson WHERE account_id=@account_id ORDER BY display_name;
 COMMIT TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 THROW;
 END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.SaveOrganizationChange
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@expected_revision int,
 @kind varchar(20),@target_id uniqueidentifier,@is_new bit,@payload nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @revision int,@before nvarchar(max),@after nvarchar(max),@action varchar(50);
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF @revision<>@expected_revision THROW 51009,'Configuration changed. Reload and try again.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 THROW 51003,'Organization administration is not allowed.',1;
 IF ISJSON(@payload)<>1 THROW 51000,'Invalid organization change.',1;
 IF @kind='node'
 BEGIN
  DECLARE @type varchar(20)=JSON_VALUE(@payload,'$.type'),@name nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@payload,'$.name'))),@parent uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.parentId')),@active bit;
  SET @active=CASE JSON_VALUE(@payload,'$.active') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END;
  IF @type IS NULL OR @type NOT IN ('DELIVERY_UNIT','DEPARTMENT','TEAM') OR @name IS NULL OR LEN(@name)=0 OR LEN(@name)>100 OR @active IS NULL THROW 51000,'Invalid unit name, type or status.',1;
  IF JSON_VALUE(@payload,'$.parentId') IS NOT NULL AND @parent IS NULL THROW 51000,'Invalid parent.',1;
  IF @type='DELIVERY_UNIT' AND @parent IS NOT NULL THROW 51000,'A delivery unit must be a root.',1;
  IF @type<>'DELIVERY_UNIT' AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@parent AND active=1 AND kind=CASE @type WHEN 'DEPARTMENT' THEN 'DELIVERY_UNIT' ELSE 'DEPARTMENT' END) THROW 51000,'Choose an active parent at the preceding level.',1;
  IF @is_new=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@target_id) THROW 51000,'Node already exists.',1;
  IF @is_new=0 AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@target_id AND kind=@type) THROW 51004,'Node unavailable or type changed.',1;
  IF @is_new=1 AND (SELECT COUNT(*) FROM dbo.AccessOrgNode WHERE account_id=@account_id)>=1000 THROW 51000,'Organization node limit reached.',1;
  IF @active=0 AND (EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND parent_id=@target_id AND active=1) OR EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND team_id=@target_id)) THROW 51000,'Move assigned people and archive active children first.',1;
  SELECT @before=(SELECT node_id AS id,kind AS type,display_name AS name,parent_id AS parentId,active FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @is_new=1 INSERT dbo.AccessOrgNode VALUES(@account_id,@target_id,@type,@name,@parent,@active);
  ELSE UPDATE dbo.AccessOrgNode SET display_name=@name,parent_id=@parent,active=@active WHERE account_id=@account_id AND node_id=@target_id;
  SELECT @after=(SELECT node_id AS id,kind AS type,display_name AS name,parent_id AS parentId,active FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SET @action=CASE @is_new WHEN 1 THEN 'organization.node.created' ELSE 'organization.node.updated' END;
 END
 ELSE IF @kind='assignment'
 BEGIN
  DECLARE @team uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.teamId')),@manager uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.managerId'));
  IF (JSON_VALUE(@payload,'$.teamId') IS NOT NULL AND @team IS NULL) OR (JSON_VALUE(@payload,'$.managerId') IS NOT NULL AND @manager IS NULL) THROW 51000,'Invalid assignment identifier.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@target_id AND active=1) THROW 51004,'Active person unavailable.',1;
  IF @team IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@team AND kind='TEAM' AND active=1) THROW 51000,'Choose an active team in this workspace.',1;
  IF @manager IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@manager AND active=1) THROW 51000,'Choose an active reporting manager in this workspace.',1;
  IF @manager=@target_id THROW 51000,'A person cannot report to themselves.',1;
  -- Walk current edges under the shared workspace lock. No role names or client hierarchy inputs.
  DECLARE @cursor uniqueidentifier=@manager,@steps int=0; DECLARE @seen TABLE(id uniqueidentifier PRIMARY KEY);
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
  SELECT @before=(SELECT person_id AS personId,team_id AS teamId,manager_id AS managerId FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@target_id)
   UPDATE dbo.AccessOrgAssignment SET team_id=@team,manager_id=@manager WHERE account_id=@account_id AND person_id=@target_id;
  ELSE INSERT dbo.AccessOrgAssignment VALUES(@account_id,@target_id,@team,@manager);
  SELECT @after=(SELECT person_id AS personId,team_id AS teamId,manager_id AS managerId FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SET @action='organization.person.assigned';
 END
 ELSE THROW 51000,'Unknown organization change.',1;
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@revision+1,@actor_id,@action,@target_id,NULLIF(@before,''),@after);
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
 END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadOrganization TO [skill_management_runtime];
GRANT EXECUTE ON dbo.SaveOrganizationChange TO [skill_management_runtime];
