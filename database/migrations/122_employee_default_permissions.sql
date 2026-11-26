-- Customize only the existing default Employee grants. NULL preserves the shipped bundle.
IF COL_LENGTH(N'dbo.AccessWorkspace', N'employee_permissions') IS NULL
 ALTER TABLE dbo.AccessWorkspace ADD employee_permissions nvarchar(max) NULL;
GO

CREATE OR ALTER FUNCTION dbo.DefaultEmployeePermissions() RETURNS nvarchar(512) AS
BEGIN
 RETURN N'["profile.view","skill.view","skill.claim","learning.view","learning.manage","request.view","request.create","request.assign","request.resolve","incident.view","incident.create","incident.assign","incident.resolve"]';
END;
GO

CREATE OR ALTER FUNCTION dbo.AccessCan(@account uniqueidentifier,@person uniqueidentifier,@permission varchar(100),@own bit)
RETURNS bit AS
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson p JOIN dbo.Account a ON a.account_id=p.account_id
 WHERE p.account_id=@account AND p.person_id=@person AND p.active=1 AND a.status='ACTIVE') RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessImplementedScope WHERE permission_code=@permission) RETURN 0;
 -- Existing record permissions continue to apply within the configured audience.
 IF @permission IN ('request.view','request.create','request.assign','request.resolve',
  'incident.view','incident.create','incident.assign','incident.resolve')
 BEGIN
  IF dbo.TemplateFeatureAllowed(@account,@person,'requests')=0 RETURN 0;
 END;
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
 IF (@own=1 OR @permission='skill.view') AND EXISTS (
  SELECT 1 FROM dbo.AccessWorkspace w
  CROSS APPLY OPENJSON(COALESCE(w.employee_permissions,dbo.DefaultEmployeePermissions())) permission
  WHERE w.account_id=@account AND w.personal_baseline_enabled=1 AND permission.value=@permission
 ) RETURN 1;
 IF EXISTS(SELECT 1 FROM @permissions WHERE effect='ALLOW') RETURN 1;
 IF @permission IN ('skill.verify','learning.recommend') AND @own=0 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=@account AND o.manager_id=@person AND o.person_id<>@person AND dbo.AccessReportingValid(@account,o.person_id)=1) RETURN 1;
 RETURN 0;
END;
GO

