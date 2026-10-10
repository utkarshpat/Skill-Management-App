-- Explicit opt-in migration of authority: structures alone grant nobody access.
ALTER TABLE dbo.AccessWorkspace ADD personal_baseline_enabled bit NOT NULL CONSTRAINT DF_PersonalBaseline DEFAULT 0;
CREATE TABLE dbo.BusinessProject(
 account_id uniqueidentifier NOT NULL,id uniqueidentifier NOT NULL,name nvarchar(100) NOT NULL,department_id uniqueidentifier NULL,active bit NOT NULL,
 PRIMARY KEY(account_id,id),UNIQUE(account_id,name),FOREIGN KEY(account_id) REFERENCES dbo.AccessWorkspace(account_id),FOREIGN KEY(account_id,department_id) REFERENCES dbo.AccessOrgNode(account_id,node_id));
CREATE TABLE dbo.BusinessProjectMember(
 account_id uniqueidentifier NOT NULL,project_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,active bit NOT NULL,
 PRIMARY KEY(account_id,project_id,person_id),FOREIGN KEY(account_id,project_id) REFERENCES dbo.BusinessProject(account_id,id),FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id));
CREATE INDEX IX_BusinessProjectMember_Person ON dbo.BusinessProjectMember(account_id,person_id,active,project_id);
CREATE TABLE dbo.BusinessResponsibility(
 account_id uniqueidentifier NOT NULL,id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,bundle varchar(30) NOT NULL CHECK(bundle IN('BUSINESS_OPERATIONS','SYSTEM_ADMIN')),
 scope_kind varchar(20) NOT NULL CHECK(scope_kind IN('ORGANIZATION','DELIVERY_UNIT','DEPARTMENT','PROJECT')),scope_id uniqueidentifier NULL,
 effect varchar(5) NOT NULL CHECK(effect IN('ALLOW','DENY')),active bit NOT NULL,valid_until datetime2 NULL,reason nvarchar(1000) NOT NULL,
 PRIMARY KEY(account_id,id),FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 CHECK((scope_kind='ORGANIZATION' AND scope_id IS NULL) OR (scope_kind<>'ORGANIZATION' AND scope_id IS NOT NULL)),
 CHECK(bundle<>'SYSTEM_ADMIN' OR scope_kind='ORGANIZATION'),CHECK(effect<>'DENY' OR valid_until IS NOT NULL),CHECK(LEN(LTRIM(RTRIM(reason)))>0));
