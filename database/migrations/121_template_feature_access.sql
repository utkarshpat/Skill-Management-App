-- Template audiences control module availability independently of record permissions.
IF OBJECT_ID(N'dbo.AccessTemplateFeature', N'U') IS NULL
BEGIN
 CREATE TABLE dbo.AccessTemplateFeature (
  account_id uniqueidentifier NOT NULL REFERENCES dbo.AccessWorkspace(account_id),
  template varchar(24) NOT NULL CHECK (template IN ('EMPLOYEE','BUSINESS_OPERATIONS','SYSTEM_ADMIN')),
  learning_enabled bit NOT NULL,
  requests_enabled bit NOT NULL,
  PRIMARY KEY (account_id, template)
 );
END;
GO

CREATE OR ALTER FUNCTION dbo.TemplateFeatureAudience(
 @account uniqueidentifier, @actor uniqueidentifier, @template varchar(24)
) RETURNS bit AS
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM dbo.AccessPerson p JOIN dbo.Account a ON a.account_id=p.account_id
  WHERE p.account_id=@account AND p.person_id=@actor AND p.active=1 AND a.status='ACTIVE'
 ) RETURN 0;
 IF @template='EMPLOYEE' RETURN 1;
 IF dbo.AccessCan(@account,@actor,'profile.view',1)<>1 RETURN 0;
 IF @template='SYSTEM_ADMIN' AND dbo.BusinessSystemAdmin(@account,@actor)=1
  AND dbo.AccessCan(@account,@actor,'permissions.manage',0)=1
  AND dbo.AccessCan(@account,@actor,'users.manage',0)=1
  AND dbo.AccessCan(@account,@actor,'audit.view',0)=1 RETURN 1;
 IF @template='BUSINESS_OPERATIONS' AND dbo.BusinessHasAccess(@account,@actor)=1 AND EXISTS (
  SELECT 1 FROM dbo.BusinessResponsibility r
  WHERE r.account_id=@account AND r.person_id=@actor AND r.bundle='BUSINESS_OPERATIONS'
   AND dbo.BusinessResponsibilityUsable(@account,@actor,r.id)=1
 ) RETURN 1;
 -- An issuer-scoped Business Analytics assignment also belongs to this template.
 IF @template='BUSINESS_OPERATIONS' AND dbo.CapabilityLeadHasGrants(@account,@actor)=1 AND EXISTS (
  SELECT 1 FROM dbo.BusinessResponsibility r
  JOIN dbo.BusinessResponsibilityIssuerScope s ON s.account_id=r.account_id AND s.responsibility_id=r.id
  CROSS APPLY OPENJSON(s.issuer_ids) i
  JOIN dbo.CredentialProvider p ON p.account_id=r.account_id AND p.id=TRY_CONVERT(uniqueidentifier,i.value) AND p.active=1
  WHERE r.account_id=@account AND r.person_id=@actor AND r.bundle='BUSINESS_OPERATIONS'
   AND r.effect='ALLOW' AND r.active=1 AND (r.valid_until IS NULL OR r.valid_until>SYSUTCDATETIME())
   AND dbo.BusinessScopeValid(@account,r.scope_kind,r.scope_id)=1
   AND NOT EXISTS (
    SELECT 1 FROM dbo.BusinessApprovalAssignment d
    WHERE d.account_id=@account AND d.person_id=@actor AND d.effect='DENY' AND d.active=1
     AND dbo.BusinessScopeCovers(@account,d.scope_kind,d.scope_id,r.scope_kind,r.scope_id)=1
     AND (d.all_issuers=1 OR EXISTS (
      SELECT 1 FROM OPENJSON(d.issuer_ids) denied WHERE TRY_CONVERT(uniqueidentifier,denied.value)=p.id
     ))
   )
 ) RETURN 1;
 RETURN 0;
END;
GO

CREATE OR ALTER FUNCTION dbo.TemplateFeatureAllowed(
 @account uniqueidentifier, @actor uniqueidentifier, @feature varchar(12)
) RETURNS bit AS
BEGIN
 IF NOT EXISTS (SELECT 1 FROM dbo.AccessTemplateFeature WHERE account_id=@account) RETURN NULL;
 IF EXISTS (
  SELECT 1 FROM dbo.AccessTemplateFeature f
  WHERE f.account_id=@account AND
   (@feature='learning' AND f.learning_enabled=1 OR @feature='requests' AND f.requests_enabled=1)
   AND dbo.TemplateFeatureAudience(@account,@actor,f.template)=1
 ) RETURN 1;
 RETURN 0;
END;
GO

CREATE OR ALTER FUNCTION dbo.BusinessProjection(@account uniqueidentifier,@actor uniqueidentifier) RETURNS nvarchar(max) AS BEGIN
 DECLARE @result nvarchar(max);
 SELECT @result=(SELECT w.personal_baseline_enabled AS personalBaseline,
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
 IF EXISTS(SELECT 1 FROM dbo.AccessWorkspace WHERE account_id=@account AND personal_baseline_enabled=1) AND
 ((@own=1 AND @permission IN('profile.view','skill.view','skill.claim','learning.view','learning.manage','request.view','request.create','request.assign','request.resolve','incident.view','incident.create','incident.assign','incident.resolve')) OR (@own=0 AND @permission='skill.view')) RETURN 1;
 IF EXISTS(SELECT 1 FROM @permissions WHERE effect='ALLOW') RETURN 1;
 IF @permission IN ('skill.verify','learning.recommend') AND @own=0 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=@account AND o.manager_id=@person AND o.person_id<>@person AND dbo.AccessReportingValid(@account,o.person_id)=1) RETURN 1;
 RETURN 0;
END;
GO