CREATE OR ALTER FUNCTION dbo.BusinessProjection(@account uniqueidentifier,@actor uniqueidentifier) RETURNS nvarchar(max) AS BEGIN
 DECLARE @result nvarchar(max);
 SELECT @result=(SELECT w.personal_baseline_enabled AS personalBaseline,
 JSON_QUERY(COALESCE(w.employee_permissions,dbo.DefaultEmployeePermissions())) AS employeePermissions,
 dbo.TemplateFeatureAllowed(@account,@actor,'learning') AS learningEnabled,
 dbo.TemplateFeatureAllowed(@account,@actor,'requests') AS requestsEnabled,dbo.BusinessHasAccess(@account,@actor) AS [view],
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
 JSON_QUERY((SELECT g.id,g.bundle,g.scope_kind AS kind,g.scope_id AS scopeId,COALESCE(p.name,n.display_name,N'Organization') AS label,g.effect,g.valid_until AS validUntil,g.reason FROM dbo.BusinessResponsibility g LEFT JOIN dbo.BusinessProject p ON g.scope_kind='PROJECT' AND p.account_id=g.account_id AND p.id=g.scope_id LEFT JOIN dbo.AccessOrgNode n ON g.scope_kind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT') AND n.account_id=g.account_id AND n.node_id=g.scope_id WHERE g.account_id=@account AND g.person_id=@actor AND g.active=1 AND (g.valid_until IS NULL OR g.valid_until>SYSUTCDATETIME()) AND dbo.BusinessScopeValid(@account,g.scope_kind,g.scope_id)=1 AND (g.effect='DENY' OR dbo.BusinessResponsibilityUsable(@account,@actor,g.id)=1) FOR JSON PATH,INCLUDE_NULL_VALUES)) AS scopes FROM dbo.AccessWorkspace w WHERE w.account_id=@account FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 RETURN @result;
END;
GO

CREATE OR ALTER PROCEDURE dbo.BusinessAdministration @account_id uniqueidentifier,@actor_id uniqueidentifier,@person_id uniqueidentifier=NULL AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'audit.view',0)<>1 THROW 51003,'Administration denied.',1;
 IF @person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@person_id) THROW 51004,'Person unavailable.',1;
 SELECT (SELECT @revision AS revision,w.personal_baseline_enabled AS personalBaseline,
 JSON_QUERY(COALESCE(w.employee_permissions,dbo.DefaultEmployeePermissions())) AS employeePermissions,
 (SELECT COUNT(*) FROM dbo.AccessPerson WHERE account_id=@account_id AND active=1) AS baselineAffectedPeople,
 JSON_QUERY(COALESCE((SELECT f.template,f.learning_enabled AS learning,f.requests_enabled AS requests FROM dbo.AccessTemplateFeature f WHERE f.account_id=@account_id ORDER BY f.template FOR JSON PATH),N'[]')) AS templateFeatures,
 JSON_QUERY((SELECT id,name,department_id AS departmentId,active FROM dbo.BusinessProject WHERE account_id=@account_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS projects,
 JSON_QUERY((SELECT project_id AS projectId,person_id AS personId,active FROM dbo.BusinessProjectMember WHERE account_id=@account_id AND (@person_id IS NULL OR person_id=@person_id) FOR JSON PATH)) AS memberships,
 JSON_QUERY((SELECT r.id,r.person_id AS personId,r.bundle,r.scope_kind AS kind,r.scope_id AS scopeId,r.effect,r.active,r.valid_until AS validUntil,r.reason,JSON_QUERY(s.issuer_ids) AS issuerIds FROM dbo.BusinessResponsibility r LEFT JOIN dbo.BusinessResponsibilityIssuerScope s ON s.account_id=r.account_id AND s.responsibility_id=r.id WHERE r.account_id=@account_id AND (@person_id IS NULL OR r.person_id=@person_id) FOR JSON PATH,INCLUDE_NULL_VALUES)) AS responsibilities,
 JSON_QUERY((SELECT p.person_id AS id,p.display_name AS name,p.employee_code AS employeeCode,p.active,
 dbo.AccessCan(p.account_id,p.person_id,'profile.view',1) AS employeeAccess,
 CONVERT(bit,CASE WHEN dbo.AccessReportingValid(p.account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment report JOIN dbo.AccessPerson member ON member.account_id=report.account_id AND member.person_id=report.person_id AND member.active=1 WHERE report.account_id=p.account_id AND report.manager_id=p.person_id AND report.person_id<>p.person_id AND dbo.AccessReportingValid(report.account_id,report.person_id)=1) THEN 1 ELSE 0 END) AS hasDirectReports,
 CONVERT(bit,CASE WHEN dbo.AccessCan(p.account_id,p.person_id,'profile.view',1)=1 AND dbo.AccessCan(p.account_id,p.person_id,'skill.verify',0)=1 AND dbo.AccessReportingValid(p.account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment report JOIN dbo.AccessPerson member ON member.account_id=report.account_id AND member.person_id=report.person_id AND member.active=1 WHERE report.account_id=p.account_id AND report.manager_id=p.person_id AND report.person_id<>p.person_id AND dbo.AccessReportingValid(report.account_id,report.person_id)=1) THEN 1 ELSE 0 END) AS managerAccess,
 CONVERT(bit,CASE WHEN dbo.AccessCan(p.account_id,p.person_id,'profile.view',1)=1 AND dbo.BusinessHasAccess(p.account_id,p.person_id)=1 THEN 1 ELSE 0 END) AS analyticsAccess,
 dbo.CapabilityLeadHasGrants(p.account_id,p.person_id) AS issuerAnalyticsAccess,
 CONVERT(bit,CASE WHEN dbo.AccessCan(p.account_id,p.person_id,'profile.view',1)=1 AND dbo.AccessCan(p.account_id,p.person_id,'permissions.manage',0)=1 AND dbo.AccessCan(p.account_id,p.person_id,'users.manage',0)=1 AND dbo.AccessCan(p.account_id,p.person_id,'audit.view',0)=1 THEN 1 ELSE 0 END) AS adminAccess
 FROM dbo.AccessPerson p WHERE p.account_id=@account_id AND (@person_id IS NULL OR p.person_id=@person_id) ORDER BY p.employee_code FOR JSON PATH)) AS people,
 JSON_QUERY((SELECT id,name FROM dbo.CredentialProvider WHERE account_id=@account_id AND active=1 ORDER BY name,id FOR JSON PATH)) AS issuers,
 JSON_QUERY((SELECT node_id AS id,kind,display_name AS name,parent_id AS parentId,active,dbo.BusinessScopeValid(@account_id,kind,node_id) AS scopeValid FROM dbo.AccessOrgNode WHERE account_id=@account_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS nodes,
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
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>24000 OR @id IS NULL OR NULLIF(LTRIM(RTRIM(JSON_VALUE(@payload,'$.reason'))),'') IS NULL THROW 51000,'Explain a valid change.',1;
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
  IF @active IS NULL OR @scopeKind IS NULL OR @scopeKind NOT IN('ORGANIZATION','DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','PROJECT') OR @bundle IS NULL OR @bundle NOT IN('SYSTEM_ADMIN','BUSINESS_OPERATIONS') OR @effect IS NULL OR @effect NOT IN('ALLOW','DENY') OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@person AND (@active=0 OR active=1)) THROW 51000,'Invalid responsibility.',1;
  IF @bundle='SYSTEM_ADMIN' AND @scopeKind<>'ORGANIZATION' OR @scopeKind='ORGANIZATION' AND @scope IS NOT NULL OR @scopeKind<>'ORGANIZATION' AND @scope IS NULL THROW 51000,'Invalid scope binding.',1;
  IF JSON_VALUE(@payload,'$.validUntil') IS NOT NULL AND (@until IS NULL OR @active=1 AND @until<=SYSUTCDATETIME()) OR @effect='DENY' AND @until IS NULL THROW 51000,'Exception needs future expiry.',1;
  IF @scopeKind='PROJECT' AND NOT EXISTS(SELECT 1 FROM dbo.BusinessProject WHERE account_id=@account_id AND id=@scope AND (@active=0 OR active=1)) OR @scopeKind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT') AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@scope AND kind=@scopeKind AND (@active=0 OR active=1)) THROW 51000,'Choose an active scope in this account.',1;
  IF @active=1 AND dbo.BusinessScopeValid(@account_id,@scopeKind,@scope)<>1 THROW 51000,'Choose a complete active hierarchy scope.',1;
  DECLARE @issuerIds nvarchar(max)=JSON_QUERY(@payload,'$.issuerIds'),@coveragePresent bit=0;
  IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='issuerIds') SET @coveragePresent=1;
  IF @coveragePresent=1 AND (@bundle<>'BUSINESS_OPERATIONS' OR @issuerIds IS NULL OR LEFT(@issuerIds,1)<>N'['
   OR (SELECT COUNT(*) FROM OPENJSON(@issuerIds))>200
   OR EXISTS(SELECT 1 FROM OPENJSON(@issuerIds) i WHERE i.type<>1 OR LEN(i.value)<>36 OR TRY_CONVERT(uniqueidentifier,i.value) IS NULL
    OR (@active=1 AND NOT EXISTS(SELECT 1 FROM dbo.CredentialProvider p WHERE p.account_id=@account_id AND p.id=TRY_CONVERT(uniqueidentifier,i.value) AND p.active=1)))
   OR EXISTS(SELECT 1 FROM OPENJSON(@issuerIds) GROUP BY TRY_CONVERT(uniqueidentifier,value) HAVING COUNT(*)>1))
    THROW 51000,'Choose valid issuers from this account.',1;
  IF @bundle='SYSTEM_ADMIN' AND EXISTS(SELECT 1 FROM dbo.BusinessResponsibilityIssuerScope WHERE account_id=@account_id AND responsibility_id=@id)
   THROW 51000,'Remove issuer restrictions before changing the responsibility.',1;
  SELECT @before=(SELECT r.*,JSON_QUERY(s.issuer_ids) AS issuerIds FROM dbo.BusinessResponsibility r
   LEFT JOIN dbo.BusinessResponsibilityIssuerScope s ON s.account_id=r.account_id AND s.responsibility_id=r.id
   WHERE r.account_id=@account_id AND r.id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND id=@id) UPDATE dbo.BusinessResponsibility SET person_id=@person,bundle=@bundle,scope_kind=@scopeKind,scope_id=@scope,effect=@effect,active=@active,valid_until=@until,reason=@reason WHERE account_id=@account_id AND id=@id;
  ELSE INSERT dbo.BusinessResponsibility VALUES(@account_id,@id,@person,@bundle,@scopeKind,@scope,@effect,@active,@until,@reason);
  IF @coveragePresent=1 BEGIN
   DELETE dbo.BusinessResponsibilityIssuerScope WHERE account_id=@account_id AND responsibility_id=@id;
   IF EXISTS(SELECT 1 FROM OPENJSON(@issuerIds))
    INSERT dbo.BusinessResponsibilityIssuerScope(account_id,responsibility_id,issuer_ids) VALUES(@account_id,@id,@issuerIds);
  END;
 END ELSE IF @kind='TEMPLATE_FEATURES' BEGIN
  DECLARE @template varchar(50)=JSON_VALUE(@payload,'$.template'),
   @learning bit=TRY_CONVERT(bit,JSON_VALUE(@payload,'$.learning')),
   @requests bit=TRY_CONVERT(bit,JSON_VALUE(@payload,'$.requests'));
  IF @template IS NULL OR @template NOT IN ('EMPLOYEE','BUSINESS_OPERATIONS','SYSTEM_ADMIN')
   OR (SELECT COUNT(*) FROM OPENJSON(@payload) WHERE [key] IN ('learning','requests') AND [type]=3)<>2
   OR @learning IS NULL OR @requests IS NULL
   THROW 51000,'Choose a supported template and both module settings.',1;
  SELECT @before=(SELECT @template AS template,COALESCE(f.learning_enabled,0) AS learning,
   COALESCE(f.requests_enabled,0) AS requests
   FROM (SELECT @account_id AS account_id) w LEFT JOIN dbo.AccessTemplateFeature f
    ON f.account_id=w.account_id AND f.template=@template FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  UPDATE dbo.AccessTemplateFeature SET learning_enabled=@learning, requests_enabled=@requests
   WHERE account_id=@account_id AND template=@template;
  IF @@ROWCOUNT=0 INSERT dbo.AccessTemplateFeature (account_id,template,learning_enabled,requests_enabled)
   VALUES (@account_id,@template,@learning,@requests);
 END ELSE IF @kind='PERSONAL_BASELINE' BEGIN
  DECLARE @enabled bit=TRY_CONVERT(bit,JSON_VALUE(@payload,'$.enabled'));IF @enabled IS NULL THROW 51000,'Choose baseline state.',1;
  DECLARE @employeePermissions nvarchar(max)=JSON_QUERY(@payload,'$.employeePermissions');
  IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='employeePermissions') BEGIN
   IF @employeePermissions IS NULL OR LEFT(LTRIM(@employeePermissions),1)<>'['
    OR NOT EXISTS(SELECT 1 FROM OPENJSON(@employeePermissions) WHERE [type]=1 AND value COLLATE Latin1_General_100_BIN2=N'profile.view' AND DATALENGTH(value)=DATALENGTH(N'profile.view'))
    OR EXISTS(
     SELECT 1 FROM OPENJSON(@employeePermissions) selected
     WHERE selected.[type]<>1 OR NOT EXISTS(
      SELECT 1 FROM OPENJSON(dbo.DefaultEmployeePermissions()) allowed
      WHERE selected.value COLLATE Latin1_General_100_BIN2=allowed.value COLLATE Latin1_General_100_BIN2
       AND DATALENGTH(selected.value)=DATALENGTH(allowed.value)
     )
    )
    OR EXISTS(SELECT 1 FROM OPENJSON(@employeePermissions) GROUP BY value HAVING COUNT(*)>1)
     THROW 51000,'Choose supported employee permissions and keep View own profile.',1;
  END;
  SELECT @before=(SELECT personal_baseline_enabled AS enabled,
   JSON_QUERY(COALESCE(employee_permissions,dbo.DefaultEmployeePermissions())) AS employeePermissions
   FROM dbo.AccessWorkspace WHERE account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  UPDATE dbo.AccessWorkspace SET personal_baseline_enabled=@enabled,
   employee_permissions=COALESCE(@employeePermissions,employee_permissions) WHERE account_id=@account_id;
  IF @employeePermissions IS NULL SET @payload=JSON_MODIFY(@payload,'$.employeePermissions',JSON_QUERY(@before,'$.employeePermissions'));
 END ELSE THROW 51000,'Unsupported change.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND dbo.AccessCan(@account_id,person_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,person_id,'users.manage',0)=1 AND dbo.AccessCan(@account_id,person_id,'audit.view',0)=1 AND dbo.AccessCan(@account_id,person_id,'profile.view',1)=1) THROW 51000,'Keep at least one active access administrator.',1;
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,target_id,action,occurred_at,before_json,after_json) VALUES(@account_id,@revision+1,@actor_id,@id,'business.'+LOWER(@kind),SYSUTCDATETIME(),@before,@payload);
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