CREATE INDEX IX_BusinessResponsibility_Actor ON dbo.BusinessResponsibility(account_id,person_id,active,effect,scope_kind);
CREATE INDEX IX_Business_CertExpiry ON dbo.CertificationRecord(account_id,status,expiry_date,person_id) INCLUDE(provider,category,certification_name,submitted_at,reviewed_at);
CREATE INDEX IX_Business_SkillCoverage ON dbo.SkillClaimDraft(account_id,status,skill_id,person_id) INCLUDE(claimed_rank,submitted_at,reviewed_at);
GO
CREATE OR ALTER FUNCTION dbo.BusinessLegacyDenied(@account uniqueidentifier,@actor uniqueidentifier,@permission varchar(100)) RETURNS bit AS BEGIN
 IF EXISTS(SELECT 1 FROM dbo.AccessPersonOverride WHERE account_id=@account AND person_id=@actor AND permission_code=@permission AND scope_kind='ORGANIZATION' AND effect='DENY' AND (valid_until IS NULL OR valid_until>SYSUTCDATETIME())) RETURN 1;
 IF EXISTS(SELECT 1 FROM dbo.AccountRolePermission r JOIN dbo.AccessPersonRole p ON p.account_id=r.account_id AND p.role_id=r.role_id WHERE p.account_id=@account AND p.person_id=@actor AND r.permission_code=@permission AND r.scope_kind='ORGANIZATION' AND r.effect='DENY' AND (r.valid_until IS NULL OR r.valid_until>SYSUTCDATETIME())) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessSystemAdmin(@account uniqueidentifier,@actor uniqueidentifier) RETURNS bit AS BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson p JOIN dbo.Account a ON a.account_id=p.account_id WHERE p.account_id=@account AND p.person_id=@actor AND p.active=1 AND a.status='ACTIVE') RETURN 0;
 IF EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account AND person_id=@actor AND bundle='SYSTEM_ADMIN' AND active=1 AND effect='DENY' AND valid_until>SYSUTCDATETIME()) RETURN 0;
 IF EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account AND person_id=@actor AND bundle='SYSTEM_ADMIN' AND active=1 AND effect='ALLOW' AND (valid_until IS NULL OR valid_until>SYSUTCDATETIME())) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessScopeValid(@account uniqueidentifier,@kind varchar(20),@scope uniqueidentifier) RETURNS bit AS BEGIN
 IF @kind='ORGANIZATION' AND @scope IS NULL RETURN 1;
 IF @kind='PROJECT' AND EXISTS(SELECT 1 FROM dbo.BusinessProject WHERE account_id=@account AND id=@scope AND active=1) RETURN 1;
 IF EXISTS(SELECT 1 FROM dbo.AccessOrgNode n WHERE n.account_id=@account AND n.node_id=@scope AND n.kind=@kind AND n.active=1 AND (n.kind='DELIVERY_UNIT' AND n.parent_id IS NULL OR n.kind='DEPARTMENT' AND EXISTS(SELECT 1 FROM dbo.AccessOrgNode u WHERE u.account_id=n.account_id AND u.node_id=n.parent_id AND u.kind='DELIVERY_UNIT' AND u.active=1 AND u.parent_id IS NULL))) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessResponsibilityUsable(@account uniqueidentifier,@actor uniqueidentifier,@grant uniqueidentifier) RETURNS bit AS BEGIN
 IF EXISTS(SELECT 1 FROM dbo.BusinessResponsibility g WHERE g.account_id=@account AND g.person_id=@actor AND g.id=@grant AND g.active=1 AND g.effect='ALLOW' AND (g.valid_until IS NULL OR g.valid_until>SYSUTCDATETIME()) AND dbo.BusinessScopeValid(g.account_id,g.scope_kind,g.scope_id)=1
 AND NOT EXISTS(SELECT 1 FROM dbo.BusinessResponsibility d WHERE d.account_id=g.account_id AND d.person_id=g.person_id AND d.active=1 AND d.effect='DENY' AND (d.valid_until IS NULL OR d.valid_until>SYSUTCDATETIME()) AND (d.scope_kind='ORGANIZATION' OR d.scope_kind=g.scope_kind AND (d.scope_id=g.scope_id OR d.scope_id IS NULL AND g.scope_id IS NULL) OR d.scope_kind='DELIVERY_UNIT' AND g.scope_kind='DEPARTMENT' AND EXISTS(SELECT 1 FROM dbo.AccessOrgNode department WHERE department.account_id=g.account_id AND department.node_id=g.scope_id AND department.kind='DEPARTMENT' AND department.parent_id=d.scope_id)))) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessScopeMatches(@account uniqueidentifier,@person uniqueidentifier,@kind varchar(20),@scope uniqueidentifier) RETURNS bit AS BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account AND person_id=@person AND active=1) RETURN 0;
 IF @kind='ORGANIZATION' RETURN 1;
 IF @kind='PROJECT' AND EXISTS(SELECT 1 FROM dbo.BusinessProjectMember m JOIN dbo.BusinessProject p ON p.account_id=m.account_id AND p.id=m.project_id AND p.active=1 WHERE m.account_id=@account AND m.person_id=@person AND m.project_id=@scope AND m.active=1) RETURN 1;
 DECLARE @department uniqueidentifier,@unit uniqueidentifier;
 SELECT @department=d.node_id,@unit=u.node_id FROM dbo.AccessOrgAssignment a
 LEFT JOIN dbo.AccessOrgNode t ON t.account_id=a.account_id AND t.node_id=a.team_id AND t.kind='TEAM' AND t.active=1
 JOIN dbo.AccessOrgNode d ON d.account_id=a.account_id AND d.node_id=COALESCE(a.department_id,t.parent_id) AND d.kind='DEPARTMENT' AND d.active=1
 JOIN dbo.AccessOrgNode u ON u.account_id=d.account_id AND u.node_id=d.parent_id AND u.kind='DELIVERY_UNIT' AND u.active=1 AND u.parent_id IS NULL
 WHERE a.account_id=@account AND a.person_id=@person;
 IF @kind='DEPARTMENT' AND @department=@scope OR @kind='DELIVERY_UNIT' AND @unit=@scope RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessScopePeople(@account uniqueidentifier,@kind varchar(20),@scope uniqueidentifier) RETURNS TABLE AS RETURN (
 SELECT p.person_id FROM dbo.AccessPerson p WHERE p.account_id=@account AND p.active=1 AND @kind='ORGANIZATION'
 UNION ALL
 SELECT m.person_id FROM dbo.BusinessProjectMember m JOIN dbo.BusinessProject p ON p.account_id=m.account_id AND p.id=m.project_id AND p.active=1 JOIN dbo.AccessPerson person ON person.account_id=m.account_id AND person.person_id=m.person_id AND person.active=1 WHERE m.account_id=@account AND m.active=1 AND @kind='PROJECT' AND m.project_id=@scope
 UNION ALL
 SELECT a.person_id FROM dbo.AccessOrgAssignment a JOIN dbo.AccessPerson p ON p.account_id=a.account_id AND p.person_id=a.person_id AND p.active=1
 LEFT JOIN dbo.AccessOrgNode t ON t.account_id=a.account_id AND t.node_id=a.team_id AND t.kind='TEAM' AND t.active=1
 JOIN dbo.AccessOrgNode d ON d.account_id=a.account_id AND d.node_id=COALESCE(a.department_id,t.parent_id) AND d.kind='DEPARTMENT' AND d.active=1
 JOIN dbo.AccessOrgNode u ON u.account_id=d.account_id AND u.node_id=d.parent_id AND u.kind='DELIVERY_UNIT' AND u.active=1 AND u.parent_id IS NULL
 WHERE a.account_id=@account AND (@kind='DEPARTMENT' AND d.node_id=@scope OR @kind='DELIVERY_UNIT' AND u.node_id=@scope)
);
GO
CREATE OR ALTER FUNCTION dbo.BusinessVisiblePeople(@account uniqueidentifier,@actor uniqueidentifier,@selected uniqueidentifier) RETURNS TABLE AS RETURN (
 SELECT DISTINCT members.person_id FROM dbo.BusinessResponsibility g CROSS APPLY dbo.BusinessScopePeople(g.account_id,g.scope_kind,g.scope_id) members
 WHERE g.account_id=@account AND g.person_id=@actor AND g.active=1 AND g.effect='ALLOW' AND (g.valid_until IS NULL OR g.valid_until>SYSUTCDATETIME()) AND (@selected IS NULL OR g.id=@selected) AND dbo.BusinessResponsibilityUsable(@account,@actor,g.id)=1
 AND EXISTS(SELECT 1 FROM dbo.AccessPerson actor JOIN dbo.Account a ON a.account_id=actor.account_id WHERE actor.account_id=@account AND actor.person_id=@actor AND actor.active=1 AND a.status='ACTIVE') AND dbo.BusinessLegacyDenied(@account,@actor,'reports.view')=0
 EXCEPT
 SELECT members.person_id FROM dbo.BusinessResponsibility g CROSS APPLY dbo.BusinessScopePeople(g.account_id,g.scope_kind,g.scope_id) members WHERE g.account_id=@account AND g.person_id=@actor AND g.active=1 AND g.effect='DENY' AND (g.valid_until IS NULL OR g.valid_until>SYSUTCDATETIME())
);
GO
CREATE OR ALTER FUNCTION dbo.BusinessCan(@account uniqueidentifier,@actor uniqueidentifier,@person uniqueidentifier,@selected uniqueidentifier) RETURNS bit AS BEGIN
 IF EXISTS(SELECT 1 FROM dbo.BusinessVisiblePeople(@account,@actor,@selected) WHERE person_id=@person) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessHasResponsibility(@account uniqueidentifier,@actor uniqueidentifier) RETURNS bit AS BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson p JOIN dbo.Account a ON a.account_id=p.account_id WHERE p.account_id=@account AND p.person_id=@actor AND p.active=1 AND a.status='ACTIVE') RETURN 0;
 IF EXISTS(SELECT 1 FROM dbo.BusinessResponsibility d WHERE d.account_id=@account AND d.person_id=@actor AND d.active=1 AND d.effect='DENY' AND d.scope_kind='ORGANIZATION' AND (d.valid_until IS NULL OR d.valid_until>SYSUTCDATETIME())) RETURN 0;
 -- Empty valid scopes may be opened; fully denied or inactive bindings are unavailable.
 IF EXISTS(SELECT 1 FROM dbo.BusinessResponsibility g WHERE g.account_id=@account AND g.person_id=@actor AND dbo.BusinessResponsibilityUsable(@account,@actor,g.id)=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessHasAccess(@account uniqueidentifier,@actor uniqueidentifier) RETURNS bit AS BEGIN
 IF dbo.BusinessLegacyDenied(@account,@actor,'reports.view')=1 RETURN 0;
 RETURN dbo.BusinessHasResponsibility(@account,@actor);
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessAmendCan(@account uniqueidentifier,@actor uniqueidentifier) RETURNS bit AS BEGIN
 IF dbo.AccessCan(@account,@actor,'profile.view',1)<>1 OR dbo.AccessCan(@account,@actor,'skill.view',0)<>1 OR dbo.BusinessLegacyDenied(@account,@actor,'skill.catalogue.propose')=1 RETURN 0;
 IF dbo.BusinessHasResponsibility(@account,@actor)=1 RETURN 1;
 IF dbo.AccessReportingValid(@account,@actor)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment a JOIN dbo.AccessPerson p ON p.account_id=a.account_id AND p.person_id=a.person_id AND p.active=1 WHERE a.account_id=@account AND a.manager_id=@actor AND a.person_id<>@actor AND dbo.AccessReportingValid(@account,a.person_id)=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessProjection(@account uniqueidentifier,@actor uniqueidentifier) RETURNS nvarchar(max) AS BEGIN
 DECLARE @result nvarchar(max);
 SELECT @result=(SELECT w.personal_baseline_enabled AS personalBaseline,dbo.BusinessHasAccess(@account,@actor) AS [view],
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account,@actor)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'reports.export')=0 THEN 1 ELSE 0 END) AS [export],
 dbo.BusinessSystemAdmin(@account,@actor) AS systemAdmin,dbo.BusinessAmendCan(@account,@actor) AS amend,
 CONVERT(bit,CASE WHEN dbo.AccessCan(@account,@actor,'profile.view',1)=1 AND dbo.AccessCan(@account,@actor,'permissions.manage',0)=1 AND dbo.AccessCan(@account,@actor,'users.manage',0)=1 AND dbo.AccessCan(@account,@actor,'audit.view',0)=1 THEN 1 ELSE 0 END) AS manage,
 CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account AND person_id=@actor AND bundle='SYSTEM_ADMIN' AND active=1 AND effect='DENY' AND valid_until>SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS adminDenied,
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account,@actor)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'demand.view')=0 THEN 1 ELSE 0 END) AS demandView,
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account,@actor)=1 AND dbo.AccessCan(@account,@actor,'skill.view',0)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'demand.create')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'demand.view')=0 THEN 1 ELSE 0 END) AS demandCreate,
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account,@actor)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'matching.view')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'demand.view')=0 THEN 1 ELSE 0 END) AS matchingView,
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account,@actor)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'matching.run')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'matching.view')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'demand.view')=0 THEN 1 ELSE 0 END) AS matchingRun,
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account,@actor)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'matching.shortlist')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'matching.run')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'matching.view')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'demand.view')=0 THEN 1 ELSE 0 END) AS shortlist,
 CONVERT(bit,CASE WHEN dbo.AccessCan(@account,@actor,'permissions.manage',0)=1 AND dbo.AccessCan(@account,@actor,'users.manage',0)=1 AND dbo.AccessCan(@account,@actor,'audit.view',0)=1 AND dbo.AccessCan(@account,@actor,'skill.catalogue.manage',0)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'request.approve')=0 THEN 1 ELSE 0 END) AS approve,
 JSON_QUERY((SELECT g.id,g.bundle,g.scope_kind AS kind,g.scope_id AS scopeId,COALESCE(p.name,n.display_name,N'Organization') AS label,g.effect,g.valid_until AS validUntil,g.reason FROM dbo.BusinessResponsibility g LEFT JOIN dbo.BusinessProject p ON g.scope_kind='PROJECT' AND p.account_id=g.account_id AND p.id=g.scope_id LEFT JOIN dbo.AccessOrgNode n ON g.scope_kind IN('DELIVERY_UNIT','DEPARTMENT') AND n.account_id=g.account_id AND n.node_id=g.scope_id WHERE g.account_id=@account AND g.person_id=@actor AND g.active=1 AND (g.valid_until IS NULL OR g.valid_until>SYSUTCDATETIME()) AND dbo.BusinessScopeValid(@account,g.scope_kind,g.scope_id)=1 AND (g.effect='DENY' OR dbo.BusinessResponsibilityUsable(@account,@actor,g.id)=1) FOR JSON PATH,INCLUDE_NULL_VALUES)) AS scopes FROM dbo.AccessWorkspace w WHERE w.account_id=@account FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 RETURN @result;