CREATE OR ALTER FUNCTION dbo.RecommendationCan(@account uniqueidentifier,@sender uniqueidentifier,@person uniqueidentifier)
RETURNS bit AS BEGIN
 IF dbo.TemplateFeatureAllowed(@account,@sender,'learning')=0 OR dbo.TemplateFeatureAllowed(@account,@person,'learning')=0 RETURN 0;
 IF dbo.AccessCan(@account,@sender,'skill.view',0)<>1 AND dbo.AccessCan(@account,@sender,'skill.catalogue.manage',0)<>1 RETURN 0;
 IF @sender=@person OR dbo.AccessCan(@account,@sender,'profile.view',1)<>1 OR dbo.AccessCan(@account,@sender,'learning.view',1)<>1 OR dbo.AccessCan(@account,@sender,'learning.recommend',0)<>1 RETURN 0;
 IF dbo.AccessReportingValid(@account,@person)<>1 OR NOT EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account AND person_id=@person AND manager_id=@sender) RETURN 0;
 IF dbo.AccessCan(@account,@person,'learning.view',1)<>1 RETURN 0;
 RETURN 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.ReadOwnLearningPlans @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @revision int;
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 THROW 51003,'Learning denied.',1;
 IF dbo.TemplateFeatureAllowed(@account_id,@actor_id,'learning')=0 THROW 51003,'Learning module unavailable.',1;
 SELECT CONVERT(bit,dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)) AS canManage;
 SELECT plan_id AS id,revision,status,payload FROM dbo.LearningPlan WHERE account_id=@account_id AND person_id=@actor_id ORDER BY updated_at DESC,plan_id;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.ChangeOwnLearningPlan
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@plan_id uniqueidentifier,@expected_revision int,@action varchar(20),@payload nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace_revision int,@current int,@status varchar(10),@document nvarchar(max),@before nvarchar(max),@after nvarchar(max);
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)<>1 THROW 51003,'Learning denied.',1;
 IF dbo.TemplateFeatureAllowed(@account_id,@actor_id,'learning')=0 THROW 51003,'Learning module unavailable.',1;
 IF @plan_id IS NULL OR @expected_revision IS NULL OR @expected_revision<0 OR ISJSON(@payload)<>1 OR DATALENGTH(@payload)>65536 OR @action IS NULL OR JSON_VALUE(@payload,'$.action') IS NULL OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')) IS NULL OR TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')) IS NULL OR JSON_VALUE(@payload,'$.action')<>@action OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id'))<>@plan_id OR TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision'))<>@expected_revision THROW 51000,'Invalid change.',1;
 SELECT @current=revision,@status=status,@document=payload FROM dbo.LearningPlan WHERE account_id=@account_id AND plan_id=@plan_id AND person_id=@actor_id;
 IF @action='CREATE' BEGIN
  IF @expected_revision<>0 OR @current IS NOT NULL THROW 51009,'Plan exists.',1;
  IF EXISTS(SELECT 1 FROM dbo.LearningPlan WHERE account_id=@account_id AND plan_id=@plan_id) THROW 51004,'Plan unavailable.',1;
  IF (SELECT COUNT(*) FROM dbo.LearningPlan WHERE account_id=@account_id AND person_id=@actor_id)>=50 THROW 51000,'Plan limit reached.',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('action','id','revision','title','goal','timezone','dailyMinutes','targetDate','tasks','focus','skillId')) THROW 51000,'Invalid fields.',1;
  IF NULLIF(LTRIM(RTRIM(JSON_VALUE(@payload,'$.title'))),'') IS NULL OR DATALENGTH(JSON_VALUE(@payload,'$.title'))>320 OR NULLIF(LTRIM(RTRIM(JSON_VALUE(@payload,'$.goal'))),'') IS NULL OR DATALENGTH(JSON_VALUE(@payload,'$.goal'))>4000 OR NULLIF(JSON_VALUE(@payload,'$.timezone'),'') IS NULL OR DATALENGTH(JSON_VALUE(@payload,'$.timezone'))>160 OR ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.dailyMinutes')),0) NOT BETWEEN 5 AND 480 OR TRY_CONVERT(date,JSON_VALUE(@payload,'$.targetDate'),23) IS NULL OR JSON_QUERY(@payload,'$.tasks') IS NULL OR LEFT(LTRIM(JSON_QUERY(@payload,'$.tasks')),1)<>'[' THROW 51000,'Invalid plan.',1;
  DECLARE @tasks TABLE(id uniqueidentifier,title nvarchar(4000),day date,minutes int,raw nvarchar(max));
  INSERT @tasks SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')),JSON_VALUE(value,'$.title'),TRY_CONVERT(date,JSON_VALUE(value,'$.plannedDate'),23),TRY_CONVERT(int,JSON_VALUE(value,'$.estimatedMinutes')),value FROM OPENJSON(@payload,'$.tasks');
  IF (SELECT COUNT(*) FROM @tasks) NOT BETWEEN 1 AND 60 OR EXISTS(SELECT 1 FROM @tasks WHERE id IS NULL OR NULLIF(LTRIM(RTRIM(title)),'') IS NULL OR DATALENGTH(title)>320 OR day IS NULL OR day>TRY_CONVERT(date,JSON_VALUE(@payload,'$.targetDate'),23) OR minutes IS NULL OR minutes NOT BETWEEN 1 AND 480) OR EXISTS(SELECT id FROM @tasks GROUP BY id HAVING COUNT(*)>1) OR EXISTS(SELECT day FROM @tasks GROUP BY day HAVING SUM(minutes)>TRY_CONVERT(int,JSON_VALUE(@payload,'$.dailyMinutes'))) OR EXISTS(SELECT 1 FROM @tasks t CROSS APPLY OPENJSON(t.raw) j WHERE j.[key] NOT IN ('id','title','plannedDate','estimatedMinutes')) THROW 51000,'Invalid tasks.',1;
  DECLARE @skill_id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.skillId')),@skill_name nvarchar(160),@focus nvarchar(100)=JSON_VALUE(@payload,'$.focus');
  IF @focus IS NOT NULL AND @focus NOT IN ('General','Backend','Frontend','Cloud','System Design','Data & AI','Professional') THROW 51000,'Invalid focus.',1;
  IF JSON_VALUE(@payload,'$.skillId') IS NOT NULL BEGIN
   IF @skill_id IS NULL THROW 51000,'Invalid skill.',1;
   IF dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 AND dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0)<>1 THROW 51003,'Catalogue denied.',1;
   SELECT @skill_name=display_name FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@skill_id AND status='PUBLISHED';
   IF @skill_name IS NULL THROW 51004,'Published skill unavailable.',1;
   SET @payload=JSON_MODIFY(@payload,'$.skillName',@skill_name);
  END;
  INSERT dbo.LearningPlan(account_id,plan_id,person_id,revision,status,payload) VALUES(@account_id,@plan_id,@actor_id,1,'ACTIVE',@payload);
 END ELSE BEGIN
  IF @current IS NULL THROW 51004,'Own plan unavailable.',1;
  IF @current<>@expected_revision THROW 51009,'Plan changed.',1;
  IF @status='ARCHIVED' THROW 51010,'Plan archived.',1;
  SET @before=(SELECT plan_id AS id,revision,status FROM dbo.LearningPlan WHERE account_id=@account_id AND plan_id=@plan_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @action IN ('LOG','RESCHEDULE') BEGIN
   IF @status<>'ACTIVE' THROW 51010,'Resume the plan first.',1;
   IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('action','id','revision','taskId','plannedDate','actualMinutes','notes')) THROW 51000,'Invalid fields.',1;
   DECLARE @task_id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.taskId')),@index int,@task nvarchar(max);
   SELECT @index=TRY_CONVERT(int,[key]),@task=value FROM OPENJSON(@document,'$.tasks') WHERE TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id'))=@task_id;
   IF @index IS NULL THROW 51004,'Task unavailable.',1;
   IF JSON_VALUE(@task,'$.completedAt') IS NOT NULL THROW 51010,'Task already completed.',1;
   DECLARE @path nvarchar(100)=N'$.tasks['+CONVERT(nvarchar(10),@index)+N']';
   IF @action='LOG' BEGIN
    DECLARE @minutes int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.actualMinutes')),@notes nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.notes'),N'');
    IF @minutes IS NULL OR @minutes NOT BETWEEN 1 AND 480 OR DATALENGTH(@notes)>4000 THROW 51000,'Invalid activity.',1;
    SET @document=JSON_MODIFY(@document,@path+'.actualMinutes',@minutes);
    SET @document=JSON_MODIFY(@document,@path+'.notes',@notes);
    SET @document=JSON_MODIFY(@document,@path+'.completedAt',CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z');
   END ELSE BEGIN
    DECLARE @day date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.plannedDate'),23),@capacity int=TRY_CONVERT(int,JSON_VALUE(@document,'$.dailyMinutes'));
    IF @day IS NULL OR @day>TRY_CONVERT(date,JSON_VALUE(@document,'$.targetDate'),23) THROW 51000,'Invalid date.',1;
    IF (SELECT ISNULL(SUM(TRY_CONVERT(int,JSON_VALUE(value,'$.estimatedMinutes'))),0) FROM OPENJSON(@document,'$.tasks') WHERE TRY_CONVERT(date,JSON_VALUE(value,'$.plannedDate'),23)=@day AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id'))<>@task_id AND JSON_VALUE(value,'$.completedAt') IS NULL)+TRY_CONVERT(int,JSON_VALUE(@task,'$.estimatedMinutes'))>@capacity THROW 51000,'Daily capacity exceeded.',1;
    SET @document=JSON_MODIFY(@document,@path+'.plannedDate',CONVERT(varchar(10),@day,23));
   END;
  END ELSE IF @action='PAUSE' AND @status='ACTIVE' SET @status='PAUSED';
  ELSE IF @action='RESUME' AND @status='PAUSED' SET @status='ACTIVE';
  ELSE IF @action='ARCHIVE' SET @status='ARCHIVED';
  ELSE THROW 51010,'Invalid transition.',1;
  UPDATE dbo.LearningPlan SET payload=@document,status=@status,revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND plan_id=@plan_id AND person_id=@actor_id;
 END;
 SET @after=(SELECT plan_id AS id,revision,status FROM dbo.LearningPlan WHERE account_id=@account_id AND plan_id=@plan_id AND person_id=@actor_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,'learning.'+LOWER(@action),@plan_id,@before,@after);
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.OwnLearningPractice
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@plan_id uniqueidentifier,@task_id uniqueidentifier,@action varchar(20),@payload nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace_revision int,@document nvarchar(max),@status varchar(10);
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 OR (@action<>'READ' AND dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)<>1) THROW 51003,'Learning denied.',1;
 IF dbo.TemplateFeatureAllowed(@account_id,@actor_id,'learning')=0 THROW 51003,'Learning module unavailable.',1;
 SELECT @document=payload,@status=status FROM dbo.LearningPlan WHERE account_id=@account_id AND plan_id=@plan_id AND person_id=@actor_id;
 IF @document IS NULL OR NOT EXISTS(SELECT 1 FROM OPENJSON(@document,'$.tasks') WHERE TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id'))=@task_id) THROW 51004,'Own task unavailable.',1;
 IF @action='READ' BEGIN
  SELECT revision,payload FROM dbo.LearningSession WHERE account_id=@account_id AND plan_id=@plan_id AND task_id=@task_id AND person_id=@actor_id;
  SELECT quiz_id AS id,title,provider,questions,created_at AS createdAt FROM dbo.LearningQuiz WHERE account_id=@account_id AND plan_id=@plan_id AND task_id=@task_id AND person_id=@actor_id ORDER BY created_at DESC,quiz_id;
  SELECT a.attempt_id AS id,a.quiz_id AS quizId,a.answers,a.score,a.total,a.submitted_at AS submittedAt FROM dbo.LearningAttempt a JOIN dbo.LearningQuiz q ON q.account_id=a.account_id AND q.quiz_id=a.quiz_id WHERE q.account_id=@account_id AND q.plan_id=@plan_id AND q.task_id=@task_id AND q.person_id=@actor_id AND a.person_id=@actor_id ORDER BY a.submitted_at DESC,a.attempt_id;
 END ELSE BEGIN
  IF @status<>'ACTIVE' THROW 51010,'Resume your plan first.',1;
  IF ISJSON(@payload)<>1 OR @payload IS NULL OR DATALENGTH(@payload)>128000 THROW 51000,'Invalid payload.',1;
  DECLARE @target uniqueidentifier=@task_id;
  IF @action='SESSION' BEGIN
   IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('revision','notes','minutes','resources')) OR ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),-1)<0 OR JSON_VALUE(@payload,'$.notes') IS NULL OR DATALENGTH(JSON_VALUE(@payload,'$.notes'))>4000 OR ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.minutes')),-1) NOT BETWEEN 0 AND 480 OR JSON_QUERY(@payload,'$.resources') IS NULL OR LEFT(LTRIM(JSON_QUERY(@payload,'$.resources')),1)<>'[' OR (SELECT COUNT(*) FROM OPENJSON(@payload,'$.resources'))>5 THROW 51000,'Invalid session.',1;
   IF EXISTS(SELECT 1 FROM OPENJSON(@payload,'$.resources') WHERE NULLIF(JSON_VALUE(value,'$.label'),'') IS NULL OR DATALENGTH(JSON_VALUE(value,'$.label'))>240 OR JSON_VALUE(value,'$.url') IS NULL OR JSON_VALUE(value,'$.url') NOT LIKE 'https://%' OR DATALENGTH(JSON_VALUE(value,'$.url'))>2000) OR EXISTS(SELECT 1 FROM OPENJSON(@payload,'$.resources') r CROSS APPLY OPENJSON(r.value) f WHERE f.[key] NOT IN ('label','url')) THROW 51000,'Invalid resource.',1;
   DECLARE @current int;SELECT @current=revision FROM dbo.LearningSession WHERE account_id=@account_id AND plan_id=@plan_id AND task_id=@task_id AND person_id=@actor_id;
   IF ISNULL(@current,0)<>TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')) THROW 51009,'Session changed.',1;
   IF @current IS NULL INSERT dbo.LearningSession(account_id,plan_id,task_id,person_id,revision,payload) VALUES(@account_id,@plan_id,@task_id,@actor_id,1,@payload);
   ELSE UPDATE dbo.LearningSession SET revision=revision+1,payload=@payload,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND plan_id=@plan_id AND task_id=@task_id AND person_id=@actor_id;
  END ELSE IF @action='QUIZ' BEGIN
   DECLARE @quiz_id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),@questions nvarchar(max)=JSON_QUERY(@payload,'$.questions');
   IF @quiz_id IS NULL OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('id','title','provider','questions')) OR NULLIF(JSON_VALUE(@payload,'$.title'),'') IS NULL OR DATALENGTH(JSON_VALUE(@payload,'$.title'))>240 OR NULLIF(JSON_VALUE(@payload,'$.provider'),'') IS NULL OR DATALENGTH(JSON_VALUE(@payload,'$.provider'))>160 OR @questions IS NULL OR LEFT(LTRIM(@questions),1)<>'[' OR (SELECT COUNT(*) FROM OPENJSON(@questions)) NOT BETWEEN 1 AND 20 THROW 51000,'Invalid quiz.',1;
   IF (SELECT COUNT(*) FROM dbo.LearningQuiz WHERE account_id=@account_id AND person_id=@actor_id)>=100 OR (SELECT COUNT(*) FROM dbo.LearningQuiz WHERE account_id=@account_id AND plan_id=@plan_id AND task_id=@task_id AND person_id=@actor_id)>=30 THROW 51010,'Practice limit reached.',1;
   IF EXISTS(SELECT 1 FROM OPENJSON(@questions) WHERE NULLIF(JSON_VALUE(value,'$.prompt'),'') IS NULL OR DATALENGTH(JSON_VALUE(value,'$.prompt'))>1200 OR NULLIF(JSON_VALUE(value,'$.explanation'),'') IS NULL OR DATALENGTH(JSON_VALUE(value,'$.explanation'))>1200 OR ISNULL(TRY_CONVERT(int,JSON_VALUE(value,'$.correctIndex')),-1) NOT BETWEEN 0 AND 3 OR JSON_QUERY(value,'$.options') IS NULL OR LEFT(LTRIM(JSON_QUERY(value,'$.options')),1)<>'[' OR (SELECT COUNT(*) FROM OPENJSON(value,'$.options'))<>4) OR EXISTS(SELECT 1 FROM OPENJSON(@questions) q CROSS APPLY OPENJSON(q.value,'$.options') o WHERE o.type<>1 OR NULLIF(o.value,'') IS NULL OR DATALENGTH(o.value)>600) THROW 51000,'Invalid question.',1;
   INSERT dbo.LearningQuiz(account_id,quiz_id,plan_id,task_id,person_id,title,provider,questions) VALUES(@account_id,@quiz_id,@plan_id,@task_id,@actor_id,JSON_VALUE(@payload,'$.title'),JSON_VALUE(@payload,'$.provider'),@questions);SET @target=@quiz_id;
  END ELSE IF @action='ATTEMPT' BEGIN
   DECLARE @attempt_id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),@answer_quiz uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.quizId')),@answers nvarchar(max)=JSON_QUERY(@payload,'$.answers'),@key nvarchar(max),@score int,@total int;
   IF @attempt_id IS NULL OR @answer_quiz IS NULL OR @answers IS NULL OR LEFT(LTRIM(@answers),1)<>'[' OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('id','quizId','answers')) THROW 51000,'Invalid attempt.',1;
   SELECT @key=questions FROM dbo.LearningQuiz WHERE account_id=@account_id AND quiz_id=@answer_quiz AND person_id=@actor_id AND plan_id=@plan_id AND task_id=@task_id;
   IF @key IS NULL THROW 51004,'Own quiz unavailable.',1;
   SET @total=(SELECT COUNT(*) FROM OPENJSON(@key));
   IF (SELECT COUNT(*) FROM OPENJSON(@answers))<>@total OR EXISTS(SELECT 1 FROM OPENJSON(@answers) WHERE type<>2 OR TRY_CONVERT(int,value) IS NULL OR value<>CONVERT(nvarchar(10),TRY_CONVERT(int,value)) OR TRY_CONVERT(int,value) NOT BETWEEN 0 AND 3) THROW 51000,'Answer all questions.',1;
   IF EXISTS(SELECT 1 FROM dbo.LearningAttempt WHERE account_id=@account_id AND attempt_id=@attempt_id) BEGIN
    IF NOT EXISTS(SELECT 1 FROM dbo.LearningAttempt WHERE account_id=@account_id AND attempt_id=@attempt_id AND person_id=@actor_id AND quiz_id=@answer_quiz AND answers=@answers) THROW 51009,'Attempt already exists.',1;
    COMMIT;RETURN;
   END;
   IF (SELECT COUNT(*) FROM dbo.LearningAttempt WHERE account_id=@account_id AND quiz_id=@answer_quiz AND person_id=@actor_id)>=10 THROW 51010,'Attempt limit reached.',1;
   SELECT @score=COUNT(*) FROM OPENJSON(@key) q JOIN OPENJSON(@answers) a ON a.[key]=q.[key] WHERE TRY_CONVERT(int,a.value)=TRY_CONVERT(int,JSON_VALUE(q.value,'$.correctIndex'));
   INSERT dbo.LearningAttempt(account_id,attempt_id,quiz_id,person_id,answers,score,total) VALUES(@account_id,@attempt_id,@answer_quiz,@actor_id,@answers,@score,@total);SET @target=@attempt_id;
  END ELSE THROW 51000,'Invalid practice action.',1;
  UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
  INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,'learning.'+LOWER(@action),@target,N'{"saved":true}');
 END;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.RecoverOwnLearningPlan
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@plan_id uniqueidentifier,@expected_revision int,@payload nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace_revision int,@revision int,@status varchar(10),@document nvarchar(max),@before nvarchar(max),@after nvarchar(max);
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)<>1 THROW 51003,'Learning denied.',1;
 IF dbo.TemplateFeatureAllowed(@account_id,@actor_id,'learning')=0 THROW 51003,'Learning module unavailable.',1;
 SELECT @revision=revision,@status=status,@document=payload FROM dbo.LearningPlan WHERE account_id=@account_id AND plan_id=@plan_id AND person_id=@actor_id;
 IF @revision IS NULL THROW 51004,'Own plan unavailable.',1;
 IF @expected_revision IS NULL OR @expected_revision<>@revision THROW 51009,'Plan changed.',1;
 IF @status<>'ACTIVE' THROW 51010,'Resume the plan first.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>65536 OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('dailyMinutes','targetDate','startDate','tasks')) OR (SELECT COUNT(*) FROM OPENJSON(@payload))<>4 OR EXISTS(SELECT [key] FROM OPENJSON(@payload) GROUP BY [key] HAVING COUNT(*)>1) THROW 51000,'Invalid recovery.',1;
 DECLARE @daily int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.dailyMinutes')),@target date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.targetDate'),23),@start date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.startDate'),23);
 IF @daily IS NULL OR @daily NOT BETWEEN 5 AND 480 OR NOT EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='dailyMinutes' AND type=2 AND value NOT LIKE '%[.eE]%') OR @target IS NULL OR @start IS NULL OR JSON_VALUE(@payload,'$.targetDate')<>CONVERT(varchar(10),@target,23) OR JSON_VALUE(@payload,'$.startDate')<>CONVERT(varchar(10),@start,23) OR CONVERT(varchar(10),@start,23) NOT LIKE '20%' OR CONVERT(varchar(10),@target,23) NOT LIKE '20%' OR @target<@start OR @start<DATEADD(day,-1,CONVERT(date,SYSUTCDATETIME())) OR JSON_QUERY(@payload,'$.tasks') IS NULL OR LEFT(LTRIM(JSON_QUERY(@payload,'$.tasks')),1)<>'[' THROW 51000,'Invalid recovery dates.',1;
 DECLARE @changes TABLE(id uniqueidentifier,day date,raw nvarchar(max));
 INSERT @changes SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')),TRY_CONVERT(date,JSON_VALUE(value,'$.plannedDate'),23),value FROM OPENJSON(@payload,'$.tasks');
 IF (SELECT COUNT(*) FROM @changes) NOT BETWEEN 1 AND 60 OR EXISTS(SELECT 1 FROM @changes WHERE id IS NULL OR day IS NULL OR day<@start OR day>@target OR JSON_VALUE(raw,'$.plannedDate')<>CONVERT(varchar(10),day,23)) OR EXISTS(SELECT id FROM @changes GROUP BY id HAVING COUNT(*)>1) OR EXISTS(SELECT 1 FROM @changes c CROSS APPLY OPENJSON(c.raw) j WHERE j.[key] NOT IN ('id','plannedDate')) OR EXISTS(SELECT 1 FROM @changes WHERE (SELECT COUNT(*) FROM OPENJSON(raw))<>2) THROW 51000,'Invalid recovery tasks.',1;
 DECLARE @tasks TABLE(idx int,id uniqueidentifier,day date,minutes int,completed bit);
 INSERT @tasks SELECT TRY_CONVERT(int,[key]),TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')),TRY_CONVERT(date,JSON_VALUE(value,'$.plannedDate'),23),TRY_CONVERT(int,JSON_VALUE(value,'$.estimatedMinutes')),CASE WHEN JSON_VALUE(value,'$.completedAt') IS NULL THEN 0 ELSE 1 END FROM OPENJSON(@document,'$.tasks');
 IF EXISTS(SELECT 1 FROM @changes c LEFT JOIN @tasks t ON t.id=c.id WHERE t.id IS NULL OR t.completed=1) OR EXISTS(SELECT 1 FROM @tasks t LEFT JOIN @changes c ON c.id=t.id WHERE t.completed=0 AND c.id IS NULL) THROW 51000,'Every pending task must be included exactly once.',1;
 IF EXISTS(SELECT c.day FROM @changes c JOIN @tasks t ON t.id=c.id GROUP BY c.day HAVING SUM(t.minutes)>@daily) OR EXISTS(SELECT 1 FROM @tasks WHERE completed=1 AND day>@target) OR @target<>(SELECT MAX(day) FROM (SELECT day FROM @changes UNION ALL SELECT day FROM @tasks WHERE completed=1) d) THROW 51000,'Capacity or target exceeded.',1;
 SET @before=(SELECT @plan_id AS id,@revision AS revision,JSON_VALUE(@document,'$.dailyMinutes') AS dailyMinutes,JSON_VALUE(@document,'$.targetDate') AS targetDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @idx int,@newday date,@path nvarchar(100);
 WHILE EXISTS(SELECT 1 FROM @tasks WHERE completed=0) BEGIN
  SELECT TOP 1 @idx=t.idx,@newday=c.day FROM @tasks t JOIN @changes c ON c.id=t.id WHERE t.completed=0 ORDER BY t.idx;
  SET @path=N'$.tasks['+CONVERT(nvarchar(10),@idx)+N'].plannedDate';
  SET @document=JSON_MODIFY(@document,@path,CONVERT(varchar(10),@newday,23));
  DELETE FROM @tasks WHERE idx=@idx;
 END;
 SET @document=JSON_MODIFY(@document,'$.dailyMinutes',@daily);
 SET @document=JSON_MODIFY(@document,'$.targetDate',CONVERT(varchar(10),@target,23));
 UPDATE dbo.LearningPlan SET payload=@document,revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND plan_id=@plan_id AND person_id=@actor_id;
 SET @after=(SELECT @plan_id AS id,@revision+1 AS revision,@daily AS dailyMinutes,CONVERT(varchar(10),@target,23) AS targetDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,'learning.recover',@plan_id,@before,@after);
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.LearningRecommendations @account_id uniqueidentifier,@actor_id uniqueidentifier,@action varchar(20),@payload nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile denied.',1;
 IF dbo.TemplateFeatureAllowed(@account_id,@actor_id,'learning')=0 THROW 51003,'Learning module unavailable.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>65536 THROW 51000,'Invalid input.',1;
 DECLARE @view varchar(10)=ISNULL(JSON_VALUE(@payload,'$.view'),'received'),@search nvarchar(100)=ISNULL(JSON_VALUE(@payload,'$.search'),''),@page int=ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),1),@id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id'));
 IF @action='OPTIONS' BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)<>1 THROW 51003,'Recommendation denied.',1;
  SELECT TOP(25) p.person_id AS id,p.display_name AS name,p.employee_code AS employeeCode FROM dbo.AccessPerson p WHERE p.account_id=@account_id AND dbo.RecommendationCan(@account_id,@actor_id,p.person_id)=1 AND (@search='' OR CHARINDEX(@search,p.display_name)>0 OR CHARINDEX(@search,p.employee_code)>0) ORDER BY p.display_name,p.person_id;RETURN;
 END;
 IF @action='NOTIFICATIONS' BEGIN
  SELECT TOP(30) 'recommendation-'+CONVERT(varchar(36),e.id)+'-'+CONVERT(varchar(10),e.revision) AS id,e.created_at AS at,
  CASE WHEN e.action='SEND' THEN sender.display_name+' recommended '+r.skill_name+' for your development' ELSE recipient.display_name+' responded to your '+r.skill_name+' recommendation' END AS title,
  CASE WHEN e.action='SEND' THEN LEFT(r.reason,240) ELSE CASE e.action WHEN 'ACCEPT' THEN 'Accepted and a personal learning plan was created.' WHEN 'DECLINE' THEN 'Declined. '+LEFT(e.message,200) ELSE 'Discussion requested: '+LEFT(e.message,200) END END AS body,
  CASE WHEN e.action='SEND' THEN '/learning?tab=recommendations&recommendation=' ELSE '/learning?tab=recommendations&direction=sent&recommendation=' END+CONVERT(varchar(36),r.id) AS href
  FROM dbo.LearningRecommendationEvent e JOIN dbo.LearningRecommendation r ON r.account_id=e.account_id AND r.id=e.id
  JOIN dbo.AccessPerson sender ON sender.account_id=r.account_id AND sender.person_id=r.sender_id JOIN dbo.AccessPerson recipient ON recipient.account_id=r.account_id AND recipient.person_id=r.person_id
  WHERE e.account_id=@account_id AND e.person_id=@actor_id AND dbo.RecommendationCan(@account_id,r.sender_id,r.person_id)=1
  AND (r.person_id=@actor_id AND dbo.AccessCan(@account_id,@actor_id,'learning.view',1)=1 OR r.sender_id=@actor_id AND dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)=1)
  ORDER BY e.created_at DESC,e.id,e.revision DESC;RETURN;
 END;
 IF @action='LIST' BEGIN
  IF @view NOT IN('received','sent') OR @page NOT BETWEEN 1 AND 1000 THROW 51000,'Invalid filters.',1;
  IF @view='received' AND dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 OR @view='sent' AND dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)<>1 THROW 51003,'Recommendation denied.',1;
  DECLARE @visible TABLE(id uniqueidentifier PRIMARY KEY);
  INSERT @visible SELECT r.id FROM dbo.LearningRecommendation r WHERE r.account_id=@account_id AND (@id IS NULL OR r.id=@id) AND
  (@view='received' AND r.person_id=@actor_id OR @view='sent' AND r.sender_id=@actor_id AND dbo.RecommendationCan(@account_id,r.sender_id,r.person_id)=1);
  SELECT COUNT(*) AS total,CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'learning.view',1)=1 AND (dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 OR dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0)=1) THEN 1 ELSE 0 END) AS canSend FROM @visible;
  SELECT r.id,r.person_id AS personId,r.sender_id AS senderId,s.display_name AS senderName,p.display_name AS personName,p.employee_code AS employeeCode,
  r.skill_id AS skillId,r.skill_name AS skillName,r.category,r.rank,r.level_name AS levelName,r.reason,r.resource,CONVERT(varchar(10),r.target_date,23) AS targetDate,
  r.status,r.revision,r.response,r.plan_id AS planId,r.created_at AS createdAt,r.updated_at AS updatedAt,
  CONVERT(bit,CASE WHEN r.person_id=@actor_id AND r.status IN('PENDING','DISCUSSION') AND dbo.RecommendationCan(@account_id,r.sender_id,r.person_id)=1 AND dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)=1 THEN 1 ELSE 0 END) AS canRespond
  FROM @visible v JOIN dbo.LearningRecommendation r ON r.account_id=@account_id AND r.id=v.id JOIN dbo.AccessPerson s ON s.account_id=r.account_id AND s.person_id=r.sender_id JOIN dbo.AccessPerson p ON p.account_id=r.account_id AND p.person_id=r.person_id
  ORDER BY r.updated_at DESC,r.id OFFSET (@page-1)*20 ROWS FETCH NEXT 20 ROWS ONLY;RETURN;
 END;
 IF @action NOT IN('SEND','ACCEPT','DECLINE','DISCUSS') THROW 51000,'Invalid action.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace_revision int,@person uniqueidentifier,@sender uniqueidentifier,@skill uniqueidentifier,@rank int,@skill_name nvarchar(100),@category nvarchar(80),@level nvarchar(60),@current int,@status varchar(20),@before nvarchar(max),@after nvarchar(max),@plan uniqueidentifier;
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.TemplateFeatureAllowed(@account_id,@actor_id,'learning')=0 THROW 51003,'Learning module unavailable.',1;
 IF @id IS NULL THROW 51000,'Invalid record.',1;
 IF @action='SEND' BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN('id','personId','skillId','rank','reason','resource','targetDate')) THROW 51000,'Invalid fields.',1;
  SET @person=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.personId'));SET @skill=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.skillId'));SET @rank=TRY_CONVERT(int,JSON_VALUE(@payload,'$.rank'));SET @sender=@actor_id;
  IF @person IS NULL OR dbo.RecommendationCan(@account_id,@sender,@person)<>1 THROW 51003,'Current direct report required.',1;
  IF dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 AND dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0)<>1 THROW 51003,'Catalogue denied.',1;
  SELECT @skill_name=c.display_name,@category=c.category,@level=l.display_name FROM dbo.SkillCatalogue c JOIN dbo.SkillDefinitionVersion v ON v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision JOIN dbo.ProficiencyLevel l ON l.framework_id=v.framework_id AND l.rank=@rank WHERE c.account_id=@account_id AND c.skill_id=@skill AND c.status='PUBLISHED';
  IF @skill_name IS NULL THROW 51004,'Published skill or level unavailable.',1;
  DECLARE @reason nvarchar(4000)=JSON_VALUE(@payload,'$.reason'),@resource nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.resource'),''),@target date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.targetDate'),23);
  IF NULLIF(LTRIM(RTRIM(@reason)),'') IS NULL OR DATALENGTH(@reason)>4000 OR DATALENGTH(@resource)>2000 OR (@resource<>'' AND LEFT(@resource,8)<>'https://') OR (JSON_VALUE(@payload,'$.targetDate') IS NOT NULL AND @target IS NULL) THROW 51000,'Invalid recommendation.',1;
  IF (SELECT COUNT(*) FROM dbo.LearningRecommendation WHERE account_id=@account_id AND sender_id=@sender AND person_id=@person AND status IN('PENDING','DISCUSSION'))>=50 THROW 51000,'Pending recommendation limit reached.',1;
  INSERT dbo.LearningRecommendation(account_id,id,sender_id,person_id,skill_id,skill_name,category,rank,level_name,reason,resource,target_date,status,revision) VALUES(@account_id,@id,@sender,@person,@skill,@skill_name,@category,@rank,@level,@reason,@resource,@target,'PENDING',1);
  INSERT dbo.LearningRecommendationEvent(account_id,id,revision,actor_id,person_id,action,message) VALUES(@account_id,@id,1,@actor_id,@person,'SEND',@reason);
 END ELSE BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN('id','revision','action','message','plan')) OR JSON_VALUE(@payload,'$.action')<>@action THROW 51000,'Invalid fields.',1;
  SELECT @current=revision,@status=status,@person=person_id,@sender=sender_id,@skill=skill_id FROM dbo.LearningRecommendation WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND id=@id AND person_id=@actor_id;
  IF @current IS NULL THROW 51004,'Own recommendation unavailable.',1;
  IF @current<>TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')) OR TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')) IS NULL THROW 51009,'Recommendation changed.',1;
  IF @status NOT IN('PENDING','DISCUSSION') THROW 51010,'Recommendation already decided.',1;
  IF dbo.RecommendationCan(@account_id,@sender,@person)<>1 OR dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)<>1 THROW 51003,'Current relationship and personal learning required.',1;
  DECLARE @message nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.message'),'');
  IF DATALENGTH(@message)>4000 OR (@action='DISCUSS' AND NULLIF(LTRIM(RTRIM(@message)),'') IS NULL) THROW 51000,'Explain the discussion request.',1;
  SET @before=(SELECT status,revision FROM dbo.LearningRecommendation WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @action='ACCEPT' BEGIN
   DECLARE @plan_payload nvarchar(max)=JSON_QUERY(@payload,'$.plan');SET @plan=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@plan_payload,'$.id'));
   IF @plan IS NULL OR JSON_VALUE(@plan_payload,'$.action')<>'CREATE' OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@plan_payload,'$.skillId'))<>@skill OR JSON_VALUE(@plan_payload,'$.skillId') IS NULL THROW 51000,'Review a new plan for the recommended skill.',1;
   EXEC dbo.ChangeOwnLearningPlan @account_id,@actor_id,@plan,0,'CREATE',@plan_payload;
   SELECT @workspace_revision=revision FROM dbo.AccessWorkspace WHERE account_id=@account_id;
  END ELSE IF JSON_QUERY(@payload,'$.plan') IS NOT NULL THROW 51000,'Only acceptance creates a plan.',1;
  UPDATE dbo.LearningRecommendation SET status=CASE @action WHEN 'ACCEPT' THEN 'ACCEPTED' WHEN 'DECLINE' THEN 'DECLINED' ELSE 'DISCUSSION' END,response=@message,plan_id=@plan,revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
  INSERT dbo.LearningRecommendationEvent(account_id,id,revision,actor_id,person_id,action,message) VALUES(@account_id,@id,@current+1,@actor_id,@sender,@action,@message);
 END;
 SET @after=(SELECT status,revision,plan_id AS planId FROM dbo.LearningRecommendation WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,'recommendation.'+LOWER(@action),@id,@before,@after);
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO

CREATE OR ALTER FUNCTION dbo.WorkflowTopicCan(
 @account uniqueidentifier,@actor uniqueidentifier,@kind varchar(8),@category varchar(24)
) RETURNS bit AS
BEGIN
 IF @kind IS NULL OR @kind NOT IN ('REQUEST','INCIDENT') OR @category IS NULL
  OR @category NOT IN ('LEARNING','SKILL','ASSESSMENT','PROJECT','PROFILE_ACCESS','PLATFORM','OTHER') RETURN 0;
 IF dbo.AccessCan(@account,@actor,CASE @kind WHEN 'REQUEST' THEN 'request.create' ELSE 'incident.create' END,1)<>1
  OR dbo.AccessCan(@account,@actor,CASE @kind WHEN 'REQUEST' THEN 'request.view' ELSE 'incident.view' END,1)<>1 RETURN 0;
 IF @category='LEARNING' AND (dbo.TemplateFeatureAllowed(@account,@actor,'learning')=0
  OR dbo.AccessCan(@account,@actor,'learning.view',1)<>1) RETURN 0;
 IF @category='SKILL' AND dbo.AccessCan(@account,@actor,'skill.view',1)<>1 RETURN 0;
 IF @category='ASSESSMENT' AND (dbo.AccessCan(@account,@actor,'profile.view',1)<>1
  OR dbo.AccessCan(@account,@actor,'skill.view',1)<>1 OR dbo.AccessCan(@account,@actor,'skill.verify',0)<>1
  OR dbo.AccessReportingValid(@account,@actor)<>1) RETURN 0;
 IF @category='PROJECT' AND (dbo.BusinessHasAccess(@account,@actor)<>1
  OR dbo.BusinessLegacyDenied(@account,@actor,'demand.view')=1) RETURN 0;
 IF @category='PROFILE_ACCESS' AND dbo.AccessCan(@account,@actor,'profile.view',1)<>1 RETURN 0;
 RETURN 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.ReadOwnGrowthClaims
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace_revision int;
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.TemplateFeatureAllowed(@account_id,@actor_id,'learning')=0 THROW 51003,'Learning module unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 THROW 51003,'Growth journey denied.',1;
 DECLARE @skills TABLE(skill_id uniqueidentifier PRIMARY KEY);
 INSERT @skills SELECT DISTINCT TRY_CONVERT(uniqueidentifier,JSON_VALUE(payload,'$.skillId')) FROM
 (SELECT TOP(50) payload FROM dbo.LearningPlan WHERE account_id=@account_id AND person_id=@actor_id AND status<>'ARCHIVED' ORDER BY updated_at DESC,plan_id) p
 WHERE TRY_CONVERT(uniqueidentifier,JSON_VALUE(payload,'$.skillId')) IS NOT NULL;
 SELECT d.*,ROW_NUMBER() OVER(PARTITION BY d.skill_id ORDER BY d.updated_at DESC,d.claim_id) AS latest INTO #claims
 FROM dbo.SkillClaimDraft d JOIN @skills s ON s.skill_id=d.skill_id WHERE d.account_id=@account_id AND d.person_id=@actor_id;
 SELECT COUNT(*) AS total,CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 THEN 1 ELSE 0 END) AS canClaim FROM #claims WHERE latest=1;
 SELECT claim_id AS id,revision,skill_id AS skillId,skill_name AS skillName,category,definition_revision AS definitionRevision,claimed_rank AS rank,level_name AS levelName,level_description AS levelDescription,experience_months AS experienceMonths,CONVERT(char(10),last_used_on,23) AS lastUsedOn,description,status,updated_at AS updatedAt,projects,evidence,feedback,reviewer_id AS reviewerId FROM #claims WHERE latest=1 ORDER BY updated_at DESC,claim_id;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