END;
GO
CREATE OR ALTER PROCEDURE dbo.BusinessContext @account_id uniqueidentifier,@actor_id uniqueidentifier AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @lock int;SELECT @lock=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Personal access denied.',1;
 DECLARE @policy nvarchar(max)=dbo.BusinessProjection(@account_id,@actor_id);
 SELECT (SELECT w.revision,@actor_id AS actorId,SYSUTCDATETIME() AS asOf,dbo.BusinessHasAccess(@account_id,@actor_id) AS canView,
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account_id,@actor_id)=1 AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=0 THEN 1 ELSE 0 END) AS canExport,
 CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'users.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'audit.view',0)=1 THEN 1 ELSE 0 END) AS canManage,
 dbo.BusinessAmendCan(@account_id,@actor_id) AS canAmend,
 CONVERT(bit,JSON_VALUE(@policy,'$.demandView')) AS canDemandView,CONVERT(bit,JSON_VALUE(@policy,'$.demandCreate')) AS canDemandCreate,CONVERT(bit,JSON_VALUE(@policy,'$.matchingRun')) AS canMatch,CONVERT(bit,JSON_VALUE(@policy,'$.shortlist')) AS canShortlist,CONVERT(bit,JSON_VALUE(@policy,'$.approve')) AS canApprove,
 w.personal_baseline_enabled AS personalBaseline,JSON_QUERY(JSON_QUERY(@policy,'$.scopes')) AS scopes FROM dbo.AccessWorkspace w WHERE account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.BusinessAdministration @account_id uniqueidentifier,@actor_id uniqueidentifier AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'audit.view',0)<>1 THROW 51003,'Administration denied.',1;
 SELECT (SELECT @revision AS revision,w.personal_baseline_enabled AS personalBaseline,
 (SELECT COUNT(*) FROM dbo.AccessPerson WHERE account_id=@account_id AND active=1) AS baselineAffectedPeople,
 JSON_QUERY((SELECT id,name,department_id AS departmentId,active FROM dbo.BusinessProject WHERE account_id=@account_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS projects,
 JSON_QUERY((SELECT project_id AS projectId,person_id AS personId,active FROM dbo.BusinessProjectMember WHERE account_id=@account_id FOR JSON PATH)) AS memberships,
 JSON_QUERY((SELECT id,person_id AS personId,bundle,scope_kind AS kind,scope_id AS scopeId,effect,active,valid_until AS validUntil,reason FROM dbo.BusinessResponsibility WHERE account_id=@account_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS responsibilities,
 JSON_QUERY((SELECT person_id AS id,display_name AS name,employee_code AS employeeCode,active FROM dbo.AccessPerson WHERE account_id=@account_id ORDER BY employee_code FOR JSON PATH)) AS people,
 JSON_QUERY((SELECT node_id AS id,kind,display_name AS name,active FROM dbo.AccessOrgNode WHERE account_id=@account_id FOR JSON PATH)) AS nodes,
 JSON_QUERY((SELECT r.role_id AS roleId,r.permission_code AS permission,r.scope_kind AS scope,r.effect FROM dbo.AccountRolePermission r WHERE r.account_id=@account_id AND NOT EXISTS(SELECT 1 FROM dbo.AccessImplementedScope s WHERE s.permission_code=r.permission_code AND s.scope_kind=r.scope_kind) FOR JSON PATH)) AS historicalGrantsForReview
 FROM dbo.AccessWorkspace w WHERE account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.SaveBusinessChange @account_id uniqueidentifier,@actor_id uniqueidentifier,@expected_revision int,@kind varchar(30),@id uniqueidentifier,@payload nvarchar(max) AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;SELECT @revision=revision FROM dbo.AccessWorkspace WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'audit.view',0)<>1 THROW 51003,'Administration denied.',1;
 IF @expected_revision IS NULL OR @revision<>@expected_revision THROW 51009,'Access changed. Preview again.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>10000 OR @id IS NULL OR NULLIF(LTRIM(RTRIM(JSON_VALUE(@payload,'$.reason'))),'') IS NULL THROW 51000,'Explain a valid change.',1;
 DECLARE @before nvarchar(max),@after nvarchar(max),@active bit=TRY_CONVERT(bit,JSON_VALUE(@payload,'$.active')),@person uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.personId')),
 @scope uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.scopeId')),@scopeKind varchar(20)=JSON_VALUE(@payload,'$.kind'),@bundle varchar(30)=JSON_VALUE(@payload,'$.bundle'),@effect varchar(5)=JSON_VALUE(@payload,'$.effect'),@until datetime2=TRY_CONVERT(datetime2,JSON_VALUE(@payload,'$.validUntil')),
 @reason nvarchar(1000)=JSON_VALUE(@payload,'$.reason'),@department uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.departmentId'));
 IF @kind='PROJECT' BEGIN
  IF @active IS NULL OR NULLIF(LTRIM(RTRIM(JSON_VALUE(@payload,'$.name'))),'') IS NULL OR LEN(JSON_VALUE(@payload,'$.name'))>100 THROW 51000,'Invalid project.',1;
  IF @department IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@department AND kind='DEPARTMENT' AND active=1) THROW 51000,'Choose an active department.',1;
  SELECT @before=(SELECT * FROM dbo.BusinessProject WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF EXISTS(SELECT 1 FROM dbo.BusinessProject WHERE account_id=@account_id AND id=@id) UPDATE dbo.BusinessProject SET name=JSON_VALUE(@payload,'$.name'),department_id=@department,active=@active WHERE account_id=@account_id AND id=@id;
  ELSE INSERT dbo.BusinessProject VALUES(@account_id,@id,JSON_VALUE(@payload,'$.name'),@department,@active);
 END ELSE IF @kind='MEMBERSHIP' BEGIN
  DECLARE @project uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.projectId'));
  IF @active IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@person AND (@active=0 OR active=1)) OR NOT EXISTS(SELECT 1 FROM dbo.BusinessProject WHERE account_id=@account_id AND id=@project AND (@active=0 OR active=1)) THROW 51000,'Choose an active person and project.',1;
  SELECT @before=(SELECT * FROM dbo.BusinessProjectMember WHERE account_id=@account_id AND project_id=@project AND person_id=@person FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF EXISTS(SELECT 1 FROM dbo.BusinessProjectMember WHERE account_id=@account_id AND project_id=@project AND person_id=@person) UPDATE dbo.BusinessProjectMember SET active=@active WHERE account_id=@account_id AND project_id=@project AND person_id=@person;
  ELSE INSERT dbo.BusinessProjectMember VALUES(@account_id,@project,@person,@active);
 END ELSE IF @kind='RESPONSIBILITY' BEGIN
  IF @active IS NULL OR @scopeKind IS NULL OR @scopeKind NOT IN('ORGANIZATION','DELIVERY_UNIT','DEPARTMENT','PROJECT') OR @bundle IS NULL OR @bundle NOT IN('SYSTEM_ADMIN','BUSINESS_OPERATIONS') OR @effect IS NULL OR @effect NOT IN('ALLOW','DENY') OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@person AND (@active=0 OR active=1)) THROW 51000,'Invalid responsibility.',1;
  IF @bundle='SYSTEM_ADMIN' AND @scopeKind<>'ORGANIZATION' OR @scopeKind='ORGANIZATION' AND @scope IS NOT NULL OR @scopeKind<>'ORGANIZATION' AND @scope IS NULL THROW 51000,'Invalid scope binding.',1;
  IF JSON_VALUE(@payload,'$.validUntil') IS NOT NULL AND (@until IS NULL OR @active=1 AND @until<=SYSUTCDATETIME()) OR @effect='DENY' AND @until IS NULL THROW 51000,'Exception needs future expiry.',1;
  IF @scopeKind='PROJECT' AND NOT EXISTS(SELECT 1 FROM dbo.BusinessProject WHERE account_id=@account_id AND id=@scope AND (@active=0 OR active=1)) OR @scopeKind IN('DELIVERY_UNIT','DEPARTMENT') AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@scope AND kind=@scopeKind AND (@active=0 OR active=1)) THROW 51000,'Choose an active scope in this account.',1;
  SELECT @before=(SELECT * FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND id=@id) UPDATE dbo.BusinessResponsibility SET person_id=@person,bundle=@bundle,scope_kind=@scopeKind,scope_id=@scope,effect=@effect,active=@active,valid_until=@until,reason=@reason WHERE account_id=@account_id AND id=@id;
  ELSE INSERT dbo.BusinessResponsibility VALUES(@account_id,@id,@person,@bundle,@scopeKind,@scope,@effect,@active,@until,@reason);
 END ELSE IF @kind='PERSONAL_BASELINE' BEGIN
  DECLARE @enabled bit=TRY_CONVERT(bit,JSON_VALUE(@payload,'$.enabled'));IF @enabled IS NULL THROW 51000,'Choose baseline state.',1;
  SELECT @before=(SELECT personal_baseline_enabled AS enabled FROM dbo.AccessWorkspace WHERE account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  UPDATE dbo.AccessWorkspace SET personal_baseline_enabled=@enabled WHERE account_id=@account_id;
 END ELSE THROW 51000,'Unsupported change.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND dbo.AccessCan(@account_id,person_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,person_id,'users.manage',0)=1 AND dbo.AccessCan(@account_id,person_id,'audit.view',0)=1 AND dbo.AccessCan(@account_id,person_id,'profile.view',1)=1) THROW 51000,'Keep at least one active access administrator.',1;
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,target_id,action,occurred_at,before_json,after_json) VALUES(@account_id,@revision+1,@actor_id,@id,'business.'+LOWER(@kind),SYSUTCDATETIME(),@before,@payload);
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.BusinessDashboard @account_id uniqueidentifier,@actor_id uniqueidentifier,@payload nvarchar(max),@export bit=0 AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.BusinessHasAccess(@account_id,@actor_id)<>1 OR @export=1 AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=1 THROW 51003,'Business access denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>10000 THROW 51000,'Invalid query.',1;
 DECLARE @asof datetime2=SYSUTCDATETIME(),@scopeSnapshot nvarchar(max)=JSON_QUERY(dbo.BusinessProjection(@account_id,@actor_id),'$.scopes');
 DECLARE @scope uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.scopeId')),@dataset varchar(20)=JSON_VALUE(@payload,'$.dataset'),@sort varchar(20)=ISNULL(JSON_VALUE(@payload,'$.sort'),'updated_desc'),@search nvarchar(100)=ISNULL(JSON_VALUE(@payload,'$.search'),''),
 @status varchar(20)=ISNULL(JSON_VALUE(@payload,'$.status'),''),@validity varchar(10)=ISNULL(JSON_VALUE(@payload,'$.validity'),''),@category nvarchar(80)=ISNULL(JSON_VALUE(@payload,'$.category'),''),@issuer nvarchar(120)=ISNULL(JSON_VALUE(@payload,'$.issuer'),''),
 @skill uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.skillId')),@rank int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.minRank')),@maxRank int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.maxRank')),@page int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),@from date=TRY_CONVERT(date,NULLIF(JSON_VALUE(@payload,'$.from'),'')),@to date=TRY_CONVERT(date,NULLIF(JSON_VALUE(@payload,'$.to'),'')),@today date=CONVERT(date,@asof);
 IF @sort NOT IN('employee_asc','employee_desc','name_asc','updated_desc','expiry_asc') THROW 51000,'Invalid sort.',1;
 IF @dataset IS NULL OR @dataset NOT IN('people','skills','certifications','submissions') OR @status NOT IN('','SUBMITTED','APPROVED','CHANGES_REQUESTED','REJECTED') OR @validity NOT IN('','CURRENT','EXPIRED','14','30','60','90','15_30','31_60','61_90','NO_EXPIRY','LATER') OR @rank IS NULL OR @rank NOT BETWEEN 1 AND 5 OR @maxRank IS NULL OR @maxRank NOT BETWEEN @rank AND 5 OR @page IS NULL OR @page NOT BETWEEN 1 AND 10000 THROW 51000,'Invalid filters.',1;
 IF JSON_VALUE(@payload,'$.scopeId') IS NOT NULL AND (@scope IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND person_id=@actor_id AND id=@scope AND dbo.BusinessResponsibilityUsable(@account_id,@actor_id,id)=1)) THROW 51003,'Selected scope unavailable.',1;
 SELECT p.person_id,p.display_name,p.employee_code INTO #people FROM dbo.AccessPerson p JOIN dbo.BusinessVisiblePeople(@account_id,@actor_id,@scope) visible ON visible.person_id=p.person_id WHERE p.account_id=@account_id AND (@search='' OR CHARINDEX(@search,p.display_name)>0 OR CHARINDEX(@search,p.employee_code)>0);
 CREATE UNIQUE CLUSTERED INDEX IX_People ON #people(person_id);
 SELECT c.claim_id AS id,c.person_id,c.skill_id,c.skill_name AS name,c.category,c.claimed_rank AS recorded_rank,CASE WHEN c.claimed_rank>5 THEN 5 ELSE c.claimed_rank END AS rank,c.status,c.submitted_at,c.reviewed_at,c.updated_at INTO #skills FROM dbo.SkillClaimDraft c JOIN #people p ON p.person_id=c.person_id WHERE c.account_id=@account_id AND c.status<>'DRAFT' AND (@category='' OR c.category=@category) AND (@skill IS NULL OR c.skill_id=@skill) AND (CASE WHEN c.claimed_rank>5 THEN 5 ELSE c.claimed_rank END) BETWEEN @rank AND @maxRank;
 SELECT c.id,c.person_id,c.certification_name AS name,c.provider AS issuer,c.category,c.issue_date,c.expiry_date,c.status,c.submitted_at,c.reviewed_at,c.updated_at INTO #certs FROM dbo.CertificationRecord c JOIN #people p ON p.person_id=c.person_id WHERE c.account_id=@account_id AND c.status<>'DRAFT' AND (@category='' OR c.category=@category) AND (@issuer='' OR c.provider=@issuer) AND (@validity='' OR @validity='EXPIRED' AND c.expiry_date<@today OR @validity='CURRENT' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today) OR @validity IN('14','30','60','90') AND c.expiry_date BETWEEN @today AND DATEADD(day,TRY_CONVERT(int,@validity),@today) OR @validity='15_30' AND c.expiry_date BETWEEN DATEADD(day,15,@today) AND DATEADD(day,30,@today) OR @validity='31_60' AND c.expiry_date BETWEEN DATEADD(day,31,@today) AND DATEADD(day,60,@today) OR @validity='61_90' AND c.expiry_date BETWEEN DATEADD(day,61,@today) AND DATEADD(day,90,@today) OR @validity='NO_EXPIRY' AND c.expiry_date IS NULL OR @validity='LATER' AND c.expiry_date>DATEADD(day,90,@today));
 DECLARE @rows nvarchar(max),@total int,@size int=CASE WHEN @export=1 THEN 50000 ELSE 25 END,@offset int=CASE WHEN @export=1 THEN 0 ELSE (@page-1)*25 END;
 IF @dataset='people' BEGIN
  SELECT @total=COUNT(*) FROM #people p WHERE (@validity='' AND @issuer='' OR EXISTS(SELECT 1 FROM #certs c WHERE c.person_id=p.person_id)) AND (@skill IS NULL OR EXISTS(SELECT 1 FROM #skills s WHERE s.person_id=p.person_id));
  SELECT @rows=(SELECT p.person_id AS id,p.display_name AS employee,p.employee_code AS employeeCode,(SELECT COUNT(*) FROM #skills s WHERE s.person_id=p.person_id AND s.status='APPROVED') AS reviewedSkills,(SELECT COUNT(*) FROM #certs c WHERE c.person_id=p.person_id AND c.status='APPROVED' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today)) AS currentCertifications FROM #people p WHERE (@validity='' AND @issuer='' OR EXISTS(SELECT 1 FROM #certs c WHERE c.person_id=p.person_id)) AND (@skill IS NULL OR EXISTS(SELECT 1 FROM #skills s WHERE s.person_id=p.person_id)) ORDER BY CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort<>'employee_desc' THEN p.display_name END,p.person_id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH);
 END ELSE IF @dataset='submissions' BEGIN
  SELECT 'skill-'+CONVERT(varchar(36),s.id) AS id,s.person_id,'SKILL' AS type,s.name,s.category,s.status,s.submitted_at,s.reviewed_at,s.updated_at INTO #submissions FROM #skills s WHERE @status='' OR s.status=@status
  UNION ALL SELECT 'certification-'+CONVERT(varchar(36),c.id),c.person_id,'CERTIFICATION',c.name,c.category,c.status,c.submitted_at,c.reviewed_at,c.updated_at FROM #certs c WHERE @status='' OR c.status=@status;
  SELECT @total=COUNT(*) FROM #submissions;
  SELECT @rows=(SELECT s.id,p.display_name AS employee,p.employee_code AS employeeCode,s.type,s.name,s.category,s.status,s.submitted_at AS submittedAt,s.reviewed_at AS reviewedAt FROM #submissions s JOIN #people p ON p.person_id=s.person_id ORDER BY CASE WHEN @sort='employee_asc' THEN p.display_name END,CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort='name_asc' THEN s.name END,s.updated_at DESC,s.id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
 END ELSE IF @dataset='skills' BEGIN
  SELECT @total=COUNT(*) FROM #skills WHERE @status='' OR status=@status;
  SELECT @rows=(SELECT s.id,p.display_name AS employee,p.employee_code AS employeeCode,s.name,s.category,s.recorded_rank AS recordedRank,s.rank AS chartRank,s.status,s.submitted_at AS submittedAt,s.reviewed_at AS reviewedAt FROM #skills s JOIN #people p ON p.person_id=s.person_id WHERE @status='' OR s.status=@status ORDER BY CASE WHEN @sort='employee_asc' THEN p.display_name END,CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort='name_asc' THEN s.name END,s.updated_at DESC,s.id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
 END ELSE BEGIN
  SELECT @total=COUNT(*) FROM #certs WHERE @status='' OR status=@status;
  SELECT @rows=(SELECT c.id,p.display_name AS employee,p.employee_code AS employeeCode,c.name,c.issuer,c.category,c.status,CASE WHEN c.expiry_date IS NULL THEN 'NO_EXPIRY' WHEN c.expiry_date<@today THEN 'EXPIRED' ELSE 'CURRENT' END AS validity,c.issue_date AS issued,c.expiry_date AS expiry,c.submitted_at AS submittedAt,c.reviewed_at AS reviewedAt FROM #certs c JOIN #people p ON p.person_id=c.person_id WHERE @status='' OR c.status=@status ORDER BY CASE WHEN @sort='employee_asc' THEN p.display_name END,CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort='name_asc' THEN c.name END,CASE WHEN @sort='expiry_asc' THEN COALESCE(c.expiry_date,'9999-12-31') END,c.updated_at DESC,c.id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
 END;
 IF @export=1 AND @total>50000 THROW 51000,'Export exceeds 50000 rows. Narrow the filters.',1;
 SELECT (SELECT JSON_QUERY((SELECT @revision AS revision,@actor_id AS actorId,@asof AS asOf,CAST(1 AS bit) AS canView,CONVERT(bit,CASE WHEN dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=0 THEN 1 ELSE 0 END) AS canExport,CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'users.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'audit.view',0)=1 THEN 1 ELSE 0 END) AS canManage,dbo.BusinessAmendCan(@account_id,@actor_id) AS canAmend,w.personal_baseline_enabled AS personalBaseline,JSON_QUERY(@scopeSnapshot) AS scopes FROM dbo.AccessWorkspace w WHERE w.account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) AS context,
 JSON_QUERY((SELECT (SELECT COUNT(*) FROM #people) AS employees,(SELECT COUNT(DISTINCT person_id) FROM #certs WHERE status='APPROVED' AND issue_date<=@today AND (expiry_date IS NULL OR expiry_date>=@today)) AS certified,(SELECT COUNT(DISTINCT person_id) FROM #skills WHERE status='APPROVED') AS skilled,(SELECT COUNT(*) FROM #skills WHERE status='SUBMITTED')+(SELECT COUNT(*) FROM #certs WHERE status='SUBMITTED') AS pending,(SELECT COUNT(*) FROM #certs WHERE expiry_date<@today) AS expired,(SELECT COUNT(*) FROM #certs WHERE expiry_date BETWEEN @today AND DATEADD(day,30,@today)) AS expiring FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) AS summary,
 JSON_QUERY((SELECT skill_id AS id,name AS label,rank,COUNT(DISTINCT person_id) AS holders FROM #skills WHERE status='APPROVED' AND skill_id IN(SELECT TOP(10) skill_id FROM #skills WHERE status='APPROVED' GROUP BY skill_id ORDER BY COUNT(DISTINCT person_id) DESC,skill_id) GROUP BY skill_id,name,rank ORDER BY name,rank FOR JSON PATH)) AS coverage,
 JSON_QUERY((SELECT TOP(15) issuer AS label,COUNT(*) AS value FROM #certs WHERE status='APPROVED' GROUP BY issuer ORDER BY value DESC,issuer FOR JSON PATH)) AS distribution,
 JSON_QUERY((SELECT TOP(15) category AS label,COUNT(*) AS value FROM #certs WHERE status='APPROVED' GROUP BY category ORDER BY value DESC,category FOR JSON PATH)) AS categories,
 JSON_QUERY((SELECT TOP(30) g.id,g.scope_kind AS kind,COALESCE(project.name,node.display_name,N'Organization') AS label,counts.employees,counts.certified,counts.skilled FROM dbo.BusinessResponsibility g LEFT JOIN dbo.BusinessProject project ON project.account_id=g.account_id AND project.id=g.scope_id AND g.scope_kind='PROJECT' LEFT JOIN dbo.AccessOrgNode node ON node.account_id=g.account_id AND node.node_id=g.scope_id AND g.scope_kind IN('DELIVERY_UNIT','DEPARTMENT') CROSS APPLY (SELECT COUNT(*) AS employees,ISNULL(SUM(holding.certified),0) AS certified,ISNULL(SUM(holding.skilled),0) AS skilled FROM #people p JOIN dbo.BusinessScopePeople(@account_id,g.scope_kind,g.scope_id) members ON members.person_id=p.person_id CROSS APPLY(SELECT CASE WHEN EXISTS(SELECT 1 FROM #certs c WHERE c.person_id=p.person_id AND c.status='APPROVED' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today)) THEN 1 ELSE 0 END AS certified,CASE WHEN EXISTS(SELECT 1 FROM #skills s WHERE s.person_id=p.person_id AND s.status='APPROVED') THEN 1 ELSE 0 END AS skilled) holding) counts WHERE g.account_id=@account_id AND g.person_id=@actor_id AND g.active=1 AND g.effect='ALLOW' AND (g.valid_until IS NULL OR g.valid_until>@asof) AND dbo.BusinessResponsibilityUsable(@account_id,@actor_id,g.id)=1 ORDER BY label,g.id FOR JSON PATH)) AS comparisons,
 JSON_QUERY((SELECT CASE WHEN expiry_date<@today THEN 'Expired' WHEN expiry_date IS NULL THEN 'No expiry' WHEN expiry_date<=DATEADD(day,14,@today) THEN '14 days' WHEN expiry_date<=DATEADD(day,30,@today) THEN '30 days' WHEN expiry_date<=DATEADD(day,60,@today) THEN '60 days' WHEN expiry_date<=DATEADD(day,90,@today) THEN '90 days' ELSE 'Later' END AS label,COUNT(*) AS value FROM #certs GROUP BY CASE WHEN expiry_date<@today THEN 'Expired' WHEN expiry_date IS NULL THEN 'No expiry' WHEN expiry_date<=DATEADD(day,14,@today) THEN '14 days' WHEN expiry_date<=DATEADD(day,30,@today) THEN '30 days' WHEN expiry_date<=DATEADD(day,60,@today) THEN '60 days' WHEN expiry_date<=DATEADD(day,90,@today) THEN '90 days' ELSE 'Later' END FOR JSON PATH)) AS expiry,
 JSON_QUERY((SELECT CONVERT(char(7),at,126) AS label,SUM(submission) AS submissions,SUM(decision) AS decisions FROM (SELECT submitted_at AS at,1 AS submission,0 AS decision FROM #skills WHERE submitted_at IS NOT NULL UNION ALL SELECT reviewed_at,0,1 FROM #skills WHERE reviewed_at IS NOT NULL UNION ALL SELECT submitted_at,1,0 FROM #certs WHERE submitted_at IS NOT NULL UNION ALL SELECT reviewed_at,0,1 FROM #certs WHERE reviewed_at IS NOT NULL) e WHERE (@from IS NULL OR at>=@from) AND (@to IS NULL OR at<DATEADD(day,1,@to)) GROUP BY CONVERT(char(7),at,126) ORDER BY label FOR JSON PATH)) AS activity,
 JSON_QUERY(@rows) AS rows,@total AS total,@page AS page,@size AS pageSize FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.BusinessContext TO [skill_management_runtime];
GRANT EXECUTE ON dbo.BusinessAdministration TO [skill_management_runtime];
GRANT EXECUTE ON dbo.SaveBusinessChange TO [skill_management_runtime];
GRANT EXECUTE ON dbo.BusinessDashboard TO [skill_management_runtime];
GO
CREATE OR ALTER FUNCTION dbo.AccessCan(@account uniqueidentifier,@person uniqueidentifier,@permission varchar(100),@own bit)
RETURNS bit AS
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson p JOIN dbo.Account a ON a.account_id=p.account_id
 WHERE p.account_id=@account AND p.person_id=@person AND p.active=1 AND a.status='ACTIVE') RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessImplementedScope WHERE permission_code=@permission) RETURN 0;
 IF @permission IN ('skill.verify','learning.recommend') AND @own=0 AND dbo.AccessReportingValid(@account,@person)=0 RETURN 0;
 IF @permission IN ('skill.verify','learning.recommend') AND @own=0 AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=@account AND o.manager_id=@person AND o.person_id<>@person AND dbo.AccessReportingValid(@account,o.person_id)=1) RETURN 0;
 DECLARE @permissions TABLE(effect varchar(5));
 INSERT @permissions SELECT p.effect FROM dbo.AccountRolePermission p
 JOIN dbo.AccessPersonRole r ON r.account_id=p.account_id AND r.role_id=p.role_id
 WHERE r.account_id=@account AND r.person_id=@person AND p.permission_code=@permission
 AND (p.scope_kind='ORGANIZATION' OR (@own=1 AND p.scope_kind='OWN'))
 AND (p.valid_until IS NULL OR SYSUTCDATETIME()<p.valid_until)
 UNION ALL SELECT effect FROM dbo.AccessPersonOverride WHERE account_id=@account AND person_id=@person
 AND permission_code=@permission AND (scope_kind='ORGANIZATION' OR (@own=1 AND scope_kind='OWN'))
 AND (valid_until IS NULL OR SYSUTCDATETIME()<valid_until);
 IF @permission IN('permissions.manage','users.manage','audit.view','skill.catalogue.manage') AND EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account AND person_id=@person AND bundle='SYSTEM_ADMIN' AND active=1 AND effect='DENY' AND valid_until>SYSUTCDATETIME()) RETURN 0;
 IF EXISTS(SELECT 1 FROM @permissions WHERE effect='DENY') RETURN 0;
 IF @permission IN('permissions.manage','users.manage','audit.view','skill.catalogue.manage') AND dbo.BusinessSystemAdmin(@account,@person)=1 RETURN 1;
 IF EXISTS(SELECT 1 FROM dbo.AccessWorkspace WHERE account_id=@account AND personal_baseline_enabled=1) AND
 ((@own=1 AND @permission IN('profile.view','skill.view','skill.claim','learning.view','learning.manage','request.view','request.create','request.assign','request.resolve','incident.view','incident.create','incident.assign','incident.resolve')) OR (@own=0 AND @permission='skill.view')) RETURN 1;
 IF EXISTS(SELECT 1 FROM @permissions WHERE effect='ALLOW') RETURN 1;
 IF @permission IN ('skill.verify','learning.recommend') AND @own=0 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=@account AND o.manager_id=@person AND o.person_id<>@person AND dbo.AccessReportingValid(@account,o.person_id)=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ReadAccessWorkspace @account_id uniqueidentifier,@include_audit bit=1,@audit_person_id uniqueidentifier=NULL AS
BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessWorkspace w JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE') THROW 51004,'Workspace unavailable.',1;
 SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 SELECT revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 SELECT role_id AS id,display_name AS name FROM dbo.AccountRole WHERE account_id=@account_id ORDER BY display_name;
 SELECT role_id AS roleId,permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil FROM dbo.AccountRolePermission WHERE account_id=@account_id;
 SELECT p.person_id AS id,p.display_name AS displayName,p.employee_code AS employeeCode,p.job_title AS jobTitle,p.grade,
 p.primary_capability_id AS primaryCapabilityId,c.display_name AS primaryCapabilityName,c.status AS primaryCapabilityStatus,p.active,p.entra_object_id AS entraObjectId,dbo.BusinessProjection(p.account_id,p.person_id) AS businessJson,
 CONVERT(bit,CASE WHEN p.active=1 AND dbo.AccessReportingValid(p.account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=p.account_id AND o.manager_id=p.person_id AND o.person_id<>p.person_id AND dbo.AccessReportingValid(p.account_id,o.person_id)=1) THEN 1 ELSE 0 END) AS hasDirectReports
 FROM dbo.AccessPerson p LEFT JOIN dbo.SkillCatalogue c ON c.account_id=p.account_id AND c.skill_id=p.primary_capability_id WHERE p.account_id=@account_id ORDER BY p.employee_code;
 SELECT person_id AS personId,role_id AS roleId FROM dbo.AccessPersonRole WHERE account_id=@account_id;
 SELECT person_id AS personId,permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil,reason FROM dbo.AccessPersonOverride WHERE account_id=@account_id;
 SELECT actor_id AS actorId,action,target_id AS targetId,occurred_at AS at,revision,before_json AS [before],after_json AS [after] FROM dbo.AccessAudit WHERE account_id=@account_id AND @include_audit=1 AND (@audit_person_id IS NULL OR (target_id=@audit_person_id AND action='person.updated')) ORDER BY revision;
 SELECT person_id AS personId,manager_id AS managerId FROM dbo.AccessOrgAssignment WHERE account_id=@account_id;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;
 END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ReadActorAccessContext
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@include_notifications bit=0 AS
BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessWorkspace w WITH(HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE') THROW 51004,'Workspace unavailable.',1;
 SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account_id;
 SELECT r.role_id AS id,r.display_name AS name FROM dbo.AccountRole r JOIN dbo.AccessPersonRole pr ON pr.account_id=r.account_id AND pr.role_id=r.role_id WHERE r.account_id=@account_id AND pr.person_id=@actor_id ORDER BY r.display_name;
 SELECT p.role_id AS roleId,p.permission_code AS permission,p.scope_kind AS scope,effect,p.valid_until AS validUntil FROM dbo.AccountRolePermission p JOIN dbo.AccessPersonRole pr ON pr.account_id=p.account_id AND pr.role_id=p.role_id WHERE p.account_id=@account_id AND pr.person_id=@actor_id;
 SELECT p.person_id AS id,p.display_name AS displayName,p.employee_code AS employeeCode,p.job_title AS jobTitle,p.grade,
 p.primary_capability_id AS primaryCapabilityId,c.display_name AS primaryCapabilityName,c.status AS primaryCapabilityStatus,p.active,p.entra_object_id AS entraObjectId,dbo.BusinessProjection(p.account_id,p.person_id) AS businessJson,
 CONVERT(bit,CASE WHEN p.active=1 AND dbo.AccessReportingValid(p.account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=p.account_id AND o.manager_id=p.person_id AND o.person_id<>p.person_id AND dbo.AccessReportingValid(p.account_id,o.person_id)=1) THEN 1 ELSE 0 END) AS hasDirectReports
 FROM dbo.AccessPerson p LEFT JOIN dbo.SkillCatalogue c ON c.account_id=p.account_id AND c.skill_id=p.primary_capability_id WHERE p.account_id=@account_id AND p.person_id=@actor_id;
 SELECT person_id AS personId,role_id AS roleId FROM dbo.AccessPersonRole WHERE account_id=@account_id AND person_id=@actor_id;
 SELECT person_id AS personId,permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil,reason FROM dbo.AccessPersonOverride WHERE account_id=@account_id AND person_id=@actor_id;
 SELECT TOP(30) actor_id AS actorId,action,target_id AS targetId,occurred_at AS at,revision,before_json AS [before],after_json AS [after] FROM dbo.AccessAudit WHERE account_id=@account_id AND @include_notifications=1 AND target_id=@actor_id AND action='person.updated' ORDER BY revision DESC;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;
 END CATCH;
END;
GO
